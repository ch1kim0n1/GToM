export interface LatencyMetrics {
  count: number;
  min_ms: number;
  max_ms: number;
  avg_ms: number;
  p95_ms: number;
}

export class LatencyTracker {
  private readonly samples: number[] = [];

  constructor(private readonly maxSamples = 1000) {}

  record(latencyMs: number): void {
    this.samples.push(latencyMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  getMetrics(): LatencyMetrics {
    if (this.samples.length === 0) {
      return { count: 0, min_ms: 0, max_ms: 0, avg_ms: 0, p95_ms: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return {
      count: sorted.length,
      min_ms: Number(sorted[0].toFixed(2)),
      max_ms: Number(sorted[sorted.length - 1].toFixed(2)),
      avg_ms: Number((sum / sorted.length).toFixed(2)),
      p95_ms: Number(sorted[p95Index].toFixed(2)),
    };
  }
}
