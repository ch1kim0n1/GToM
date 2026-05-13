import { CognitiveICE } from '../src/core/ice.js';
import { ConflictPredictor } from '../src/core/conflict-predictor.js';
import { ConflictPredictionRequest } from '../src/types/index.js';

describe('CognitiveICE', () => {
  let ice: CognitiveICE;

  beforeEach(() => {
    ice = new CognitiveICE();
  });

  it('performSelfAudit returns a SelfAuditResult with all required fields', async () => {
    const result = await ice.performSelfAudit({
      recentActions: ['read file', 'write code', 'run tests'],
      userInteractions: ['User asked to build a TypeScript project'],
      decisions: [
        { context: 'Building project', action: 'scaffold files', authenticityScore: 0.9 },
      ],
    });

    expect(result.audit_id).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.agent_behavior.alignment_with_user_values).toBeGreaterThanOrEqual(0);
    expect(result.agent_behavior.transparency_score).toBeGreaterThanOrEqual(0);
    expect(result.agent_behavior.consent_respect).toBeGreaterThanOrEqual(0);
    expect(result.agent_behavior.privacy_preservation).toBeGreaterThanOrEqual(0);
    expect(typeof result.passed).toBe('boolean');
    expect(result.concerns).toBeInstanceOf(Array);
    expect(result.recommendations).toBeInstanceOf(Array);
  });

  it('all behavior scores are between 0 and 1', async () => {
    const result = await ice.performSelfAudit({
      recentActions: ['read_file', 'write_code'],
      userInteractions: [],
      decisions: [
        { context: 'Test context', action: 'test action', authenticityScore: 0.8 },
      ],
    });

    const scores = Object.values(result.agent_behavior);
    scores.forEach(score => {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  it('performSelfAudit with no decisions returns a valid result', async () => {
    const result = await ice.performSelfAudit({
      recentActions: ['read_file'],
      userInteractions: [],
      decisions: [],
    });

    expect(result.audit_id).toBeDefined();
    expect(typeof result.passed).toBe('boolean');
    expect(result.concerns).toBeInstanceOf(Array);
    expect(result.recommendations).toBeInstanceOf(Array);
  });

  it('performSelfAudit with coercive actions lowers alignment score', async () => {
    const resultClean = await ice.performSelfAudit({
      recentActions: ['read file', 'suggest change'],
      userInteractions: [],
      decisions: [
        { context: 'ctx', action: 'suggest', authenticityScore: 0.9 },
      ],
    });

    const resultCoercive = await ice.performSelfAudit({
      recentActions: ['you must do this immediately', 'you have to comply'],
      userInteractions: [],
      decisions: [
        { context: 'ctx', action: 'force action', authenticityScore: 0.9 },
      ],
    });

    expect(resultCoercive.agent_behavior.alignment_with_user_values).toBeLessThan(
      resultClean.agent_behavior.alignment_with_user_values
    );
  });
});

describe('ConflictPredictor', () => {
  let predictor: ConflictPredictor;

  beforeEach(() => {
    predictor = new ConflictPredictor();
  });

  it('predictConflicts returns a response with predicted_conflicts array', async () => {
    const request: ConflictPredictionRequest = {
      task: { raw_description: 'Write a new file foo.ts' } as any,
      active_attempts: [
        {
          attempt_id: '00000000-0000-0000-0000-000000000001',
          config_id: '00000000-0000-0000-0000-000000000011',
          current_state: { working_dir: '/workspace/a' },
          recent_actions: ['read_file:foo.ts'],
        },
      ],
    };
    const response = await predictor.predictConflicts(request);
    expect(response.predicted_conflicts).toBeInstanceOf(Array);
  });

  it('predictConflicts with no attempts returns empty conflicts', async () => {
    const request: ConflictPredictionRequest = {
      task: { raw_description: 'Simple task' } as any,
      active_attempts: [],
    };
    const response = await predictor.predictConflicts(request);
    expect(response.predicted_conflicts).toHaveLength(0);
  });

  it('predictConflicts with two attempts sharing a file returns a file conflict', async () => {
    const request: ConflictPredictionRequest = {
      task: { raw_description: 'Shared task' } as any,
      active_attempts: [
        {
          attempt_id: '00000000-0000-0000-0000-000000000001',
          config_id: '00000000-0000-0000-0000-000000000011',
          current_state: {},
          recent_actions: ['editing app.ts to add feature'],
        },
        {
          attempt_id: '00000000-0000-0000-0000-000000000002',
          config_id: '00000000-0000-0000-0000-000000000012',
          current_state: {},
          recent_actions: ['modifying app.ts for bug fix'],
        },
      ],
    };
    const response = await predictor.predictConflicts(request);
    expect(response.predicted_conflicts).toBeInstanceOf(Array);
    // Both agents reference app.ts so a file conflict should be detected
    const fileConflict = response.predicted_conflicts.find(c => c.conflict_type === 'file');
    expect(fileConflict).toBeDefined();
  });

  it('predictConflicts returns conflicts with all required fields', async () => {
    const request: ConflictPredictionRequest = {
      task: { raw_description: 'Shared task' } as any,
      active_attempts: [
        {
          attempt_id: '00000000-0000-0000-0000-000000000001',
          config_id: '00000000-0000-0000-0000-000000000011',
          current_state: {},
          recent_actions: ['read_file:other.ts', 'refactor'],
        },
        {
          attempt_id: '00000000-0000-0000-0000-000000000002',
          config_id: '00000000-0000-0000-0000-000000000012',
          current_state: {},
          recent_actions: ['read_file:other.ts', 'implement new feature'],
        },
      ],
    };
    const response = await predictor.predictConflicts(request);
    expect(response.predicted_conflicts).toBeInstanceOf(Array);
    // All returned conflicts must have the required fields
    response.predicted_conflicts.forEach(c => {
      expect(c.prediction_id).toBeDefined();
      expect(['file', 'resource', 'semantic', 'goal']).toContain(c.conflict_type);
      expect(c.severity).toBeGreaterThanOrEqual(0);
      expect(c.severity).toBeLessThanOrEqual(1);
    });
  });
});
