import { DriftDetector, parseWindowDuration } from '../src/core/drift-detector.js';

function recordSeries(
  detector: DriftDetector,
  metric: string,
  values: number[],
  start: Date,
  cohort = 'default',
): void {
  values.forEach((value, index) => {
    detector.recordSnapshot(metric, value, {
      cohort,
      timestamp: new Date(start.getTime() + index * 60 * 1000).toISOString(),
    });
  });
}

describe('DriftDetector', () => {
  it('uses zero-stddev fallback when learned baseline variance is zero', () => {
    const detector = new DriftDetector({
      baseline_period_ms: 60 * 60 * 1000,
      min_baseline_points: 5,
      min_current_points: 5,
      drift_threshold: 0.2,
    });
    const now = new Date('2026-05-15T12:00:00.000Z');

    recordSeries(detector, 'bid_count', Array(6).fill(3), new Date('2026-05-15T09:00:00.000Z'));
    recordSeries(detector, 'bid_count', Array(5).fill(5), new Date('2026-05-15T11:10:00.000Z'));

    const result = detector.detectDrift('bid_count', { now });
    expect(result?.zero_stddev_fallback).toBe(true);
    expect(result?.drift_detected).toBe(true);
    expect(result?.drift_magnitude).toBe(2);
  });

  it('handles brand-new cohorts once they meet the small-sample threshold', () => {
    const detector = new DriftDetector({
      baseline_period_ms: 60 * 60 * 1000,
      min_baseline_points: 5,
      min_current_points: 3,
      brand_new_threshold: 3,
    });
    const now = new Date('2026-05-15T12:00:00.000Z');

    recordSeries(detector, 'repair_success_rate', [0.7, 0.7, 0.7], new Date('2026-05-15T11:10:00.000Z'), 'new-cohort');

    const result = detector.detectDrift('repair_success_rate', { cohort: 'new-cohort', now });
    expect(result?.brand_new_cohort).toBe(true);
    expect(result?.baseline_count).toBe(0);
    expect(result?.current_count).toBe(3);
  });

  it('detects per-cohort anomalies independently', () => {
    const detector = new DriftDetector({
      baseline_period_ms: 60 * 60 * 1000,
      min_baseline_points: 5,
      min_current_points: 5,
      drift_threshold: 0.2,
    });
    const now = new Date('2026-05-15T12:00:00.000Z');

    recordSeries(detector, 'authenticity', Array(6).fill(0.5), new Date('2026-05-15T09:00:00.000Z'), 'stable');
    recordSeries(detector, 'authenticity', Array(5).fill(0.52), new Date('2026-05-15T11:10:00.000Z'), 'stable');
    recordSeries(detector, 'authenticity', Array(6).fill(0.5), new Date('2026-05-15T09:00:00.000Z'), 'spike');
    recordSeries(detector, 'authenticity', Array(5).fill(0.9), new Date('2026-05-15T11:10:00.000Z'), 'spike');

    const anomalies = detector.detectCohortAnomalies('authenticity', { now });
    expect(anomalies.map((result) => result.cohort)).toEqual(['spike', 'stable']);
    expect(anomalies[0].drift_detected).toBe(true);
  });

  it('trims snapshots deterministically with lexical tiebreakers', () => {
    const detector = new DriftDetector({ window_size: 2 });
    const timestamp = '2026-05-15T12:00:00.000Z';

    detector.recordSnapshot('metric', 1, { cohort: 'b', timestamp });
    detector.recordSnapshot('metric', 2, { cohort: 'a', timestamp });
    detector.recordSnapshot('metric', 3, { cohort: 'c', timestamp });

    const stats = detector.getMetricStats('metric');
    expect(stats?.count).toBe(2);
    expect(stats?.mean).toBe(1.5);
  });

  it('parses duration windows', () => {
    expect(parseWindowDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseWindowDuration('24h')).toBe(24 * 60 * 60 * 1000);
    expect(parseWindowDuration('60m')).toBe(60 * 60 * 1000);
  });
});
