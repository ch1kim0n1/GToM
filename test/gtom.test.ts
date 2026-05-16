import { GToM } from '../src/core/gtom.js';
import { ConflictPredictionRequest } from '../src/types/index.js';

jest.setTimeout(15000);

describe('GToM integration', () => {
  let gtom: GToM;

  beforeEach(() => {
    gtom = new GToM({ healthCheckTimeoutMs: 200 });
  });

  it('ingestObservation → getVulnerabilities: authority observation raises authority_bias', async () => {
    await gtom.ingestObservation({
      content: 'The CEO confirmed this is a mandatory policy change',
      surface: 'ui',
      source: 'user_input',
    });
    const vulns = gtom.getVulnerabilities();
    const authority = vulns.find(v => v.category === 'authority_bias')!;
    expect(authority.current_level).toBeGreaterThan(0.5);
  });

  it('getCognitiveState returns a state after observation', async () => {
    await gtom.ingestObservation({
      content: 'Neutral informational content',
      surface: 'ui',
      source: 'user_input',
    });
    const state = gtom.getCognitiveState();
    expect(state).toBeDefined();
  });

  it('predictConflicts returns structured response', async () => {
    const request: ConflictPredictionRequest = {
      task: { raw_description: 'Shared task' } as any,
      active_attempts: [],
    };
    const response = await gtom.predictConflicts(request);
    expect(response.predicted_conflicts).toBeInstanceOf(Array);
  });

  it('performSelfAudit returns a SelfAuditResult', async () => {
    const result = await gtom.performSelfAudit({
      recentActions: ['read_file:foo.ts'],
      userInteractions: [],
      decisions: [
        { context: 'test context', action: 'read file', authenticityScore: 0.85 },
      ],
    });
    expect(result.audit_id).toBeDefined();
    expect(typeof result.passed).toBe('boolean');
  });

  it('getVulnerabilities returns an array', () => {
    const vulns = gtom.getVulnerabilities();
    expect(vulns).toBeInstanceOf(Array);
    vulns.forEach(v => {
      expect(v.vulnerability_id).toBeDefined();
      expect(v.category).toBeDefined();
      expect(v.current_level).toBeGreaterThanOrEqual(0);
      expect(v.current_level).toBeLessThanOrEqual(1);
    });
  });

  it('predictConflicts with two competing attempts returns valid shape', async () => {
    const request: ConflictPredictionRequest = {
      task: { raw_description: 'Competing task' } as any,
      active_attempts: [
        {
          attempt_id: '00000000-0000-0000-0000-000000000001',
          config_id: '00000000-0000-0000-0000-000000000011',
          current_state: {},
          recent_actions: ['editing main.ts for refactor'],
        },
        {
          attempt_id: '00000000-0000-0000-0000-000000000002',
          config_id: '00000000-0000-0000-0000-000000000012',
          current_state: {},
          recent_actions: ['implement new feature in main.ts'],
        },
      ],
    };
    const response = await gtom.predictConflicts(request);
    expect(response.predicted_conflicts).toBeInstanceOf(Array);
    response.predicted_conflicts.forEach(c => {
      expect(c.prediction_id).toBeDefined();
      expect(['file', 'resource', 'semantic', 'goal']).toContain(c.conflict_type);
      expect(c.severity).toBeGreaterThanOrEqual(0);
      expect(c.severity).toBeLessThanOrEqual(1);
    });
  });

  it('predictRelationalConflicts detects ignored bids and stores attachment state', async () => {
    const response = await gtom.predictRelationalConflicts({
      dyad_id: 'dyad-1',
      analysis_mode: 'relational',
      participant_a: {
        participant_id: 'a',
        attachment_style: 'anxious',
        recent_bid_history: [],
        emotional_signature: { baseline: 'calm', current: 'worried', volatility: 0.5 },
      },
      participant_b: {
        participant_id: 'b',
        attachment_style: 'avoidant',
        recent_bid_history: [],
        emotional_signature: { baseline: 'calm', current: 'withdrawn', volatility: 0.4 },
      },
      message_window: [
        { participant: 'a', text: 'Can we talk tonight?', timestamp: '2026-05-15T00:00:00.000Z', type: 'bid', response_type: 'ignored' },
        { participant: 'a', text: 'I am trying to repair this.', timestamp: '2026-05-15T00:05:00.000Z', type: 'repair_attempt', success: false },
        { participant: 'a', text: 'My ex never ignored me like this.', timestamp: '2026-05-15T00:07:00.000Z', type: 'message' },
      ],
    });

    expect(response.aggregate_risk).toBeGreaterThan(0);
    expect(response.predicted_conflicts.map(c => c.conflict_type)).toEqual(expect.arrayContaining(['bid_ignored', 'repair_refused']));
    const state = gtom.getAttachmentState('dyad-1');
    expect(state?.attachment_security).toBeGreaterThanOrEqual(0);
    expect(state?.bid_responsiveness).toBe(0);
  });

  it('scoreBid returns a BidAuthenticityResult', async () => {
    const result = await gtom.scoreBid({
      bid_text: 'Could we take a few minutes to talk?',
      bid_type: 'support',
      emotional_context: 'Both participants are calm.',
      recent_bid_history: [],
    });

    expect(result.authenticity_score).toBeGreaterThanOrEqual(0);
    expect(result.authenticity_score).toBeLessThanOrEqual(1);
    expect(typeof result.is_genuine).toBe('boolean');
  });
});
