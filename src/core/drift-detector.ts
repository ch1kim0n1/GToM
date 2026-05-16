export interface MetricSnapshot {
  timestamp: string;
  metric_name: string;
  value: number;
  context?: Record<string, any>;
  // Relational metrics context
  dyad_id?: string;
  relational_type?: 'bid_response_rate' | 'repair_success_rate' | 'emotional_labor_balance' | 'attachment_signal_frequency' | 'conflict_risk_score';
}

export interface DriftDetectionConfig {
  window_size?: number;
  drift_threshold?: number;
  alert_threshold?: number;
  baseline_period_ms?: number;
  min_baseline_points?: number;
  min_current_points?: number;
  brand_new_threshold?: number;
}

export interface DriftResult {
  metric_name: string;
  cohort: string;
  drift_detected: boolean;
  drift_magnitude: number;
  baseline_mean: number;
  current_mean: number;
  baseline_stddev: number;
  current_stddev: number;
  baseline_count: number;
  current_count: number;
  brand_new_cohort: boolean;
  zero_stddev_fallback: boolean;
  trend: 'improving' | 'degrading' | 'stable';
  confidence: number;
}

export class DriftDetector {
  private config: Required<DriftDetectionConfig>;
  private snapshots: Map<string, MetricSnapshot[]>;

  constructor(config: DriftDetectionConfig = {}) {
    this.config = {
      window_size: config.window_size ?? 100,
      drift_threshold: config.drift_threshold ?? 0.2,
      alert_threshold: config.alert_threshold ?? 0.3,
      baseline_period_ms: config.baseline_period_ms ?? 7 * 24 * 60 * 60 * 1000,
      min_baseline_points: config.min_baseline_points ?? 5,
      min_current_points: config.min_current_points ?? 5,
      brand_new_threshold: config.brand_new_threshold ?? 3,
    };
    this.snapshots = new Map();
  }

  recordSnapshot(metric_name: string, value: number, context?: Record<string, any>): void {
    const timestamp = typeof context?.timestamp === 'string' ? context.timestamp : new Date().toISOString();
    const snapshot: MetricSnapshot = {
      timestamp,
      metric_name,
      value,
      context,
      dyad_id: context?.dyad_id,
      relational_type: context?.relational_type,
    };

    const snapshots = this.snapshots.get(metric_name) ?? [];
    snapshots.push(snapshot);
    this.snapshots.set(metric_name, this.deterministicTrim(snapshots));
  }

  recordRelationalMetric(
    metric_name: string,
    value: number,
    dyad_id: string,
    relational_type: 'bid_response_rate' | 'repair_success_rate' | 'emotional_labor_balance' | 'attachment_signal_frequency' | 'conflict_risk_score',
    context?: Record<string, any>
  ): void {
    this.recordSnapshot(metric_name, value, {
      ...context,
      dyad_id,
      relational_type,
      cohort: dyad_id, // Use dyad_id as default cohort for relational metrics
    });
  }

  detectDrift(metric_name: string, options: { cohort?: string; now?: Date } = {}): DriftResult | null {
    const snapshots = this.snapshots.get(metric_name) ?? [];
    const cohort = options.cohort ?? 'all';
    const targetSnapshots = cohort === 'all'
      ? snapshots
      : snapshots.filter((snapshot) => cohortName(snapshot) === cohort);

    if (targetSnapshots.length === 0) return null;

    const now = options.now ?? new Date();
    const baselineCutoff = new Date(now.getTime() - this.config.baseline_period_ms);
    const baseline = targetSnapshots.filter((snapshot) => new Date(snapshot.timestamp) < baselineCutoff);
    const current = targetSnapshots.filter((snapshot) => new Date(snapshot.timestamp) >= baselineCutoff);

    if (current.length < this.config.min_current_points) return null;

    const brandNewCohort = baseline.length < this.config.min_baseline_points;
    if (brandNewCohort && current.length < this.config.brand_new_threshold) return null;

    return this.compareWindows(metric_name, cohort, baseline, current, brandNewCohort);
  }

  detectCohortAnomalies(metric_name: string, options: { now?: Date } = {}): DriftResult[] {
    return this.getCohorts(metric_name)
      .map((cohort) => this.detectDrift(metric_name, { cohort, now: options.now }))
      .filter((result): result is DriftResult => Boolean(result))
      .sort((a, b) => b.drift_magnitude - a.drift_magnitude || a.cohort.localeCompare(b.cohort));
  }

