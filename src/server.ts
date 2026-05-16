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
import { FixedWindowRateLimiter, hashToken } from './core/security';
import { CancellationToken } from './core/performance';
import {
  BidAuthenticityInputSchema,
  RelationalConflictRequestSchema,
} from './types/index';

export const ConflictPredictionRequestSchema = z.object({
  task: z.string().min(1),
  active_attempts: z.array(z.object({
    attempt_id: z.string().uuid(),
    config_id: z.string().uuid(),
    current_state: z.record(z.unknown()),
    recent_actions: z.array(z.string()),
  })).optional().default([]),
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
  private activeRequests = 0;

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

    // Add SIGTERM and SIGINT handlers for graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());

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
    if (!body) return;
    const request = RelationalConflictRequestSchema.parse(sanitizeJsonValue(body, 'predict-relational-conflicts'));
    const result = await this.gtom.predictRelationalConflicts(request);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private async handleScoreBid(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJsonBody(req, res, '/gtom/score-bid');
    if (!body) return;
    const request = BidAuthenticityInputSchema.parse(sanitizeJsonValue(body, 'score-bid'));
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

    const rawBody = sanitizeJsonValue(JSON.parse(body), 'predict-conflicts');
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
    return JSON.parse(bufferModule.Buffer.concat(buffers).toString() || '{}');
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
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
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
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
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
