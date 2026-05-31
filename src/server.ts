/**
 * GToM HTTP Server
 * 
 * Exposes HTTP endpoints for conflict prediction:
 * - POST /gtom/predict-conflicts - Predict conflicts for a task
 * - GET /health/live - Liveness probe
 * - GET /health/ready - Readiness probe
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';
import { GToM } from './core/gtom';
import { StructuredLogger } from './core/structured-logger.js';
import { globalObservability } from './core/observability';
import { sanitizeJsonValue, sanitizeUserString } from './core/input-sanitizer';
import {
  AccessScope,
  FixedWindowRateLimiter,
  PermissionManager,
  constantTimeEquals,
  hashToken,
} from './core/security';
import { createAuthMiddleware } from './core/token-auth';
import { defaultSecretManager } from './core/secret-manager';
import { CancellationToken } from './core/performance';
import {
  BidAuthenticityInputSchema,
  ConflictAttemptSchema,
  RelationalConflictRequestSchema,
} from './types/index';

// HTTP request schema for conflict prediction. It reuses the canonical
// `ConflictAttemptSchema` from types/ (single source of truth for an attempt's
// shape) and adds HTTP-layer-specific fields. `task` is constrained to a
// non-empty string here because the HTTP layer sanitizes it as a string.
export const ConflictPredictionRequestSchema = z.object({
  task: z.string().min(1),
  active_attempts: z.array(ConflictAttemptSchema).optional().default([]),
  context: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});

export interface ConflictPredictionRequest {
  task: string;
  context?: string;
  constraints?: string[];
}

export interface ConflictPredictionResponse {
  task: string;
  conflicts: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    probability: number;
  }>;
  overall_risk: 'low' | 'medium' | 'high';
  confidence: number;
  timestamp: string;
}

export class GToMServer {
  private gtom: GToM;
  private server: any = null;
  private port: number;
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private logger: StructuredLogger;
  private readonly rateLimiter: FixedWindowRateLimiter;
  private readonly tenantRateLimiter: FixedWindowRateLimiter;
  private readonly corsOrigin: string;
  private readonly maxBodyBytes: number;
  private readonly shutdownDrainTimeoutMs: number;
  private draining = false;
  private shuttingDown = false;
  private activeRequests = 0;
  private signalHandler: (() => void) | null = null;
  private readonly registerSignalHandlers: boolean;
  private readonly authRequired: boolean;
  private readonly trustProxy: boolean;
  private readonly metricsRequireAuth: boolean;
  private readonly authMiddleware: { authenticate: (authorization: string) => { success: boolean; error?: string; token?: { userId?: string; sub?: string; roles?: string[] } } } | null;
  private readonly permissions: PermissionManager;

  constructor(gtom: GToM, port: number = 3003) {
    this.gtom = gtom;
    this.port = port;
    this.logger = new StructuredLogger('gtom-server');
    this.rateLimiter = new FixedWindowRateLimiter(
      parseInt(process.env.GTOM_HTTP_RATE_LIMIT_RPM ?? '120', 10),
      parseInt(process.env.GTOM_HTTP_RATE_LIMIT_RPH ?? '2000', 10),
    );
    this.tenantRateLimiter = new FixedWindowRateLimiter(
      parseInt(process.env.GTOM_TENANT_RATE_LIMIT_RPM ?? '600', 10),
      parseInt(process.env.GTOM_TENANT_RATE_LIMIT_RPH ?? '10000', 10),
    );
    this.corsOrigin = process.env.GTOM_HTTP_CORS_ORIGIN ?? '*';
    this.maxBodyBytes = parseInt(process.env.GTOM_HTTP_MAX_BODY_BYTES ?? `${1024 * 1024}`, 10);
    this.shutdownDrainTimeoutMs = parseInt(process.env.GTOM_SHUTDOWN_DRAIN_TIMEOUT_MS ?? '25000', 10);
    // Signal-handler registration is opt-out for embedded use: set
    // GTOM_REGISTER_SIGNAL_HANDLERS=false to manage shutdown yourself.
    this.registerSignalHandlers = process.env.GTOM_REGISTER_SIGNAL_HANDLERS !== 'false';

    // Authentication: enabled by default. Opt out for local dev with
    // GTOM_HTTP_AUTH_REQUIRED=false.
    this.authRequired = process.env.GTOM_HTTP_AUTH_REQUIRED !== 'false';
    // Only trust X-Forwarded-For for rate-limit identity when an upstream proxy
    // is explicitly configured as trusted.
    this.trustProxy = process.env.GTOM_TRUSTED_PROXY === 'true';
    // /metrics is auth-gated by default (set GTOM_METRICS_REQUIRE_AUTH=false to
    // expose without auth, e.g. when bound to a private interface).
    this.metricsRequireAuth = process.env.GTOM_METRICS_REQUIRE_AUTH !== 'false';
    this.permissions = new PermissionManager();
    const httpSecret = process.env.GTOM_HTTP_SECRET ?? process.env.GTOM_MCP_SECRET;
    this.authMiddleware = httpSecret
      ? createAuthMiddleware({ secret: httpSecret, tool: 'gtom-http', defaultRoles: ['read'] })
      : null;
  }

  /**
   * Authorize an HTTP request for a given required scope. Returns null on
   * success (request may proceed) or an HTTP status + message on rejection.
   */
  private authorizeRequest(
    req: IncomingMessage,
    requiredScopes: AccessScope[],
    resource: string,
  ): { status: number; error: string } | null {
    if (!this.authRequired) return null;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return { status: 401, error: 'Authentication required' };
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // 1) Configured static tokens (admin/write/read) compared in constant time.
    const configured: Array<[string | undefined, AccessScope[], string]> = [
      [defaultSecretManager.getSecret('GTOM_HTTP_ADMIN_TOKEN'), ['admin'], 'http-admin'],
      [defaultSecretManager.getSecret('GTOM_HTTP_WRITE_TOKEN'), ['read', 'write'], 'http-writer'],
      [defaultSecretManager.getSecret('GTOM_HTTP_READ_TOKEN'), ['read'], 'http-reader'],
    ];
    for (const [configuredToken, scopes, userId] of configured) {
      if (configuredToken && constantTimeEquals(token, configuredToken)) {
        const principal = this.permissions.getPrincipal(userId, scopes);
        return this.permissions.authorize(principal, requiredScopes, resource)
          ? null
          : { status: 403, error: `Forbidden: requires ${requiredScopes.join(', ')} scope` };
      }
    }

    // 2) Signed bearer tokens via token-auth (requires GTOM_HTTP_SECRET).
    if (this.authMiddleware) {
      const result = this.authMiddleware.authenticate(authHeader);
      if (result.success) {
        const roles = (result.token?.roles ?? ['read']).filter((r): r is AccessScope =>
          ['read', 'write', 'admin'].includes(r),
        );
        const principal = this.permissions.getPrincipal(
          String(result.token?.userId ?? result.token?.sub ?? `token-${hashToken(token)}`),
          roles.length > 0 ? roles : ['read'],
        );
        return this.permissions.authorize(principal, requiredScopes, resource)
          ? null
          : { status: 403, error: `Forbidden: requires ${requiredScopes.join(', ')} scope` };
      }
    }

    return { status: 401, error: 'Authentication failed: invalid token' };
  }

  /**
   * Add a shutdown handler to be called during graceful shutdown
   */
  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    const http = await import('node:http');

    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res);
    });

    // Register SIGTERM/SIGINT handlers exactly once per instance, storing a
    // bound reference so they can be removed on stop()/shutdown(). This avoids
    // leaking listeners (MaxListenersExceededWarning) and prevents a single
    // signal from triggering multiple overlapping shutdowns.
    if (this.registerSignalHandlers && !this.signalHandler) {
      this.signalHandler = () => {
        void this.shutdown();
      };
      process.on('SIGTERM', this.signalHandler);
      process.on('SIGINT', this.signalHandler);
    }

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        this.logger.info(`Listening on port ${this.port}`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.activeRequests++;
    res.on('finish', () => {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    });
    const { method, url } = req;
    const traceId = req.headers['x-trace-id']?.toString() ?? req.headers.traceparent?.toString().split('-')[1];
    const span = globalObservability.tracer.startSpan(`http.${method ?? 'UNKNOWN'} ${url ?? '/'}`, {
      trace_id: traceId,
      method,
      url,
      gbrain_correlation: req.headers['x-gbrain-trace-id']?.toString(),
    });
    globalObservability.metrics.recordThroughput('http_request');
    const start = performance.now();

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Trace-Id, X-GBrain-Trace-Id, Traceparent');
    res.setHeader('X-Trace-Id', span.trace_id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (this.draining && url !== '/health/live' && url !== '/health/ready') {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '30' });
        res.end(JSON.stringify({ error: 'Server is draining for shutdown' }));
        return;
      }

      const identity = this.clientIdentity(req);
      const rateLimit = this.rateLimiter.check(identity);
      res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
      res.setHeader('X-RateLimit-Reset', rateLimit.reset_at);
      if (!rateLimit.allowed) {
        globalObservability.audit.recordSecurityEvent({
          event_type: 'http_rate_limit_exceeded',
          actor: identity,
          resource: url ?? '/',
          metadata: { reset_at: rateLimit.reset_at },
        });
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded', reset_at: rateLimit.reset_at }));
        return;
      }

      const tenantId = this.tenantIdentity(req);
      const tenantLimit = this.tenantRateLimiter.check(tenantId);
      res.setHeader('X-Tenant-Id', tenantId.replace(/^tenant:/, ''));
      res.setHeader('X-Tenant-RateLimit-Remaining', String(tenantLimit.remaining));
      res.setHeader('X-Tenant-RateLimit-Reset', tenantLimit.reset_at);
      if (!tenantLimit.allowed) {
        globalObservability.audit.recordSecurityEvent({
          event_type: 'tenant_quota_exceeded',
          actor: identity,
          resource: url ?? '/',
          metadata: { tenant_id: tenantId, reset_at: tenantLimit.reset_at },
        });
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tenant quota exceeded', reset_at: tenantLimit.reset_at }));
        return;
      }

      // Authorization gate. /health/* is always public; /gtom/* requires the
      // scope appropriate to the operation; /metrics is auth-gated by default.
      const isGtomRoute = url?.startsWith('/gtom/') ?? false;
      const isMetricsRoute = url === '/metrics' || url === '/metrics/otel';
      if (isGtomRoute || (isMetricsRoute && this.metricsRequireAuth)) {
        const writeRoutes = new Set([
          '/gtom/predict-conflicts',
          '/gtom/predict-conflicts/stream',
          '/gtom/predict-relational-conflicts',
          '/gtom/score-bid',
        ]);
        const requiredScopes: AccessScope[] = writeRoutes.has(url ?? '') ? ['write'] : ['read'];
        const denial = this.authorizeRequest(req, requiredScopes, url ?? '/');
        if (denial) {
          globalObservability.audit.recordSecurityEvent({
            event_type: 'http_authorization_denied',
            actor: identity,
            resource: url ?? '/',
            metadata: { status: denial.status },
          });
          res.writeHead(denial.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: denial.error }));
          return;
        }
      }

      if (url === '/gtom/predict-conflicts' && method === 'POST') {
        await this.handlePredictConflicts(req, res);
      } else if (url === '/gtom/predict-conflicts/stream' && method === 'POST') {
        await this.handlePredictConflictsStream(req, res);
      } else if (url === '/gtom/predict-relational-conflicts' && method === 'POST') {
        await this.handlePredictRelationalConflicts(req, res);
      } else if (url === '/gtom/score-bid' && method === 'POST') {
        await this.handleScoreBid(req, res);
      } else if (url?.startsWith('/gtom/attachment-state/') && method === 'GET') {
        await this.handleAttachmentState(url, res);
      } else if (url === '/health/live' && method === 'GET') {
        await this.handleLiveness(res);
      } else if (url === '/health/ready' && method === 'GET') {
        await this.handleReadiness(res);
      } else if (url === '/metrics' && method === 'GET') {
        await this.handlePrometheusMetrics(res);
      } else if (url === '/metrics/otel' && method === 'GET') {
        await this.handleOtelMetrics(res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
      globalObservability.metrics.recordLatency('http_request', performance.now() - start);
      globalObservability.tracer.endSpan(span);
    } catch (error) {
      globalObservability.metrics.recordError('http_request');
      globalObservability.metrics.recordLatency('http_request', performance.now() - start);
      globalObservability.tracer.endSpan(span, error);
      globalObservability.logger.error('GToMServer request error', error, { method, url }, span);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Handle predict-conflicts request
   */
  private async handlePredictConflicts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const request = await this.readConflictPredictionRequest(req, res);
    if (!request) return;
    const result = await this.gtom.predictConflict({
      task: request.task,
      active_attempts: request.active_attempts,
    });

    const response = this.toConflictPredictionResponse(request.task, result);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  private async handlePredictRelationalConflicts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJsonBody(req, res, '/gtom/predict-relational-conflicts');
    if (body === null) return;
    let request;
    try {
      const sanitized = sanitizeJsonValue(body, 'predict-relational-conflicts');
      const parsed = RelationalConflictRequestSchema.safeParse(sanitized);
      if (!parsed.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() }));
        return;
      }
      request = parsed.data;
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body', details: error instanceof Error ? error.message : 'Bad input' }));
      return;
    }
    const result = await this.gtom.predictRelationalConflicts(request);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private async handleScoreBid(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJsonBody(req, res, '/gtom/score-bid');
    if (body === null) return;
    let request;
    try {
      const sanitized = sanitizeJsonValue(body, 'score-bid');
      const parsed = BidAuthenticityInputSchema.safeParse(sanitized);
      if (!parsed.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() }));
        return;
      }
      request = parsed.data;
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body', details: error instanceof Error ? error.message : 'Bad input' }));
      return;
    }
    const result = await this.gtom.scoreBid(request);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private async handleAttachmentState(url: string, res: ServerResponse): Promise<void> {
    const rawDyadId = decodeURIComponent(url.replace('/gtom/attachment-state/', ''));
    const dyadId = sanitizeUserString(rawDyadId, {
      fieldName: 'dyad_id',
      maxLength: 128,
      allowNewlines: false,
    });
    const result = this.gtom.getAttachmentState(dyadId);
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Attachment state not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private async handlePredictConflictsStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const request = await this.readConflictPredictionRequest(req, res);
    if (!request) return;
    const cancellationToken = new CancellationToken();
    req.on('close', () => cancellationToken.cancel('HTTP client disconnected'));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: progress\ndata: ${JSON.stringify({ stage: 'accepted', percent: 1 })}\n\n`);
    const result = await this.gtom.predictConflict({
      task: request.task,
      active_attempts: request.active_attempts,
    }, {
      cancellationToken,
      onProgress: (event) => {
        res.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
      },
    });
    res.write(`event: result\ndata: ${JSON.stringify(this.toConflictPredictionResponse(request.task, result))}\n\n`);
    res.end();
  }

  private async readConflictPredictionRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ task: string; active_attempts: any[] } | null> {
    const bufferModule = await import('node:buffer');
    const buffers: Buffer[] = [];
    let bytesRead = 0;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      bytesRead += buffer.length;
      if (bytesRead > this.maxBodyBytes) {
        globalObservability.audit.recordSecurityEvent({
          event_type: 'http_body_rejected',
          resource: '/gtom/predict-conflicts',
          metadata: { reason: 'body_too_large', max_body_bytes: this.maxBodyBytes },
        });
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return null;
      }
      buffers.push(buffer);
    }
    const body = bufferModule.Buffer.concat(buffers).toString();

    let rawBody: unknown;
    try {
      rawBody = sanitizeJsonValue(JSON.parse(body), 'predict-conflicts');
    } catch (error) {
      // Malformed JSON or sanitizer rejection is a client error (400), not a
      // server error. Do NOT let it propagate to the 500 handler.
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid request body',
        details: error instanceof Error ? error.message : 'Malformed JSON',
      }));
      return null;
    }
    const parsed = ConflictPredictionRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() }));
      return null;
    }
    const request = parsed.data;
    const task = sanitizeUserString(request.task, {
      fieldName: 'task',
      maxLength: 10_000,
      allowNewlines: true,
    });
    return {
      task,
      active_attempts: request.active_attempts as any,
    };
  }

  private async readJsonBody(
    req: IncomingMessage,
    res: ServerResponse,
    resource: string,
  ): Promise<unknown | null> {
    const bufferModule = await import('node:buffer');
    const buffers: Buffer[] = [];
    let bytesRead = 0;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      bytesRead += buffer.length;
      if (bytesRead > this.maxBodyBytes) {
        globalObservability.audit.recordSecurityEvent({
          event_type: 'http_body_rejected',
          resource,
          metadata: { reason: 'body_too_large', max_body_bytes: this.maxBodyBytes },
        });
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return null;
      }
      buffers.push(buffer);
    }
    try {
      return JSON.parse(bufferModule.Buffer.concat(buffers).toString() || '{}');
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid request body',
        details: error instanceof Error ? error.message : 'Malformed JSON',
      }));
      return null;
    }
  }

  private toConflictPredictionResponse(task: string, result: any): Record<string, unknown> {
    // Derive summary fields from the predicted_conflicts list.
    const conflicts = result.predicted_conflicts;
    const maxSeverity = conflicts.reduce((m: number, c: { severity: number }) => Math.max(m, c.severity), 0);
    const avgConfidence = conflicts.length > 0
      ? conflicts.reduce((s: number, c: { confidence: number }) => s + c.confidence, 0) / conflicts.length
      : 1;
    const overall_risk: 'low' | 'medium' | 'high' =
      maxSeverity >= 0.7 ? 'high' : maxSeverity >= 0.4 ? 'medium' : 'low';

    const response = {
      task,
      conflicts,
      overall_risk,
      confidence: avgConfidence,
      timestamp: new Date().toISOString(),
    };
    return response;
  }

  /**
   * Handle liveness probe
   */
  private async handleLiveness(res: ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
  }

  /**
   * Handle readiness probe
   */
  private async handleReadiness(res: ServerResponse): Promise<void> {
    const status = this.draining ? 'draining' : 'ready';
    res.writeHead(this.draining ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status,
      active_requests: this.activeRequests,
      timestamp: new Date().toISOString(),
    }));
  }

  private async handlePrometheusMetrics(res: ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(this.gtom.exportMetrics('prometheus') as string);
  }

  private async handleOtelMetrics(res: ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.gtom.exportMetrics('otel')));
  }

  private clientIdentity(req: IncomingMessage): string {
    const auth = req.headers.authorization;
    if (auth) {
      return `token:${hashToken(auth.replace(/^Bearer\s+/i, ''))}`;
    }
    // Only honor the client-controlled X-Forwarded-For header when an upstream
    // proxy is explicitly trusted; otherwise an attacker could rotate XFF to
    // mint unlimited fresh rate-limit buckets. Default to the real socket peer.
    if (this.trustProxy) {
      const forwardedFor = req.headers['x-forwarded-for'];
      const forwarded = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(',')[0]?.trim();
      if (forwarded) {
        return `ip:${forwarded}`;
      }
    }
    return `ip:${req.socket.remoteAddress || 'unknown'}`;
  }

  private tenantIdentity(req: IncomingMessage): string {
    const tenant = req.headers['x-tenant-id']?.toString().trim()
      || req.headers['x-gstack-tenant']?.toString().trim()
      || 'default';
    return `tenant:${sanitizeUserString(tenant, {
      fieldName: 'tenant',
      maxLength: 128,
      allowNewlines: false,
    })}`;
  }

  /**
   * Stop the server
   */
  stop(): void {
    this.removeSignalHandlers();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private removeSignalHandlers(): void {
    if (this.signalHandler) {
      process.removeListener('SIGTERM', this.signalHandler);
      process.removeListener('SIGINT', this.signalHandler);
      this.signalHandler = null;
    }
  }

  /**
   * Graceful shutdown. Idempotent: concurrent or repeated invocations after the
   * first are no-ops.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.logger.info('Initiating graceful shutdown');
    this.draining = true;

    const deadline = Date.now() + this.shutdownDrainTimeoutMs;
    while (this.activeRequests > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Run all shutdown handlers
    for (const handler of this.shutdownHandlers) {
      try {
        await handler();
      } catch (error) {
        this.logger.error('Shutdown handler error', error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Close the server
    this.stop();
    this.logger.info('Shutdown complete');
  }
}
