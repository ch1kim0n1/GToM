import * as fs from 'fs';
import * as path from 'path';
import { AuthenticityScorer } from '../src/core/authenticity.js';
import { ReceiptRegistry, compareReceiptRegression, RegressionToleranceConfig } from '../src/core/receipt-registry.js';
import { GTOM_RUBRIC_V1 } from '../src/core/gtom-rubric.js';
import { CURRENT_RECEIPT_SCHEMA_VERSION } from '../src/core/versioning.js';
import { Vulnerability, CognitiveState } from '../src/types/index.js';
import { ExecutionReceipt } from '../src/types/quality-rubric.js';

function makeVulnerability(category: Vulnerability['category']): Vulnerability {
  return {
    vulnerability_id: 'test-id',
    category,
    baseline_level: 0.3,
    current_level: 0.3,
    last_updated: new Date().toISOString(),
    evidence_count: 5,
    recent_exposures: [],
  };
}

function makeCognitiveState(): CognitiveState {
  return {
    state_id: 'test-state-id',
    trust_level: 0.8,
    cognitive_load: 0.2,
    decision_fatigue: 0.1,
    emotional_state: 'neutral',
    last_updated: new Date().toISOString(),
  };
}

describe('AuthenticityScorer Baseline Regression Tests', () => {
  let scorer: AuthenticityScorer;
  let registry: ReceiptRegistry;
  const baselineRecords = readBaselineRecords();

  beforeEach(() => {
    scorer = new AuthenticityScorer();
    registry = new ReceiptRegistry('GToM');
  });

  it('generates receipt with correct rubric metadata', async () => {
    const decision = {
      context: 'Test context',
      action: 'Test action',
      vulnerabilities: [makeVulnerability('authority_bias')],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    };

    const score = await scorer.scoreDecision(decision);

    // Wait for async receipt emission
    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();
    expect(latest?.rubric_name).toBe('gtom_v1');
    expect(latest?.project).toBe('gtom');
    expect(latest?.schema_version).toBe(CURRENT_RECEIPT_SCHEMA_VERSION);
  });

  it('receipt scores match rubric dimensions', async () => {
    const decision = {
      context: 'Test context',
      action: 'Test action',
      vulnerabilities: [makeVulnerability('authority_bias')],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    };

    const score = await scorer.scoreDecision(decision);

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();

    // GToM receipt aggregates the 5-dim rubric into a single 'authenticity' score.
    expect(latest?.scores.authenticity).toBeDefined();
    expect(latest?.scores.authenticity.score).toBeGreaterThanOrEqual(0);
    expect(latest?.scores.authenticity.score).toBeLessThanOrEqual(1);
    expect(latest?.overall_score).toBeGreaterThanOrEqual(0);
    expect(latest?.overall_score).toBeLessThanOrEqual(1);
  });

  it.each(baselineRecords)('baseline comparison: %s remains within versioned gates', async (record) => {
    const score = await scorer.scoreDecision(record.decision);

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();

    const result = compareReceiptRegression(latest!, record.receipt, record.tolerances);
    expect(result.regressed).toBe(false);
    expect(result.dimension_comparisons.authenticity.baseline_wilson_95_ci).toBeDefined();
    expect(score.authenticity_score).toBeCloseTo(latest!.scores.authenticity.score, 4);
  });

  it('receipt is persisted to registry', async () => {
    const decision = {
      context: 'Test context',
      action: 'Test action',
      vulnerabilities: [makeVulnerability('authority_bias')],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    };

    const score = await scorer.scoreDecision(decision);

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();
    expect(latest?.receipt_id).toBeDefined();
  });

  it('hard gates passed reflects rubric level', async () => {
    const decision = {
      context: 'Test context',
      action: 'Test action',
      vulnerabilities: [makeVulnerability('authority_bias')],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    };

    const score = await scorer.scoreDecision(decision);

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest?.hard_gates_passed).toBe(true); // High authenticity should pass
  });

  it('receipt includes decision metadata', async () => {
    const decision = {
      context: 'Test context',
      action: 'Test action',
      vulnerabilities: [makeVulnerability('authority_bias')],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    };

    const score = await scorer.scoreDecision(decision);

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest?.metadata).toBeDefined();
    expect(latest?.metadata.decision_id).toBeDefined();
    expect(latest?.metadata.rubric_level).toBeGreaterThanOrEqual(1);
    expect(latest?.metadata.rubric_level).toBeLessThanOrEqual(5);
  });
});

interface BaselineRecord {
  schema_version: 1;
  baseline_id: string;
  name: string;
  decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  };
  receipt: ExecutionReceipt;
  tolerances: RegressionToleranceConfig;
}

function readBaselineRecords(): BaselineRecord[] {
  const baselinePath = path.join(process.cwd(), 'test', 'baselines', 'regression-baselines-v1.jsonl');
  return fs.readFileSync(baselinePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BaselineRecord);
}
