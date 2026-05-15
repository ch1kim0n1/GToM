import { z } from 'zod';
import {
  GBrainCognitiveQuery,
  GBrainCognitiveQuerySchema,
  GBrainCognitiveResponse,
  GBrainCognitiveResponseSchema,
} from '../types/index.js';
import { globalObservability } from './observability.js';
import { defaultSecretManager } from './secret-manager.js';

export type GBrainIntegrationMode = 'http' | 'mcp';

export interface GBrainMCPClient {
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface GBrainClientConfig {
  endpoint?: string;
  authToken?: string;
  mode?: GBrainIntegrationMode;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerResetMs?: number;
  mcpClient?: GBrainMCPClient;
  fetchImpl?: typeof fetch;
}

export interface GBrainOperationResult<T> {
  available: boolean;
  degraded: boolean;
  value: T;
  error?: string;
  source: GBrainIntegrationMode;
}

export interface GBrainHealth {
  healthy: boolean;
  endpoint: string;
  mode: GBrainIntegrationMode;
  circuit: CircuitBreakerState;
  status?: string;
}

export interface GBrainPageInput {
  page_id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface GBrainWhoKnowsQuery {
  userId: string;
  context?: string;
  limit?: number;
}

export interface GBrainWhoKnowsResult {
  user_id: string;
  facts: Array<{
    content: string;
    confidence: number;
    source?: string;
    updated_at?: string;
  }>;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

const HealthResponseSchema = z.object({
  status: z.string().optional(),
  healthy: z.boolean().optional(),
}).passthrough();

const PutPageResponseSchema = z.object({
  page_id: z.string().optional(),
  id: z.string().optional(),
  stored: z.boolean().optional(),
  ok: z.boolean().optional(),
}).passthrough();

const WhoKnowsResponseSchema = z.object({
  user_id: z.string().optional(),
  facts: z.array(z.object({
    content: z.string(),
    confidence: z.number().min(0).max(1).default(0.5),
    source: z.string().optional(),
    updated_at: z.string().optional(),
  })).default([]),
}).passthrough();

/**
 * Typed, resilient integration client for GBrain.
 */
export class GBrainClient {
  private readonly endpoint: string;
  private readonly authToken?: string;
  private readonly mode: GBrainIntegrationMode;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly circuitBreakerFailureThreshold: number;
  private readonly circuitBreakerResetMs: number;
  private readonly mcpClient?: GBrainMCPClient;
  private readonly fetchImpl: typeof fetch;
  private failureCount = 0;
  private circuitOpenedAt = 0;
  private circuitState: CircuitBreakerState = 'closed';

