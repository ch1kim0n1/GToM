import * as http from 'node:http';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
}

export interface ReadinessCheckResult {
  status: 'healthy' | 'ready' | 'degraded' | 'unhealthy';
  timestamp: string;
  dependencies: Record<string, unknown>;
}

export class HealthServer {
  private server: http.Server | null = null;
  private readonly shutdownHandlers: Array<() => Promise<void>> = [];

  constructor(
    private readonly liveness: () => Promise<HealthCheckResult>,
    private readonly readiness: () => Promise<ReadinessCheckResult>,
    private readonly port: number,
  ) {}

  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const url = req.url ?? '/';
      if (url === '/health/live') {
        const result = await this.liveness();
        res.writeHead(result.status === 'unhealthy' ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      if (url === '/health/ready') {
        const result = await this.readiness();
        res.writeHead(result.status === 'unhealthy' ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, resolve);
    });
  }

  async shutdown(): Promise<void> {
    for (const handler of this.shutdownHandlers) {
      await handler();
    }
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }
}
