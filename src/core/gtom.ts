import { v4 as uuidv4 } from 'uuid';
import {
  Observation,
  InfluenceEvent,
  Vulnerability,
  CognitiveState,
  AuthenticityScore,
  SelfAuditResult,
  ConflictPredictionRequest,
  ConflictPredictionResponse,
} from '../types/index.js';
import { VulnerabilityManager } from './vulnerability.js';
import { AuthenticityScorer } from './authenticity.js';
import { CognitiveICE } from './ice.js';
import { ConflictPredictor } from './conflict-predictor.js';

/**
 * Main GToM
 * 
 * Ties together all components:
 * - Observation ingestion
 * - Influence exposure tracking
 * - Vulnerability state management
 * - Manipulation detection
 * - Decision authenticity scoring
 * - Self-audit (ICE)
 * - Conflict prediction for GOrchestrator
 */
export class GToM {
  private vulnerabilityManager: VulnerabilityManager;
  private authenticityScorer: AuthenticityScorer;
  private cognitiveICE: CognitiveICE;
  private conflictPredictor: ConflictPredictor;
  private gbrainEndpoint: string;

  constructor(config: {
    gbrainEndpoint?: string;
  } = {}) {
    this.gbrainEndpoint = config.gbrainEndpoint || 'http://localhost:3000';

    this.vulnerabilityManager = new VulnerabilityManager({
      gbrainEndpoint: this.gbrainEndpoint,
    });

    this.authenticityScorer = new AuthenticityScorer();
    this.cognitiveICE = new CognitiveICE();
    this.conflictPredictor = new ConflictPredictor();
  }

  /**
   * Ingest an observation and update cognitive state
   */
  async ingestObservation(observation: {
    content: string;
    surface: string;
    source: InfluenceEvent['source'];
  }): Promise<void> {
    await this.vulnerabilityManager.processObservation(observation);
  }

  /**
   * Get current vulnerability state
   */
  getVulnerabilities(): Vulnerability[] {
    return this.vulnerabilityManager.getVulnerabilities();
  }

  /**
   * Get current cognitive state
   */
  getCognitiveState(): CognitiveState | undefined {
    return this.vulnerabilityManager.getCurrentCognitiveState();
  }

  /**
   * Get influence ledger
   */
  getInfluenceLedger(limit?: number): InfluenceEvent[] {
    return this.vulnerabilityManager.getInfluenceLedger(limit);
  }

  /**
   * Score decision authenticity
   */
  async scoreDecisionAuthenticity(decision: {
    context: string;
    action: string;
  }): Promise<AuthenticityScore> {
    const vulnerabilities = this.vulnerabilityManager.getVulnerabilities();
    const cognitiveState = this.vulnerabilityManager.getCurrentCognitiveState();
    const recentInfluences = this.vulnerabilityManager.getInfluenceLedger(10).map(
      e => e.detected_pattern
    );

    return this.authenticityScorer.scoreDecision({
      context: decision.context,
      action: decision.action,
      vulnerabilities,
      cognitiveState: cognitiveState || {
        state_id: uuidv4(),
        timestamp: new Date().toISOString(),
        trust_level: 0.5,
        cognitive_load: 0.3,
        emotional_state: 'neutral',
        attention_focus: 'unknown',
        decision_fatigue: 0,
      },
      recentInfluences,
    });
  }

  /**
   * Perform self-audit
   */
  async performSelfAudit(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: Array<{
      context: string;
      action: string;
      authenticityScore: number;
    }>;
  }): Promise<SelfAuditResult> {
    return await this.cognitiveICE.performSelfAudit(agentBehavior);
  }

  /**
   * Predict conflicts for GOrchestrator
   */
  async predictConflicts(request: ConflictPredictionRequest): Promise<ConflictPredictionResponse> {
    return await this.conflictPredictor.predictConflicts(request);
  }

  /**
   * Get aggregate vulnerability score
   */
  getAggregateVulnerability() {
    return this.vulnerabilityManager.calculateAggregateVulnerability();
  }

  /**
   * Reset vulnerability state
   */
  resetVulnerabilities(): void {
    this.vulnerabilityManager.resetToBaseline();
  }

  /**
   * Decay vulnerabilities over time
   */
  decayVulnerabilities(hours: number = 24): void {
    this.vulnerabilityManager.decayVulnerabilities(hours);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    components: {
      vulnerability_manager: 'ok' | 'error';
      authenticity_scorer: 'ok' | 'error';
      cognitive_ice: 'ok' | 'error';
      conflict_predictor: 'ok' | 'error';
      gbrain: 'ok' | 'error';
    };
  }> {
    const checks = {
      vulnerability_manager: 'ok' as const,
      authenticity_scorer: 'ok' as const,
      cognitive_ice: 'ok' as const,
      conflict_predictor: 'ok' as const,
      gbrain: await this.checkGBrain(),
    };

    const errorCount = Object.values(checks).filter(v => v === 'error').length;
    const status = errorCount === 0 ? 'healthy' : errorCount < 3 ? 'degraded' : 'unhealthy';

    return { status, components: checks };
  }

  private async checkGBrain(): Promise<'ok' | 'error'> {
    try {
      const response = await fetch(`${this.gbrainEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });
      return response.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