  constructor(config: GBrainClientConfig = {}) {
    this.endpoint = this.normalizeEndpoint(
      config.endpoint
        ?? process.env.GTOM_GBRAIN_ENDPOINT
        ?? process.env.GBRAIN_ENDPOINT
        ?? 'http://localhost:3000',
    );
    this.authToken = config.authToken
      ?? defaultSecretManager.getSecret('GTOM_GBRAIN_AUTH_TOKEN')
      ?? defaultSecretManager.getSecret('GBRAIN_AUTH_TOKEN');
    this.mode = config.mode ?? this.parseMode(process.env.GTOM_GBRAIN_MODE) ?? 'http';
    this.timeoutMs = config.timeoutMs ?? Number(process.env.GTOM_GBRAIN_TIMEOUT_MS ?? 1000);
    this.maxRetries = config.maxRetries ?? Number(process.env.GTOM_GBRAIN_MAX_RETRIES ?? 2);
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? Number(process.env.GTOM_GBRAIN_RETRY_BASE_DELAY_MS ?? 100);
    this.circuitBreakerFailureThreshold = config.circuitBreakerFailureThreshold
      ?? Number(process.env.GTOM_GBRAIN_CIRCUIT_FAILURE_THRESHOLD ?? 3);
    this.circuitBreakerResetMs = config.circuitBreakerResetMs
      ?? Number(process.env.GTOM_GBRAIN_CIRCUIT_RESET_MS ?? 30_000);
    this.mcpClient = config.mcpClient;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  getCircuitState(): CircuitBreakerState {
    this.refreshCircuitState();
    return this.circuitState;
  }

  async health(traceId?: string): Promise<GBrainOperationResult<GBrainHealth>> {
    return this.run('health', {
      fallback: {
        healthy: false,
        endpoint: this.endpoint,
        mode: this.mode,
        circuit: this.getCircuitState(),
        status: undefined,
      },
      http: async () => {
        const parsed = await this.requestJson('/health', HealthResponseSchema, { method: 'GET' }, traceId);
        return {
          healthy: parsed.healthy ?? (parsed.status ? ['ok', 'healthy'].includes(parsed.status) : true),
          endpoint: this.endpoint,
          mode: this.mode,
          circuit: this.getCircuitState(),
          status: parsed.status,
        };
      },
      mcpTool: 'gbrain.health',
      mcpInput: {},
      mcpSchema: HealthResponseSchema.transform((parsed) => ({
        healthy: parsed.healthy ?? (parsed.status ? ['ok', 'healthy'].includes(parsed.status) : true),
        endpoint: this.endpoint,
        mode: this.mode,
        circuit: this.getCircuitState(),
        status: parsed.status,
      })),
    });
  }

  async queryCognitiveContext(
    query: GBrainCognitiveQuery,
    traceId?: string,
  ): Promise<GBrainOperationResult<GBrainCognitiveResponse>> {
    const parsedQuery = GBrainCognitiveQuerySchema.parse(query);
    return this.run('query_context', {
      fallback: emptyCognitiveResponse(),
      http: () => this.requestJson('/cognitive/query', GBrainCognitiveResponseSchema, {
        method: 'POST',
        body: JSON.stringify(parsedQuery),
      }, traceId),
      mcpTool: 'gbrain.query_context',
      mcpInput: parsedQuery,
      mcpSchema: GBrainCognitiveResponseSchema,
    });
  }

  async putPage(page: GBrainPageInput, traceId?: string): Promise<GBrainOperationResult<{ page_id: string; stored: boolean }>> {
    const pageSchema = z.object({
      page_id: z.string().min(1),
      content: z.string(),
      metadata: z.record(z.unknown()).optional(),
    });
    const parsedPage = pageSchema.parse(page);
    return this.run('put_page', {
      fallback: { page_id: parsedPage.page_id, stored: false },
      http: async () => {
        const parsed = await this.requestJson('/pages', PutPageResponseSchema, {
          method: 'POST',
          body: JSON.stringify(parsedPage),
        }, traceId);
        return {
          page_id: parsed.page_id ?? parsed.id ?? parsedPage.page_id,
          stored: parsed.stored ?? parsed.ok ?? true,
        };
      },
      mcpTool: 'gbrain.put_page',
      mcpInput: parsedPage,
      mcpSchema: PutPageResponseSchema.transform((parsed) => ({
        page_id: parsed.page_id ?? parsed.id ?? parsedPage.page_id,
        stored: parsed.stored ?? parsed.ok ?? true,
      })),
    });
  }

  async whoKnows(query: GBrainWhoKnowsQuery, traceId?: string): Promise<GBrainOperationResult<GBrainWhoKnowsResult>> {
    const parsedQuery = z.object({
      userId: z.string().min(1),
      context: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).parse(query);

    return this.run('whoknows', {
      fallback: { user_id: parsedQuery.userId, facts: [] },
      http: async () => {
        const params = new URLSearchParams();
        if (parsedQuery.context) params.set('context', parsedQuery.context);
        if (parsedQuery.limit) params.set('limit', String(parsedQuery.limit));
        const path = `/whoknows/${encodeURIComponent(parsedQuery.userId)}${params.size > 0 ? `?${params}` : ''}`;
        const parsed = await this.requestJson(path, WhoKnowsResponseSchema, { method: 'GET' }, traceId);
        return {
          user_id: parsed.user_id ?? parsedQuery.userId,
          facts: parsed.facts,
        };
      },
      mcpTool: 'gbrain.whoknows',
      mcpInput: parsedQuery,
      mcpSchema: WhoKnowsResponseSchema.transform((parsed) => ({
        user_id: parsed.user_id ?? parsedQuery.userId,
        facts: parsed.facts,
      })),
    });
  }

  summarizeContext(context: GBrainCognitiveResponse, whoKnows?: GBrainWhoKnowsResult): string[] {
    return [
      ...context.beliefs.map((belief) => `belief:${belief.content}`),
      ...context.desires.map((desire) => `desire:${desire.content}`),
      ...context.intentions.map((intention) => `intention:${intention.content}`),
      ...context.biases.map((bias) => `bias:${bias.type}:${bias.strength}`),
      ...(whoKnows?.facts ?? []).map((fact) => `whoknows:${fact.content}`),
    ];
  }

  private async run<T, S extends z.ZodTypeAny>(operation: string, config: {
    fallback: T;
    http: () => Promise<T>;
    mcpTool: string;
    mcpInput: Record<string, unknown>;
    mcpSchema: S;
  }): Promise<GBrainOperationResult<T>> {
    if (!this.allowRequest()) {
      return this.degraded(operation, config.fallback, 'gbrain circuit breaker is open');
    }

    try {
      const value = this.mode === 'mcp'
        ? await this.callMcp(config.mcpTool, config.mcpInput, config.mcpSchema)
        : await config.http();
      this.recordSuccess();
      return {
        available: true,
        degraded: false,
        value,
        source: this.mode,
      };
    } catch (error) {
      this.recordFailure();
      return this.degraded(operation, config.fallback, this.errorMessage(error));
    }
  }

  private async requestJson<T extends z.ZodTypeAny>(
    path: string,
    schema: T,
    init: RequestInit,
    traceId?: string,
  ): Promise<z.infer<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.endpoint}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...this.authHeaders(),
            ...this.traceHeaders(traceId),
            ...(init.headers ?? {}),
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          if (attempt < this.maxRetries && this.isTransientStatus(response.status)) {
            lastError = error;
            await this.sleep(this.backoffDelay(attempt));
            continue;
          }
          throw error;
        }