  detectAllDrift(options: { now?: Date } = {}): DriftResult[] {
    const results: DriftResult[] = [];

    for (const metricName of this.snapshots.keys()) {
      const aggregate = this.detectDrift(metricName, { now: options.now });
      if (aggregate) results.push(aggregate);
      results.push(...this.detectCohortAnomalies(metricName, options));
    }

    return results.sort((a, b) =>
      b.drift_magnitude - a.drift_magnitude ||
      a.metric_name.localeCompare(b.metric_name) ||
      a.cohort.localeCompare(b.cohort)
    );
  }

  getAlerts(): DriftResult[] {
    return this.detectAllDrift().filter((result) => result.drift_magnitude > this.config.alert_threshold);
  }

  getMetricStats(metric_name: string): {
    count: number;
    mean: number;
    min: number;
    max: number;
    stddev: number;
  } | null {
    const snapshots = this.snapshots.get(metric_name);
    if (!snapshots || snapshots.length === 0) return null;

    const values = snapshots.map((snapshot) => snapshot.value);
    const mean = meanOf(values);
    return {
      count: snapshots.length,
      mean,
      min: Math.min(...values),
      max: Math.max(...values),
      stddev: stddevOf(values, mean),
    };
  }

  getMetricNames(): string[] {
    return Array.from(this.snapshots.keys()).sort();
  }

  async loadFromPersistence(): Promise<void> {
    return;
  }

  async saveToPersistence(): Promise<void> {
    return;
  }

  reset(): void {
    this.snapshots.clear();
  }

  private compareWindows(
    metricName: string,
    cohort: string,
    baseline: MetricSnapshot[],
    current: MetricSnapshot[],
    brandNewCohort: boolean,
  ): DriftResult {
    const baselineValues = baseline.map((snapshot) => snapshot.value);
    const currentValues = current.map((snapshot) => snapshot.value);
    const baselineMean = baselineValues.length > 0 ? meanOf(baselineValues) : 0;
    const currentMean = meanOf(currentValues);
    const baselineStdDev = baselineValues.length > 0 ? stddevOf(baselineValues, baselineMean) : 0;
    const currentStdDev = stddevOf(currentValues, currentMean);
    const delta = currentMean - baselineMean;
    const zeroStddevFallback = baselineStdDev <= 1e-9;
    const driftMagnitude = zeroStddevFallback ? Math.abs(delta) : Math.abs(delta) / baselineStdDev;
    const driftDetected = zeroStddevFallback
      ? Math.abs(delta) > this.config.drift_threshold || currentMean > baselineMean + 1
      : driftMagnitude > this.config.drift_threshold;

    return {
      metric_name: metricName,
      cohort,
      drift_detected: driftDetected,
      drift_magnitude: driftMagnitude,
      baseline_mean: baselineMean,
      current_mean: currentMean,
      baseline_stddev: baselineStdDev,
      current_stddev: currentStdDev,
      baseline_count: baseline.length,
      current_count: current.length,
      brand_new_cohort: brandNewCohort,
      zero_stddev_fallback: zeroStddevFallback,
      trend: delta > 0 ? 'improving' : delta < 0 ? 'degrading' : 'stable',
      confidence: Math.min(1, (baseline.length + current.length) / 50),
    };
  }

  private getCohorts(metricName: string): string[] {
    const snapshots = this.snapshots.get(metricName) ?? [];
    return Array.from(new Set(snapshots.map(cohortName))).sort();
  }

  private deterministicTrim(snapshots: MetricSnapshot[]): MetricSnapshot[] {
    if (snapshots.length <= this.config.window_size) return snapshots;

    return [...snapshots]
      .sort((a, b) => {
        const timestampDelta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (timestampDelta !== 0) return timestampDelta;
        const cohortDelta = cohortName(a).localeCompare(cohortName(b));
        if (cohortDelta !== 0) return cohortDelta;
        const metricDelta = a.metric_name.localeCompare(b.metric_name);
        if (metricDelta !== 0) return metricDelta;
        return String(a.value).localeCompare(String(b.value));
      })
      .slice(0, this.config.window_size)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() || cohortName(a).localeCompare(cohortName(b)));
  }
}

export function createDriftDetector(config?: DriftDetectionConfig): DriftDetector {
  return new DriftDetector(config);
}

export function parseWindowDuration(value: string): number {
  const match = value.trim().match(/^(\d+)([dhm])?$/i);
  if (!match) {
    throw new Error('Window must use a duration like 7d, 24h, or 60m');
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'd').toLowerCase();
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * multipliers[unit];
}

function cohortName(snapshot: MetricSnapshot): string {
  const cohort = snapshot.context?.cohort;
  return typeof cohort === 'string' && cohort.length > 0 ? cohort : 'default';
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddevOf(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}
