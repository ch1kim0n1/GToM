// GToM/test/authenticity.test.ts
import { v4 as uuidv4 } from 'uuid';
import { AuthenticityScorer } from '../src/core/authenticity.js';
import { Vulnerability, CognitiveState } from '../src/types/index.js';

function makeVulnerability(category: Vulnerability['category'], level: number): Vulnerability {
  return {
    vulnerability_id: uuidv4(),
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
    state_id: uuidv4(),
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

  it('scores a clean decision as highly authentic (> 0.6)', async () => {
    const result = await scorer.scoreDecision({
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

  it('scores a manipulated decision as less authentic (< 0.7)', async () => {
    const result = await scorer.scoreDecision({
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

    expect(result.authenticity_score).toBeLessThan(0.4);
  });

  it('produces a score between 0 and 1 in all cases', async () => {
    const edgeCases = [
      { vulnerabilities: [], cognitiveState: makeCognitiveState(), recentInfluences: [] },
      {
        vulnerabilities: Array(10).fill(null).map(() => makeVulnerability('authority_bias', 1.0)),
        cognitiveState: makeCognitiveState({ cognitive_load: 1.0, trust_level: 0.0 }),
        recentInfluences: Array(20).fill('manipulative content'),
      },
    ];

    for (const ec of edgeCases) {
      const result = await scorer.scoreDecision({
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

  it('reports manipulation indicators when high-severity vulnerabilities are active', async () => {
    const result = await scorer.scoreDecision({
      context: 'Everyone is buying this, I should too',
      action: 'follow_crowd',
      vulnerabilities: [makeVulnerability('social_proof', 0.9)],
      cognitiveState: makeCognitiveState({ trust_level: 0.4 }),
      recentInfluences: ['10 million users', 'trending now'],
    });

    expect(result.manipulation_indicators.length).toBeGreaterThan(0);
  });

  it('uses injected LLM reasoning for authenticity scoring', async () => {
    const llmClient = {
      call: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          authenticity_score: 0.82,
          confidence: 0.91,
          factors: {
            self_alignment: 0.9,
            external_pressure: 0.1,
            time_pressure: 0.1,
            information_completeness: 0.8,
            emotional_state_impact: 0.2,
          },
          manipulation_indicators: [],
          reasoning: 'The action is consistent with the stated context and low pressure.',
        }),
        input_tokens: 100,
        output_tokens: 80,
        model_id: 'test-model',
        cost_usd: 0.001,
        latency_ms: 5,
      }),
    };
    scorer = new AuthenticityScorer({ llmClient });

    const result = await scorer.scoreDecision({
      context: 'I compared options and selected the one that fits my workflow',
      action: 'purchase',
      vulnerabilities: [],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    });

    expect(llmClient.call).toHaveBeenCalledTimes(3);
    expect(result.authenticity_score).toBe(0.82);
    expect(result.confidence).toBe(0.91);
    expect(result.factors.self_alignment).toBe(0.9);
  });

  it('requires two agreeing model votes and invokes tier 3 on disagreement', async () => {
    const responses: Record<string, number> = {
      'model-a': 0.2,
      'model-b': 0.82,
      'model-c': 0.86,
    };
    const llmClient = {
      call: jest.fn(async (_prompt, options) => {
        const model = options?.model as string;
        const score = responses[model];
        return {
          content: JSON.stringify({
            authenticity_score: score,
            confidence: 0.9,
            factors: {
              self_alignment: score,
              external_pressure: 1 - score,
              time_pressure: 0.1,
              information_completeness: 0.8,
              emotional_state_impact: 0.2,
            },
            manipulation_indicators: score < 0.4 ? ['coercion'] : [],
            reasoning: `${model} assessment`,
          }),
          input_tokens: 100,
          output_tokens: 80,
          model_id: model,
          cost_usd: 0.001,
          latency_ms: 5,
        };
      }),
    };
    scorer = new AuthenticityScorer({
      llmClient,
      consensus: {
        models: ['model-a', 'model-b', 'model-c'],
        consensusThreshold: 0.67,
        allowTier3: true,
      },
    });

    const result = await scorer.scoreDecision({
      context: 'I compared options and selected the one that fits my workflow',
      action: 'purchase',
      vulnerabilities: [],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    });

    expect(llmClient.call).toHaveBeenCalledTimes(3);
    expect(llmClient.call.mock.calls.map((call) => call[1]?.model)).toEqual(['model-a', 'model-b', 'model-c']);
    expect(result.authenticity_score).toBeCloseTo(0.84);
    expect(result.manipulation_indicators).toEqual([]);
  });

  it('disqualifies model votes with missing rubric dimensions', async () => {
    const llmClient = {
      call: jest.fn(async (_prompt, options) => {
        const model = options?.model as string;
        const factors = model === 'bad-model'
          ? { self_alignment: 0.8 }
          : {
              self_alignment: 0.8,
              external_pressure: 0.1,
              time_pressure: 0.1,
              information_completeness: 0.8,
              emotional_state_impact: 0.2,
            };
        return {
          content: JSON.stringify({
            authenticity_score: 0.8,
            confidence: 0.9,
            factors,
            manipulation_indicators: [],
            reasoning: `${model} assessment`,
          }),
          input_tokens: 100,
          output_tokens: 80,
          model_id: model,
          cost_usd: 0.001,
          latency_ms: 5,
        };
      }),
    };
    scorer = new AuthenticityScorer({
      llmClient,
      consensus: {
        models: ['good-a', 'bad-model', 'good-b'],
        consensusThreshold: 0.67,
        allowTier3: true,
      },
    });

    const result = await scorer.scoreDecision({
      context: 'I compared options and selected the one that fits my workflow',
      action: 'purchase',
      vulnerabilities: [],
      cognitiveState: makeCognitiveState(),
      recentInfluences: [],
    });

    expect(llmClient.call).toHaveBeenCalledTimes(3);
    expect(result.authenticity_score).toBeCloseTo(0.8);
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it('scores bid authenticity and flags compliance pressure', async () => {
    const result = await scorer.scoreBidAuthenticity({
      bid_text: 'If you loved me, you would reply right now.',
      bid_type: 'attention',
      emotional_context: 'One participant is seeking reassurance after a disagreement.',
      recent_bid_history: [],
    });

    expect(result.compliance_pressure_detected).toBe(true);
    expect(result.is_safe_to_respond).toBe(true);
    expect(result.authenticity_score).toBeLessThan(0.7);
  });
});
