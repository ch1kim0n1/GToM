// GToM/test/e2e.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { VulnerabilityManager } from '../src/core/vulnerability';
import { AuthenticityScorer } from '../src/core/authenticity';
import { GToM } from '../src/core/gtom';

describe('GToM E2E (mocked)', () => {
  let vulnerabilityManager: VulnerabilityManager;
  let authenticityScorer: AuthenticityScorer;
  let gtom: GToM;

  beforeEach(() => {
    vulnerabilityManager = new VulnerabilityManager();
    authenticityScorer = new AuthenticityScorer();
    gtom = new GToM();
  });

  it('initializes GToM with components', () => {
    expect(gtom).toBeDefined();
    expect(vulnerabilityManager).toBeDefined();
    expect(authenticityScorer).toBeDefined();
  });

  it('processes observation and updates vulnerability', async () => {
    await vulnerabilityManager.processObservation({
      content: 'This is expert advice',
      surface: 'notification',
      source: 'user_input'
    });

    const vulnerabilities = vulnerabilityManager.getVulnerabilities();
    const authority = vulnerabilities.find((v: any) => v.category === 'authority_bias');
    expect(authority).toBeDefined();
    expect(authority?.current_level).toBeGreaterThan(0.5);
  });

  it('scores decision authenticity with clean context', async () => {
    const decision = {
      context: 'User wants to buy product',
      action: 'purchase',
      vulnerabilities: [],
      cognitiveState: {
        timestamp: new Date().toISOString(),
        state_id: 'test-state',
        trust_level: 0.7,
        cognitive_load: 0.3,
        emotional_state: 'neutral' as const,
        attention_focus: 'purchase',
        decision_fatigue: 0.2
      },
      recentInfluences: []
    };

    const score = await authenticityScorer.scoreDecision(decision);
    expect(score.authenticity_score).toBeGreaterThan(0.5);
    expect(score.manipulation_indicators).toHaveLength(0);
  });

  it('full flow: observe, track vulnerability', async () => {
    // Process observation
    await vulnerabilityManager.processObservation({
      content: 'Only 2 left! Limited time offer!',
      surface: 'notification',
      source: 'external_signal'
    });

    // Get current vulnerabilities
    const vulnerabilities = vulnerabilityManager.getVulnerabilities();
    expect(vulnerabilities).toBeDefined();
    expect(vulnerabilities.length).toBeGreaterThan(0);
  });
});
