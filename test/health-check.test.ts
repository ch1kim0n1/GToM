import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from '@jest/globals';
import { GToM } from '../src/core/gtom.js';
import { ExecutionReceipt } from '../src/types/quality-rubric.js';
import { CURRENT_RECEIPT_SCHEMA_VERSION } from '../src/core/versioning.js';

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.GTOM_HEALTH_MAX_PENDING_QUEUE;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('GToM health checks', () => {
  it('reports real downstream checks, schema health, freshness, trend, and weighted score', async () => {
    const gtom = await createHealthyGToM();
    await appendReceipt(gtom, new Date());

    const health = await gtom.healthCheck();
    const services = new Set(health.map((check) => check.service));

    for (const service of [
      'llm_api',
      'gbrain',
      'sandbox',
      'sync_freshness',
      'schema_version',
      'queue_health',
      'eval_capture',
      'health_trend',
      'overall_health',
    ]) {
      expect(services.has(service)).toBe(true);
    }

    expect(health.find((check) => check.service === 'sync_freshness')?.healthy).toBe(true);
    expect(health.find((check) => check.service === 'schema_version')?.details?.version).toBe(CURRENT_RECEIPT_SCHEMA_VERSION);
    expect(health.find((check) => check.service === 'overall_health')?.score).toBeGreaterThanOrEqual(0.9);
  });

  it('surfaces stale sync freshness and eval_capture failures from the last 24h', async () => {
    const gtom = await createHealthyGToM({ syncFreshnessMaxMs: 60 * 60 * 1000 });
    await appendReceipt(gtom, new Date(Date.now() - 2 * 60 * 60 * 1000));
    gtom.recordEvalCaptureFailure('capture timeout');

    const health = await gtom.healthCheck();

    expect(health.find((check) => check.service === 'sync_freshness')?.healthy).toBe(false);
    const evalCapture = health.find((check) => check.service === 'eval_capture');
    expect(evalCapture?.healthy).toBe(false);
    expect(evalCapture?.details?.failures_last_24h).toBe(1);
  });

  it('marks queue_health unhealthy when pending work exceeds the configured threshold', async () => {
    process.env.GTOM_HEALTH_MAX_PENDING_QUEUE = '0';
    const gtom = await createHealthyGToM();
    await appendReceipt(gtom, new Date());

    const health = await gtom.healthCheck();

    expect(health.find((check) => check.service === 'queue_health')?.healthy).toBe(false);
  });
});

async function createHealthyGToM(options: { syncFreshnessMaxMs?: number } = {}): Promise<GToM> {
  const baseDir = await mkdtemp(join(tmpdir(), 'gtom-health-'));
  tempDirs.push(baseDir);
  return new GToM({
    receiptRegistryOptions: { baseDir },
    syncFreshnessMaxMs: options.syncFreshnessMaxMs,
    healthProbes: {
      llm: async () => ({ healthy: true, details: { cheap_probe: 'mock' } }),
      gbrain: async () => ({ healthy: true, details: { endpoint: 'mock' } }),
      sandbox: async () => ({ healthy: true, details: { writable_tmp: true } }),
    },
  });
}

async function appendReceipt(gtom: GToM, timestamp: Date): Promise<void> {
  await (gtom as any).receiptRegistry.append(makeReceipt(timestamp));
}

function makeReceipt(timestamp: Date): ExecutionReceipt {
  return {
    receipt_id: `00000000-0000-4000-8000-${timestamp.getTime().toString().padStart(12, '0').slice(-12)}`,
    schema_version: 1,
    timestamp: timestamp.toISOString(),
    project: 'gtom',
    rubric_name: 'gtom_v1',
    rubric_sha8: 'health01',
    input_hash: 'healthcheck00001',
    models_used: ['local-safety-fallback'],
    config_hash: 'healthconfig0001',
    verdict: 'pass',
    scores: {
      authenticity: { score: 0.9, confidence: 0.9, weight: 1 },
    },
    overall_score: 0.9,
    hard_gates_passed: true,
    cost_usd: 0,
    metadata: {},
  };
}
