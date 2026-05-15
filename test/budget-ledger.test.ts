import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BudgetLedger } from '../src/core/budget-ledger.js';
import { LLMClient } from '../src/core/llm-client.js';

describe('BudgetLedger', () => {
  let tmpDir: string;
  let now: Date;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtom-budget-'));
    now = new Date('2026-05-15T12:00:00.000Z');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reserves budget with TTL and commits actual model spend to daily and weekly rollups', () => {
    const ledger = new BudgetLedger({
      maxBudgetUsd: 1,
      baseDir: tmpDir,
      now: () => now,
    });

    const reservation = ledger.reserve('llm.call', 0.05, {
      resolver: 'authenticity',
      scope: 'decision',
    });
    expect(reservation.status).toBe('reserved');
    expect(new Date(reservation.expires_at).getTime()).toBeGreaterThan(now.getTime());

    ledger.commit(reservation.id, 0.0123, {
      model_id: 'claude-sonnet-4-6',
      input_tokens: 100,
      output_tokens: 50,
    });

    expect(ledger.getDailySpend()).toBeCloseTo(0.0123);
    expect(ledger.getWeeklySpend()).toBeCloseTo(0.0123);
    expect(ledger.getSpendByModel()['claude-sonnet-4-6']).toBeCloseTo(0.0123);
    expect(ledger.getSpendByOperation()['llm.call']).toBeCloseTo(0.0123);

    const auditDir = path.join(tmpDir, '.gtom', 'audit');
    expect(fs.existsSync(path.join(auditDir, 'cost-2026-05-15.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(auditDir, 'cost-2026-W20.jsonl'))).toBe(true);
  });

  it('expires stale reservations and releases reserved budget', () => {
    const ledger = new BudgetLedger({
      maxBudgetUsd: 1,
      defaultTtlMs: 10,
      baseDir: tmpDir,
      now: () => now,
    });

    ledger.reserve('llm.call', 0.5);
    expect(ledger.getStatus().total_reserved_usd).toBeCloseTo(0.5);

    now = new Date(now.getTime() + 11);
    expect(ledger.cleanupExpired()).toBe(1);
    expect(ledger.getStatus().total_reserved_usd).toBe(0);
  });

  it('enforces resolver and scope spend caps', () => {
    const ledger = new BudgetLedger({
      maxBudgetUsd: 1,
      resolverCapsUsd: { authenticity: 0.01 },
      scopeCapsUsd: { decision: 0.01 },
      baseDir: tmpDir,
      now: () => now,
    });

    expect(() => ledger.reserve('llm.call', 0.02, {
      resolver: 'authenticity',
      scope: 'decision',
    })).toThrow(/resolver spend cap exceeded/);
  });

  it('loads persisted daily spend on process restart', () => {
    const ledger = new BudgetLedger({
      maxBudgetUsd: 1,
      baseDir: tmpDir,
      now: () => now,
    });
    ledger.recordUnreservedSpend({
      model_id: 'gpt-4o-mini',
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.004,
      operation: 'llm.call',
      resolver: 'gtom',
      scope: 'cognitive-defense',
    });

    const restarted = new BudgetLedger({
      maxBudgetUsd: 1,
      baseDir: tmpDir,
      now: () => now,
    });
    expect(restarted.getTotalSpendUsd()).toBeCloseTo(0.004);
    expect(new LLMClient({ budgetLedger: restarted }).getTotalCostUsd()).toBeCloseTo(0.004);
  });
});
