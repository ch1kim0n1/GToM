import { GToM } from '../src/core/gtom.js';
import { ConflictPredictionRequest } from '../src/types/index.js';

describe('GToM integration', () => {
  let gtom: GToM;

  beforeEach(() => {
    gtom = new GToM();
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
});
