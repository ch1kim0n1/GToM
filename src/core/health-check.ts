import { ReceiptRegistry } from './receipt-registry.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  project: string;
  rubric_version: string;
  last_receipt_timestamp: string | null;
  drift_status: {
    has_drift: boolean;
    detected_at: string | null;
  };
  metrics: {
    uptime_ms: number;
    memory_usage_mb: number;
    recent_errors: number;
  };
}

export class HealthChecker {
  private project: string;
  private rubricVersion: string;
  private registry: ReceiptRegistry;
  private startTime: number;

  constructor(project: string, rubricVersion: string) {
    this.project = project;
    this.rubricVersion = rubricVersion;
    this.registry = new ReceiptRegistry(project);
    this.startTime = Date.now();
  }

  async check(): Promise<HealthCheckResult> {
    const latestReceipt = await this.registry.getLatest();
    const memoryUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9) {
      status = 'degraded';
    }
    if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.95) {
      status = 'unhealthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      project: this.project,
      rubric_version: this.rubricVersion,
      last_receipt_timestamp: latestReceipt?.timestamp || null,
      drift_status: {
        has_drift: false, // TODO: Implement drift detection
        detected_at: null,
      },
      metrics: {
        uptime_ms: uptime,
        memory_usage_mb: memoryUsage.heapUsed / 1024 / 1024,
        recent_errors: 0, // TODO: Track recent errors
      },
    };
  }
}
