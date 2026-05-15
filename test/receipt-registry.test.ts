import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ReceiptRegistry,
  compareReceiptRegression,
  diffReceipts,
  migrateReceiptToVersion,
  readReceiptFile,
} from '../src/core/receipt-registry.js';
import { ExecutionReceipt } from '../src/types/quality-rubric.js';
import { CURRENT_RECEIPT_SCHEMA_VERSION } from '../src/core/versioning.js';

function makeReceipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return {
    receipt_id: '11111111-1111-4111-8111-111111111111',
    schema_version: 1,
    timestamp: new Date().toISOString(),
    project: 'gtom',
    rubric_name: 'gtom_v1',
    rubric_sha8: 'abcdef12',
    input_hash: '12345678abcdef00',
    models_used: ['model-a'],
    config_hash: 'feedface12345678',
    verdict: 'pass',
    scores: {
      authenticity: { score: 0.8, confidence: 0.9, weight: 1 },
    },
    overall_score: 0.8,
    hard_gates_passed: true,
    cost_usd: 0.01,
    metadata: { corpus_sha8: '12345678' },
    ...overrides,
  };
}

describe('ReceiptRegistry audit behavior', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gtom-receipts-'));
  });

  it('signs persisted receipts and verifies them on read', async () => {
    const registry = new ReceiptRegistry('gtom', {
      baseDir,
      hmacSecret: 'test-secret',
      postgresUrl: null,
    });

    await registry.append(makeReceipt());
    const latest = await registry.getLatest();

    expect(latest?.metadata?.receipt_signature).toMatch(/^[a-f0-9]{64}$/);
    expect(latest?.metadata?.receipt_expires_at).toBeDefined();

    const receiptFile = (await fs.readdir(baseDir)).find((file) => file.startsWith('receipts-'));
    expect(receiptFile).toBeDefined();
    const fromFile = await readReceiptFile(path.join(baseDir, receiptFile!), 'test-secret');
    expect(fromFile.receipt_id).toBe(latest?.receipt_id);
    expect(fromFile.schema_version).toBe(CURRENT_RECEIPT_SCHEMA_VERSION);
  });

  it('uses a case-normalized default receipt path across platforms', async () => {
    const originalCwd = process.cwd();
    const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'gtom-cwd-'));
    process.chdir(tempCwd);
    try {
      const lower = new ReceiptRegistry('gtom');
      const mixed = new ReceiptRegistry('GToM');

      await lower.append(makeReceipt({ receipt_id: '22222222-2222-4222-8222-222222222222' }));
      const latest = await mixed.getLatest();

      expect(latest?.receipt_id).toBe('22222222-2222-4222-8222-222222222222');
      expect(await fs.readdir(tempCwd)).toEqual(['gtom']);
    } finally {
      process.chdir(originalCwd);
      await fs.rm(tempCwd, { recursive: true, force: true });
    }
  });

  it('rejects tampered signed receipts', async () => {
    const registry = new ReceiptRegistry('gtom', {
      baseDir,
      hmacSecret: 'test-secret',
      postgresUrl: null,
    });

    await registry.append(makeReceipt());
    const receiptFile = (await fs.readdir(baseDir)).find((file) => file.startsWith('receipts-'))!;
    const receiptPath = path.join(baseDir, receiptFile);
    const tampered = (await fs.readFile(receiptPath, 'utf8')).replace('"overall_score":0.8', '"overall_score":0.1');
    await fs.writeFile(receiptPath, tampered, 'utf8');

    await expect(readReceiptFile(receiptPath, 'test-secret')).rejects.toThrow(/signature verification failed/);
  });

  it('retrieves receipts by corpus_sha8', async () => {
    const registry = new ReceiptRegistry('gtom', {
      baseDir,
      hmacSecret: 'test-secret',
      postgresUrl: null,
    });

    await registry.append(makeReceipt());

    const matches = await registry.getByCorpusSha8('12345678');
    expect(matches).toHaveLength(1);
    expect(matches[0].receipt_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('migrates schema_version=1 receipts forward without changing score semantics', () => {
    const legacy = makeReceipt({
      schema_version: 1,
      metadata: { corpus_sha8: '12345678' },
    });
    const migrated = migrateReceiptToVersion(legacy, 2, '2026-05-15T00:00:00.000Z');

    expect(migrated.schema_version).toBe(2);
    expect(migrated.overall_score).toBe(legacy.overall_score);
    expect(migrated.scores).toEqual(legacy.scores);
    expect(migrated.metadata?.api_stability).toBe('stable');
    expect(migrated.metadata?.rubric_version).toBe('gtom_v1');
    expect(migrated.metadata?.schema_history).toEqual([
      {
        from: 1,
        to: 2,
        migrated_at: '2026-05-15T00:00:00.000Z',
      },
    ]);
  });

  it('archives receipts older than four weeks', async () => {
    const registry = new ReceiptRegistry('gtom', {
      baseDir,
      hmacSecret: 'test-secret',
      postgresUrl: null,
    });

    await registry.append(makeReceipt({
      timestamp: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    }));
    await registry.archiveOldReceipts(new Date('2024-02-15T00:00:00.000Z'));

    const archiveFiles = await fs.readdir(path.join(baseDir, 'archive'));
    expect(archiveFiles.some((file) => file.startsWith('receipts-'))).toBe(true);
    const latest = await registry.getLatest();
    expect(latest?.receipt_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('diffs receipts and flags regressions', () => {
    const baseline = makeReceipt();
    const current = makeReceipt({
      receipt_id: '22222222-2222-4222-8222-222222222222',
      verdict: 'fail',
      overall_score: 0.6,
      hard_gates_passed: false,
      scores: {
        authenticity: { score: 0.6, confidence: 0.9, weight: 1 },
      },
      cost_usd: 0.02,
    });

    const diff = diffReceipts(baseline, current);
    expect(diff.overall_score_delta).toBe(-0.2);
    expect(diff.score_deltas.authenticity).toBe(-0.2);

    const regression = compareReceiptRegression(current, baseline, 0.05);
    expect(regression.regressed).toBe(true);
    expect(regression.reasons.length).toBeGreaterThan(0);
    expect(regression.dimension_comparisons.authenticity.baseline_wilson_95_ci).toBeDefined();
  });

  it('detects cost, latency, and tier1 success rate regressions', () => {
    const baseline = makeReceipt({
      metadata: { latency_ms: 100, tier1_success_rate: 0.95, sample_size: 100 },
    });
    const current = makeReceipt({
      receipt_id: '22222222-2222-4222-8222-222222222222',
      cost_usd: 0.05,
      metadata: { latency_ms: 140, tier1_success_rate: 0.8, sample_size: 100 },
    });

    const regression = compareReceiptRegression(current, baseline, {
      defaultScoreTolerance: 0.05,
      costToleranceUsd: 0.001,
      latencyToleranceMs: 10,
      metricTolerances: { tier1_success_rate: 0.05 },
      sampleSize: 100,
    });

    expect(regression.cost_regression.regressed).toBe(true);
    expect(regression.latency_regression.regressed).toBe(true);
    expect(regression.metric_comparisons.tier1_success_rate.regressed).toBe(true);
    expect(regression.regressed).toBe(true);
  });
});
