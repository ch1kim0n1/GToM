/**
 * GToM HTTP Server
 * 
 * Exposes HTTP endpoints for conflict prediction:
 * - POST /gtom/predict-conflicts - Predict conflicts for a task
 * - GET /health/live - Liveness probe
 * - GET /health/ready - Readiness probe
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { GToM } from './core/gtom';
import { StructuredLogger } from '../../shared/src/observability/structured-logger.js';

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

  constructor(gtom: GToM, port: number = 3003) {
    this.gtom = gtom;
    this.port = port;
    this.logger = new StructuredLogger('gtom-server');
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
    const { method, url } = req;

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url === '/gtom/predict-conflicts' && method === 'POST') {
        await this.handlePredictConflicts(req, res);
      } else if (url === '/health/live' && method === 'GET') {
        await this.handleLiveness(res);
      } else if (url === '/health/ready' && method === 'GET') {
        await this.handleReadiness(res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('[GToMServer] Request error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Handle predict-conflicts request
   */
  private async handlePredictConflicts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const bufferModule = await import('node:buffer');

    const buffers: Buffer[] = [];
    for await (const chunk of req) {
      buffers.push(chunk as Buffer);
    }
    const body = bufferModule.Buffer.concat(buffers).toString();

    const request: ConflictPredictionRequest = JSON.parse(body);
    const result = await this.gtom.predictConflict({
      task: (request as any).task,
      active_attempts: (request as any).active_attempts ?? [],
    });

    // Derive summary fields from the predicted_conflicts list.
    const conflicts = result.predicted_conflicts;
    const maxSeverity = conflicts.reduce((m: number, c: { severity: number }) => Math.max(m, c.severity), 0);
    const avgConfidence = conflicts.length > 0
      ? conflicts.reduce((s: number, c: { confidence: number }) => s + c.confidence, 0) / conflicts.length
      : 1;
    const overall_risk: 'low' | 'medium' | 'high' =
      maxSeverity >= 0.7 ? 'high' : maxSeverity >= 0.4 ? 'medium' : 'low';

    const response = {
      task: request.task,
      conflicts,
      overall_risk,
      confidence: avgConfidence,
      timestamp: new Date().toISOString(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready', timestamp: new Date().toISOString() }));
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
