// GToM/test/authenticity.test.ts
import { AuthenticityScorer } from '../src/core/authenticity.js';
import { Vulnerability, CognitiveState } from '../src/types/index.js';

function makeVulnerability(category: Vulnerability['category'], level: number): Vulnerability {
  return {
    vulnerability_id: 'test-vuln-id',
    category,
    baseline_level: 0.5,
    current_level: level,
    last_updated: new Date().toISOString(),
    evidence_count: 1,
    recent_exposures: [],
  };
}

function makeCognitiveState(overrides: Partial<CognitiveState> = {}): CognitiveState {
  return {
    state_id: 'test-state-id',
    timestamp: new Date().toISOString(),
    trust_level: 0.8,
    cognitive_load: 0.2,
    emotional_state: 'neutral',
    attention_focus: 'product_page',
    decision_fatigue: 0.1,
    ...overrides,
  };
}

describe('AuthenticityScorer', () => {
  let scorer: AuthenticityScorer;

  beforeEach(() => {
    scorer = new AuthenticityScorer();
  });

  it('scores a clean decision as highly authentic (> 0.6)', () => {
    const result = scorer.scoreDecision({
      context: 'I want to purchase this product because it fits my workflow',
      action: 'purchase',
      vulnerabilities: [makeVulnerability('authority_bias', 0.5)],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    });

    expect(result.authenticity_score).toBeGreaterThan(0.6);
    expect(result.factors.self_alignment).toBeGreaterThan(0);
    expect(result.factors.external_pressure).toBeGreaterThanOrEqual(0);
    expect(result.manipulation_indicators).toBeInstanceOf(Array);
    expect(result.score_id).toBeDefined();
  });

  it('scores a manipulated decision as less authentic (< 0.7)', () => {
    const result = scorer.scoreDecision({
      context: 'I must buy now before it expires',
      action: 'purchase_urgent',
      vulnerabilities: [
        makeVulnerability('scarcity_fear', 0.95),
        makeVulnerability('authority_bias', 0.9),
      ],
      cognitiveState: makeCognitiveState({
        cognitive_load: 0.9,
        emotional_state: 'stressed',
        trust_level: 0.3,
      }),
      recentInfluences: ['Limited offer! Only 1 left!', 'CEO says act now'],
    });

    expect(result.authenticity_score).toBeLessThan(0.7);
  });

  it('produces a score between 0 and 1 in all cases', () => {
    const edgeCases = [
      { vulnerabilities: [], cognitiveState: makeCognitiveState(), recentInfluences: [] },
      {
        vulnerabilities: Array(10).fill(null).map(() => makeVulnerability('authority_bias', 1.0)),
        cognitiveState: makeCognitiveState({ cognitive_load: 1.0, trust_level: 0.0 }),
        recentInfluences: Array(20).fill('manipulative content'),
      },
    ];

    for (const ec of edgeCases) {
      const result = scorer.scoreDecision({
        context: 'test',
        action: 'test_action',
        ...ec,
      });
      expect(result.authenticity_score).toBeGreaterThanOrEqual(0);
      expect(result.authenticity_score).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('reports manipulation indicators when high-severity vulnerabilities are active', () => {
    const result = scorer.scoreDecision({
      context: 'Everyone is buying this, I should too',
      action: 'follow_crowd',
      vulnerabilities: [makeVulnerability('social_proof', 0.9)],
      cognitiveState: makeCognitiveState({ trust_level: 0.4 }),
      recentInfluences: ['10 million users', 'trending now'],
    });

    expect(result.manipulation_indicators.length).toBeGreaterThan(0);
  });
});
