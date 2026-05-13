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
  private baselineReceipt: any = null;
  private errorLog: Array<{ timestamp: string; error: string }> = [];
  private readonly ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  constructor(project: string, rubricVersion: string) {
    this.project = project;
    this.rubricVersion = rubricVersion;
    this.registry = new ReceiptRegistry(project);
    this.startTime = Date.now();
  }

  recordError(error: string): void {
    this.errorLog.push({
      timestamp: new Date().toISOString(),
      error,
    });
    const cutoff = Date.now() - this.ERROR_WINDOW_MS;
    this.errorLog = this.errorLog.filter(e => new Date(e.timestamp).getTime() > cutoff);
  }

  private getRecentErrorCount(): number {
    const cutoff = Date.now() - this.ERROR_WINDOW_MS;
    return this.errorLog.filter(e => new Date(e.timestamp).getTime() > cutoff).length;
  }

  private detectDrift(currentReceipt: any): { has_drift: boolean; detected_at: string | null } {
    if (!currentReceipt) {
      return { has_drift: false, detected_at: null };
    }
    if (!this.baselineReceipt) {
      this.baselineReceipt = currentReceipt;
      return { has_drift: false, detected_at: null };
    }
    const baselineMetrics = this.baselineReceipt.metrics || {};
    const currentMetrics = currentReceipt.metrics || {};
    const driftThreshold = 0.1;
    let hasDrift = false;
    for (const key of Object.keys(baselineMetrics)) {
      const baselineValue = baselineMetrics[key];
      const currentValue = currentMetrics[key];
      if (typeof baselineValue === 'number' && typeof currentValue === 'number') {
        const change = Math.abs((currentValue - baselineValue) / baselineValue);
        if (change > driftThreshold && baselineValue !== 0) {
          hasDrift = true;
          break;
        }
      }
    }
    return {
      has_drift: hasDrift,
      detected_at: hasDrift ? new Date().toISOString() : null,
    };
  }

  async check(): Promise<HealthCheckResult> {
    const latestReceipt = await this.registry.getLatest();
    const memoryUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;
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
      drift_status: this.detectDrift(latestReceipt),
      metrics: {
        uptime_ms: uptime,
        memory_usage_mb: memoryUsage.heapUsed / 1024 / 1024,
        recent_errors: this.getRecentErrorCount(),
      },
    };
  }
}
