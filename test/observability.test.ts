import { describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GToM } from '../src/core/gtom';
import {
  LocalAuditLogger,
  LocalLogger,
  MetricsRegistry,
  Observability,
  redactPII,
} from '../src/core/observability';

async function createTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'gtom-observability-'));
}

describe('GToM observability', () => {
  it('redacts PII from structured logs', () => {
    const lines: string[] = [];
    const logger = new LocalLogger('test', (line) => lines.push(line));

    logger.info('login', {
      email: 'user@example.com',
      nested: { apiKey: ['sk', 'test-redacted-example'].join('-') },
      message: 'contact user@example.com',
    });

    const entry = JSON.parse(lines[0]);
    expect(entry.context.email).toBe('[REDACTED]');
    expect(entry.context.nested.apiKey).toBe('[REDACTED]');
    expect(entry.context.message).toContain('[REDACTED_EMAIL]');
    expect(JSON.stringify(redactPII({ token: ['ghp', 'redacted-example-token'].join('_') }))).toContain('[REDACTED]');
  });

  it('exports counters and latency histograms as Prometheus and OTel data', () => {
    const metrics = new MetricsRegistry();
    metrics.recordThroughput('scoreDecisionAuthenticity');
    metrics.recordThroughput('scoreDecisionAuthenticity');
    metrics.recordError('scoreDecisionAuthenticity');
    metrics.recordLatency('scoreDecisionAuthenticity', 10);
    metrics.recordLatency('scoreDecisionAuthenticity', 50);
    metrics.recordLatency('scoreDecisionAuthenticity', 100);

    const prometheus = metrics.exportPrometheus();
    const otel = metrics.exportOpenTelemetry();

    expect(prometheus).toContain('gtom_method_calls_total{method="scoreDecisionAuthenticity"} 2');
    expect(prometheus).toContain('gtom_method_errors_total{method="scoreDecisionAuthenticity"} 1');
    expect(prometheus).toContain('quantile="0.95"');
    expect(JSON.stringify(otel)).toContain('scoreDecisionAuthenticity');
  });

  it('writes decision and shell-job audit JSONL files', async () => {
    const tempDir = await createTempDir();
    try {
      const audit = new LocalAuditLogger('gtom', tempDir);
      audit.recordDecision({
        operation: 'scoreDecisionAuthenticity',
        decision_id: 'decision-1',
        score: 0.9,
      });
      audit.recordShellJob({
        job_id: 'job-1',
        command: 'npm test',
        status: 'succeeded',
        exit_code: 0,
      });

      const auditDir = path.join(tempDir, '.gtom', 'audit');
      const files = fs.readdirSync(auditDir);
      expect(files.some((file) => /^decisions-\d{4}-W\d{2}\.jsonl$/.test(file))).toBe(true);
      expect(files.some((file) => /^shell-jobs-\d{4}-W\d{2}\.jsonl$/.test(file))).toBe(true);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records public method metrics and traces from GToM', () => {
    const gtom = new GToM();
    gtom.getVulnerabilities();
    gtom.getCostStats();
    gtom.recordShellJobAudit({
      job_id: 'job-observed',
      command: 'node --version',
      status: 'succeeded',
      exit_code: 0,
    });

    const metrics = gtom.exportMetrics('prometheus') as string;
    const snapshot = gtom.getObservabilitySnapshot();

    expect(metrics).toContain('gtom_method_calls_total{method="getVulnerabilities"}');
    expect(metrics).toContain('gtom_method_latency_ms{method="getCostStats"');
    expect(JSON.stringify(snapshot)).toContain('getVulnerabilities');
  });

  it('keeps observability instances isolated when needed', () => {
    const observability = new Observability('isolated');
    observability.timeSync('methodA', () => 'ok');
    const snapshot = observability.snapshot();
    expect(JSON.stringify(snapshot)).toContain('methodA');
  });
});
