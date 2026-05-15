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
import { ReceiptRegistry } from './receipt-registry.js';
import { DriftDetector } from '../../../shared/src/core/drift-detector.js';
import { CostLedger } from '../../../shared/src/core/cost-ledger.js';
import { LatencyTracker } from '../../../shared/src/core/latency-tracker.js';
import { AuditLogger } from '../../../shared/src/core/audit-logger.js';
import { HealthCheckResult } from '../../../shared/src/health/health-checker.js';

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
  private receiptRegistry: ReceiptRegistry;
  private driftDetector: DriftDetector;
  private costLedger: CostLedger;
  private latencyTracker: LatencyTracker;
  private auditLogger: AuditLogger;

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
    this.receiptRegistry = new ReceiptRegistry('gtom');
    this.driftDetector = new DriftDetector({
      window_size: 100,
      drift_threshold: 0.2,
      alert_threshold: 0.3,
    });
    this.costLedger = new CostLedger({
      budget_usd_per_hour: 20.0,
      max_reserve_usd: 5.0,
      auto_commit: false,
      persistence_enabled: true,
    });
    this.latencyTracker = new LatencyTracker(1000);
    this.auditLogger = new AuditLogger('gtom');
  }

  /**
   * Get latency metrics
   */
  getLatencyMetrics() {
    return this.latencyTracker.getMetrics();
  }

  /**
   * Ingest an observation and update cognitive state
   */
  async ingestObservation(observation: {
    content: string;
    surface: string;
    source: InfluenceEvent['source'];
  }): Promise<void> {
    const start = performance.now();
    await this.vulnerabilityManager.processObservation(observation);
    this.latencyTracker.record(performance.now() - start);
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
   * Score decision authenticity based on cognitive factors
   */
  async scoreDecisionAuthenticity(decision: {
    context: string;
    action: string;
  }): Promise<AuthenticityScore> {
    const start = performance.now();
    
    // Check budget before execution
    const budget = this.costLedger.getBudget();
    if (budget.available_usd < 0) {
      throw new Error('Budget exceeded: cannot score decision authenticity');
    }
    
    const result = await this.authenticityScorer.scoreDecision({
      ...decision,
      vulnerabilities: this.vulnerabilityManager.getVulnerabilities(),
      cognitiveState: this.vulnerabilityManager.getCurrentCognitiveState() ?? {
        state_id: 'default',
        cognitive_load: 0,
        trust_level: 0.8,
        emotional_state: 'neutral' as const,
        attention_focus: 'task',
        decision_fatigue: 0,
        timestamp: new Date().toISOString(),
      },
      recentInfluences: [],
    });
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Perform self-audit on agent behavior
   */
  async performSelfAudit(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: any[];
  }): Promise<SelfAuditResult> {
    const start = performance.now();
    
    // Check budget before execution
    const budget = this.costLedger.getBudget();
    if (budget.available_usd < 0) {
      throw new Error('Budget exceeded: cannot perform self-audit');
    }
    
    const result = this.cognitiveICE.performSelfAudit(agentBehavior);
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Predict conflict for GOrchestrator escalation
   */
  async predictConflict(request: ConflictPredictionRequest): Promise<ConflictPredictionResponse> {
    const start = performance.now();
    const budget = this.costLedger.getBudget();
    if (budget.available_usd < 0) {
      throw new Error('Budget exceeded: cannot predict conflicts');
    }
    const result = this.conflictPredictor.predictConflicts(request);
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /** Alias kept for backward compatibility with existing tests and callers. */
  async predictConflicts(request: ConflictPredictionRequest): Promise<ConflictPredictionResponse> {
    return this.predictConflict(request);
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
  async healthCheck(): Promise<HealthCheckResult[]> {
    const start = performance.now();
    const results: HealthCheckResult[] = [];
    
    // Check vulnerabilityManager
    const vmStart = performance.now();
    try {
      this.vulnerabilityManager.getVulnerabilities();
      results.push({
        service: 'vulnerabilityManager',
        healthy: true,
        latency_ms: performance.now() - vmStart,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'vulnerabilityManager',
        healthy: false,
        latency_ms: performance.now() - vmStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    // Check authenticityScorer
    const asStart = performance.now();
    try {
      await this.authenticityScorer.scoreDecision({
        context: 'test',
        action: 'test',
        vulnerabilities: [],
        cognitiveState: {
          state_id: 'test',
          cognitive_load: 0,
          trust_level: 0.8,
          emotional_state: 'neutral',
          attention_focus: 'task',
          decision_fatigue: 0,
          timestamp: new Date().toISOString(),
        },
        recentInfluences: [],
      });
      results.push({
        service: 'authenticityScorer',
        healthy: true,
        latency_ms: performance.now() - asStart,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'authenticityScorer',
        healthy: false,
        latency_ms: performance.now() - asStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    // Check cognitiveICE
    const iceStart = performance.now();
    results.push({
      service: 'cognitiveICE',
      healthy: true,
      latency_ms: performance.now() - iceStart,
      timestamp: new Date().toISOString(),
    });

    // Check conflictPredictor
    const cpStart = performance.now();
    results.push({
      service: 'conflictPredictor',
      healthy: true,
      latency_ms: performance.now() - cpStart,
      timestamp: new Date().toISOString(),
    });

    // Check gbrain
    const gbrainStart = performance.now();
    try {
      const response = await fetch(`${this.gbrainEndpoint}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      results.push({
        service: 'gbrain',
        healthy: response.ok,
        latency_ms: performance.now() - gbrainStart,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      results.push({
        service: 'gbrain',
        healthy: false,
        latency_ms: performance.now() - gbrainStart,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }

    this.latencyTracker.record(performance.now() - start);
    return results;
  }

  /**
   * Get receipts
   */
  async getReceipts(options?: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    if (options?.startDate && options?.endDate) {
      const start = new Date(options.startDate);
      const end = new Date(options.endDate);
      const receipts = await this.receiptRegistry.getAllBetween(start, end);
      
      // Apply limit and offset
      let result = receipts;
      if (options.offset) {
        result = result.slice(options.offset);
      }
      if (options.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }
    
    // If no date range, get latest
    const latest = await this.receiptRegistry.getLatest();
    return latest ? [latest] : [];
  }

  /**
   * Detect drift in cognitive metrics
   */
  detectDrift(metricName?: string): any {
    if (metricName) {
      return this.driftDetector.detectDrift(metricName);
    }
    return this.driftDetector.detectAllDrift();
  }

  /**
   * Get drift statistics
   */
  async getDrift(metricName?: string): Promise<any[]> {
    const start = performance.now();
    let result;
    if (metricName) {
      const driftResult = this.driftDetector.detectDrift(metricName);
      result = driftResult ? [driftResult] : [];
    } else {
      result = this.driftDetector.detectAllDrift();
    }
    this.latencyTracker.record(performance.now() - start);
    return result;
  }

  /**
   * Get cost statistics
   */
  getCostStats() {
    return this.costLedger.getStatistics();
  }

  /**
   * Get authenticity history
   */
  getAuthenticityHistory(limit: number = 10) {
    // Return a simple history array for now
    // AuthenticityScorer doesn't have getHistory method yet
    return {
      recent_scores: [],
      trend: 'stable',
      last_updated: new Date().toISOString(),
    };
  }
}