        return schema.parse(await response.json());
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries && this.isTransientError(error)) {
          await this.sleep(this.backoffDelay(attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async callMcp<T extends z.ZodTypeAny>(
    tool: string,
    input: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    if (!this.mcpClient) {
      throw new Error('GBrain MCP mode requested without an MCP client');
    }
    return schema.parse(await this.mcpClient.callTool(tool, input));
  }

  private degraded<T>(operation: string, value: T, error: string): GBrainOperationResult<T> {
    globalObservability.logger.warn('GBrain integration degraded', {
      operation,
      endpoint: this.endpoint,
      mode: this.mode,
      circuit: this.getCircuitState(),
      error,
    });
    return {
      available: false,
      degraded: true,
      value,
      error,
      source: this.mode,
    };
  }

  private allowRequest(): boolean {
    this.refreshCircuitState();
    return this.circuitState !== 'open';
  }

  private refreshCircuitState(): void {
    if (this.circuitState === 'open' && Date.now() - this.circuitOpenedAt >= this.circuitBreakerResetMs) {
      this.circuitState = 'half_open';
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.circuitState = 'closed';
    this.circuitOpenedAt = 0;
  }

  private recordFailure(): void {
    this.failureCount += 1;
    if (this.failureCount >= this.circuitBreakerFailureThreshold) {
      this.circuitState = 'open';
      this.circuitOpenedAt = Date.now();
    }
  }

  private authHeaders(): Record<string, string> {
    return this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};
  }

  private traceHeaders(traceId?: string): Record<string, string> {
    if (!traceId) {
      return {};
    }
    return {
      'X-GToM-Trace-Id': traceId,
      traceparent: `00-${traceId.replace(/-/g, '').slice(0, 32).padEnd(32, '0')}-0000000000000001-01`,
    };
  }

  private isTransientStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof z.ZodError) {
      return false;
    }
    if (error instanceof Error && /^HTTP (4\d\d)$/.test(error.message) && !/^HTTP (408|409|425|429)$/.test(error.message)) {
      return false;
    }
    return true;
  }

  private backoffDelay(attempt: number): number {
    return this.retryBaseDelayMs * (2 ** attempt);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private normalizeEndpoint(endpoint: string): string {
    return endpoint.replace(/\/+$/, '');
  }

  private parseMode(raw?: string): GBrainIntegrationMode | undefined {
    return raw === 'mcp' || raw === 'http' ? raw : undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export function emptyCognitiveResponse(): GBrainCognitiveResponse {
  return {
    beliefs: [],
    desires: [],
    intentions: [],
    biases: [],
  };
}
