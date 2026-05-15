import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
import { ReceiptRegistry, type ReceiptRegistryOptions } from './receipt-registry.js';
import { DriftDetector } from './drift-detector.js';
import { BudgetLedger } from './budget-ledger.js';
import { LatencyTracker } from '../../../shared/src/core/latency-tracker.js';
import type { HealthCheckResult } from '../../../shared/src/health/health-checker.js';
import { LLMClient } from './llm-client.js';
import { globalObservability, type ShellJobAuditEntry } from './observability.js';

type GToMHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface GToMHealthCheckResult extends HealthCheckResult {
  status: GToMHealthStatus;
  score: number;
  details?: Record<string, unknown>;
}

interface HealthProbeOutcome {
  healthy: boolean;
  error?: string;
  details?: Record<string, unknown>;
  score?: number;
}

type HealthProbe = () => Promise<HealthProbeOutcome>;

interface HealthHistoryEntry {
  timestamp: string;
  score: number;
  status: GToMHealthStatus;
}

interface EvalCaptureFailure {
  timestamp: string;
  error: string;
}

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
  private budgetLedger: BudgetLedger;
  private latencyTracker: LatencyTracker;
  private observability = globalObservability;
  private healthHistory: HealthHistoryEntry[] = [];
  private evalCaptureFailures: EvalCaptureFailure[] = [];
  private lastHealthStatus: GToMHealthStatus | null = null;
  private readonly healthCheckTimeoutMs: number;
  private readonly syncFreshnessMaxMs: number;
  private readonly healthProbes: {
    llm?: HealthProbe;
    gbrain?: HealthProbe;
    sandbox?: HealthProbe;
  };

  constructor(config: {
    gbrainEndpoint?: string;
    healthCheckTimeoutMs?: number;
    syncFreshnessMaxMs?: number;
    receiptRegistryOptions?: ReceiptRegistryOptions;
    healthProbes?: {
      llm?: HealthProbe;
      gbrain?: HealthProbe;
      sandbox?: HealthProbe;
    };
  } = {}) {
    this.gbrainEndpoint = config.gbrainEndpoint || 'http://localhost:3000';
    this.healthCheckTimeoutMs = config.healthCheckTimeoutMs ?? Number(process.env.GTOM_HEALTH_TIMEOUT_MS ?? 2500);
    this.syncFreshnessMaxMs = config.syncFreshnessMaxMs ?? Number(process.env.GTOM_SYNC_FRESHNESS_MAX_MS ?? 7 * 24 * 60 * 60 * 1000);
    this.healthProbes = config.healthProbes ?? {};

    this.budgetLedger = new BudgetLedger({
      maxBudgetUsd: Number(process.env.GTOM_MAX_BUDGET_USD ?? 20),
      defaultTtlMs: Number(process.env.GTOM_BUDGET_TTL_MS ?? 30 * 60 * 1000),
      resolverCapsUsd: this.parseCaps(process.env.GTOM_RESOLVER_CAPS_USD),
      scopeCapsUsd: this.parseCaps(process.env.GTOM_SCOPE_CAPS_USD),
    }, 'gtom');
    const llmClient = new LLMClient({
      budgetLedger: this.budgetLedger,
      resolver: 'gtom',
      scope: 'cognitive-defense',
    });
    this.vulnerabilityManager = new VulnerabilityManager({
      gbrainEndpoint: this.gbrainEndpoint,
      llmClient,
    });

    this.authenticityScorer = new AuthenticityScorer({ llmClient });
    this.cognitiveICE = new CognitiveICE();
    this.conflictPredictor = new ConflictPredictor();
    this.receiptRegistry = new ReceiptRegistry('gtom', config.receiptRegistryOptions);
    this.driftDetector = new DriftDetector({
      window_size: 100,
      drift_threshold: 0.2,
      alert_threshold: 0.3,
    });
    this.latencyTracker = new LatencyTracker(1000);
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
    return this.observability.timeAsync('ingestObservation', async () => {
      const start = performance.now();
      await this.vulnerabilityManager.processObservation(observation);
      this.latencyTracker.record(performance.now() - start);
    }, { surface: observation.surface, source: observation.source });
  }

  /**
   * Get current vulnerability state
   */
  getVulnerabilities(): Vulnerability[] {
    return this.observability.timeSync('getVulnerabilities', () => this.vulnerabilityManager.getVulnerabilities());
  }

  /**
   * Get current cognitive state
   */
  getCognitiveState(): CognitiveState | undefined {
    return this.observability.timeSync('getCognitiveState', () => this.vulnerabilityManager.getCurrentCognitiveState());
  }

  /**
   * Get influence ledger
   */
  getInfluenceLedger(limit?: number): InfluenceEvent[] {
    return this.observability.timeSync('getInfluenceLedger', () => this.vulnerabilityManager.getInfluenceLedger(limit), { limit });
  }

  /**
   * Score decision authenticity based on cognitive factors
   */
  async scoreDecisionAuthenticity(decision: {
    context: string;
    action: string;
  }): Promise<AuthenticityScore> {
    return this.observability.timeAsync('scoreDecisionAuthenticity', async (span) => {
      const start = performance.now();
    
      // Check budget before execution
      const budget = this.budgetLedger.getStatus();
      if (budget.remaining_budget_usd < 0) {
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
      this.observability.audit.recordDecision({
        operation: 'scoreDecisionAuthenticity',
        decision_id: result.decision_id,
        score: result.authenticity_score,
        verdict: result.authenticity_score >= 0.6 ? 'pass' : result.authenticity_score >= 0.4 ? 'pass_with_warnings' : 'fail',
        trace_id: span.trace_id,
        span_id: span.span_id,
        metadata: { confidence: result.confidence },
      });
      return result;
    });
  }

  /**
   * Perform self-audit on agent behavior
   */
  async performSelfAudit(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: any[];
  }): Promise<SelfAuditResult> {
    return this.observability.timeAsync('performSelfAudit', async (span) => {
      const start = performance.now();
    
      // Check budget before execution
      const budget = this.budgetLedger.getStatus();
      if (budget.remaining_budget_usd < 0) {
        throw new Error('Budget exceeded: cannot perform self-audit');
      }
    
      const result = await this.cognitiveICE.performSelfAudit(agentBehavior);
      this.latencyTracker.record(performance.now() - start);
      this.observability.audit.recordDecision({
        operation: 'performSelfAudit',
        verdict: result.passed ? 'pass' : 'fail',
        trace_id: span.trace_id,
        span_id: span.span_id,
        metadata: { concerns: result.concerns.length },
      });
      return result;
    });
  }

  /**
   * Predict conflict for GOrchestrator escalation
   */
  async predictConflict(request: ConflictPredictionRequest): Promise<ConflictPredictionResponse> {
    return this.observability.timeAsync('predictConflict', async (span) => {
      const start = performance.now();
      const budget = this.budgetLedger.getStatus();
      if (budget.remaining_budget_usd < 0) {
        throw new Error('Budget exceeded: cannot predict conflicts');
      }
      const result = await this.conflictPredictor.predictConflicts(request);
      this.latencyTracker.record(performance.now() - start);
      this.observability.audit.recordDecision({
        operation: 'predictConflict',
        verdict: result.predicted_conflicts.length > 0 ? 'pass_with_warnings' : 'pass',
        trace_id: span.trace_id,
        span_id: span.span_id,
        metadata: { predicted_conflicts: result.predicted_conflicts.length },
      });
      return result;
    });
  }

  /** Alias kept for backward compatibility with existing tests and callers. */
  async predictConflicts(request: ConflictPredictionRequest): Promise<ConflictPredictionResponse> {
    return this.predictConflict(request);
  }

  /**
   * Get aggregate vulnerability score
   */
  getAggregateVulnerability() {
    return this.observability.timeSync('getAggregateVulnerability', () => this.vulnerabilityManager.calculateAggregateVulnerability());
  }

  /**
   * Reset vulnerability state
   */
  resetVulnerabilities(): void {
    this.observability.timeSync('resetVulnerabilities', () => this.vulnerabilityManager.resetToBaseline());
  }

  /**
   * Decay vulnerabilities over time
   */
  decayVulnerabilities(hours: number = 24): void {
    this.observability.timeSync('decayVulnerabilities', () => this.vulnerabilityManager.decayVulnerabilities(hours), { hours });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<GToMHealthCheckResult[]> {
    const start = performance.now();
    const span = this.observability.tracer.startSpan('healthCheck', { gbrain_endpoint: this.gbrainEndpoint });
    this.observability.metrics.recordThroughput('healthCheck');
    const results: GToMHealthCheckResult[] = [];
    
    // Check vulnerabilityManager
    const vmStart = performance.now();
    try {
      this.vulnerabilityManager.getVulnerabilities();
      results.push(this.createHealthResult('vulnerabilityManager', true, vmStart));
    } catch (error) {
      results.push(this.createHealthResult('vulnerabilityManager', false, vmStart, undefined, error));
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
      results.push(this.createHealthResult('authenticityScorer', true, asStart));
    } catch (error) {
      results.push(this.createHealthResult('authenticityScorer', false, asStart, undefined, error));
    }

    // Check cognitiveICE
    const iceStart = performance.now();
    try {
      const audit = await this.cognitiveICE.performSelfAudit({
        recentActions: ['health_check'],
        userInteractions: [],
        decisions: [],
      });
      results.push(this.createHealthResult('cognitiveICE', typeof audit.passed === 'boolean', iceStart));
    } catch (error) {
      results.push(this.createHealthResult('cognitiveICE', false, iceStart, undefined, error));
    }

    // Check conflictPredictor
    const cpStart = performance.now();
    try {
      const prediction = await this.conflictPredictor.predictConflicts({
        task: { raw_description: 'health check' } as any,
        active_attempts: [],
      });
      results.push(this.createHealthResult(
        'conflictPredictor',
        Array.isArray(prediction.predicted_conflicts),
        cpStart,
        { predicted_conflicts: prediction.predicted_conflicts.length },
      ));
    } catch (error) {
      results.push(this.createHealthResult('conflictPredictor', false, cpStart, undefined, error));
    }

    results.push(await this.runProbe('llm_api', () => this.probeLLMApi()));

    // Check gbrain
    results.push(await this.runProbe('gbrain', () => this.probeGbrain()));
    results.push(await this.runProbe('sandbox', () => this.probeSandbox()));
    results.push(await this.checkSyncFreshness());
    results.push(await this.checkSchemaVersion());
    results.push(this.checkQueueHealth());
    results.push(await this.checkEvalCaptureFailures());

    const overall = this.calculateOverallHealth(results);
    this.recordHealthSnapshot(overall.score, overall.status);
    await this.alertOnHealthDrop(overall.status, overall.score, results, span.trace_id);
    results.push(this.checkHealthTrend());
    results.push({
      service: 'overall_health',
      healthy: overall.status !== 'unhealthy',
      status: overall.status,
      score: overall.score,
      latency_ms: performance.now() - start,
      timestamp: new Date().toISOString(),
      details: overall.details,
    });

    this.latencyTracker.record(performance.now() - start);
    this.observability.metrics.recordLatency('healthCheck', performance.now() - start);
    this.observability.tracer.endSpan(span);
    return results;
  }

  recordEvalCaptureFailure(error: string, timestamp: string = new Date().toISOString()): void {
    this.evalCaptureFailures.push({ timestamp, error });
    this.pruneEvalCaptureFailures();
  }

  private createHealthResult(
    service: string,
    healthy: boolean,
    startTime: number,
    details?: Record<string, unknown>,
    error?: unknown,
    score?: number,
  ): GToMHealthCheckResult {
    const normalizedScore = score ?? (healthy ? 1 : 0);
    return {
      service,
      healthy,
      status: this.statusFromScore(normalizedScore),
      score: normalizedScore,
      latency_ms: performance.now() - startTime,
      error: healthy ? undefined : this.errorMessage(error),
      timestamp: new Date().toISOString(),
      details,
    };
  }

  private async runProbe(service: string, fallback: HealthProbe): Promise<GToMHealthCheckResult> {
    const probe = this.healthProbes[service === 'llm_api' ? 'llm' : service as 'gbrain' | 'sandbox'] ?? fallback;
    const start = performance.now();
    try {
      const result = await probe();
      return this.createHealthResult(service, result.healthy, start, result.details, result.error, result.score);
    } catch (error) {
      return this.createHealthResult(service, false, start, undefined, error);
    }
  }

  private async probeLLMApi(): Promise<HealthProbeOutcome> {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!anthropicKey && !openaiKey) {
      return {
        healthy: true,
        score: 0.7,
        details: { mode: 'local_fallback', remote_probe: 'skipped_no_api_key' },
      };
    }

    if (openaiKey) {
      return this.fetchProbe('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${openaiKey}` },
      }, { provider: 'openai', cheap_probe: 'models' });
    }

    const apiKey = anthropicKey ?? '';
    return this.fetchProbe('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    }, { provider: 'anthropic', cheap_probe: 'one_token_message' });
  }

  private async probeGbrain(): Promise<HealthProbeOutcome> {
    const span = this.observability.tracer.startSpan('gbrain.health_probe', { boundary: 'gbrain' });
    try {
      const result = await this.fetchProbe(`${this.gbrainEndpoint}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-GToM-Trace-Id': span.trace_id,
          traceparent: `00-${span.trace_id.replace(/-/g, '').slice(0, 32).padEnd(32, '0')}-${span.span_id.replace(/-/g, '').slice(0, 16).padEnd(16, '0')}-01`,
        },
      }, { endpoint: this.gbrainEndpoint, timeout_ms: this.healthCheckTimeoutMs, trace_id: span.trace_id });
      this.observability.tracer.endSpan(span);
      return result;
    } catch (error) {
      this.observability.tracer.endSpan(span, error);
      throw error;
    }
  }

  private async fetchProbe(url: string, init: RequestInit, details: Record<string, unknown>): Promise<HealthProbeOutcome> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
    });
    return {
      healthy: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      details: {
        ...details,
        http_status: response.status,
      },
    };
  }

  private async probeSandbox(): Promise<HealthProbeOutcome> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gtom-sandbox-'));
    const probePath = path.join(dir, 'probe.txt');
    try {
      await fs.writeFile(probePath, 'ok', 'utf8');
      const content = await fs.readFile(probePath, 'utf8');
      return {
        healthy: content === 'ok',
        details: { writable_tmp: true, root: os.tmpdir() },
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  private async checkSyncFreshness(): Promise<GToMHealthCheckResult> {
    const start = performance.now();
    try {
      const latest = await this.receiptRegistry.getLatest();
      if (!latest) {
        return this.createHealthResult('sync_freshness', false, start, { latest_receipt_timestamp: null }, 'No receipts recorded');
      }
      const ageMs = Date.now() - new Date(latest.timestamp).getTime();
      const healthy = ageMs <= this.syncFreshnessMaxMs;
      return this.createHealthResult('sync_freshness', healthy, start, {
        latest_receipt_timestamp: latest.timestamp,
        age_ms: ageMs,
        max_age_ms: this.syncFreshnessMaxMs,
      }, healthy ? undefined : `Latest receipt is ${ageMs}ms old`);
    } catch (error) {
      return this.createHealthResult('sync_freshness', false, start, undefined, error);
    }
  }

  private async checkSchemaVersion(): Promise<GToMHealthCheckResult> {
    const start = performance.now();
    try {
      const schema = await this.receiptRegistry.getSchemaMetadata();
      const healthy = schema.version === schema.current_schema_version;
      return this.createHealthResult('schema_version', healthy, start, schema as unknown as Record<string, unknown>, healthy ? undefined : 'Receipt schema version mismatch');
    } catch (error) {
      return this.createHealthResult('schema_version', false, start, undefined, error);
    }
  }

  private checkQueueHealth(): GToMHealthCheckResult {
    const start = performance.now();
    const budget = this.budgetLedger.getStatus();
    const receiptAppendQueueDepth = this.receiptRegistry.getAppendQueueDepth();
    const maxPending = Number(process.env.GTOM_HEALTH_MAX_PENDING_QUEUE ?? 100);
    const pending = budget.active_reservations + receiptAppendQueueDepth;
    return this.createHealthResult('queue_health', pending <= maxPending, start, {
      pending,
      max_pending: maxPending,
      active_budget_reservations: budget.active_reservations,
      receipt_append_queue_depth: receiptAppendQueueDepth,
    }, pending <= maxPending ? undefined : `Pending queue depth ${pending} exceeds ${maxPending}`);
  }

  private async checkEvalCaptureFailures(): Promise<GToMHealthCheckResult> {
    const start = performance.now();
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.pruneEvalCaptureFailures();
      const receipts = await this.receiptRegistry.getAllSince(new Date(cutoff));
      const receiptFailures = receipts
        .filter((receipt) => {
          const metadata = receipt.metadata ?? {};
          return metadata.eval_capture_failed === true || metadata.eval_capture_status === 'failed';
        })
        .map((receipt) => ({
          timestamp: receipt.timestamp,
          receipt_id: receipt.receipt_id,
          error: String(receipt.metadata?.eval_capture_error ?? 'eval_capture failed'),
        }));
      const failures = [...this.evalCaptureFailures, ...receiptFailures];
      return this.createHealthResult('eval_capture', failures.length === 0, start, {
        failures_last_24h: failures.length,
        failures,
      }, failures.length === 0 ? undefined : `${failures.length} eval_capture failure(s) in the last 24h`);
    } catch (error) {
      return this.createHealthResult('eval_capture', false, start, undefined, error);
    }
  }

  private checkHealthTrend(): GToMHealthCheckResult {
    const start = performance.now();
    const now = Date.now();
    const trend24h = this.summarizeHealthWindow(now - 24 * 60 * 60 * 1000);
    const trend7d = this.summarizeHealthWindow(now - 7 * 24 * 60 * 60 * 1000);
    const healthy = trend24h.unhealthy_count === 0;
    return this.createHealthResult('health_trend', healthy, start, {
      last_24h: trend24h,
      last_7d: trend7d,
    }, healthy ? undefined : `${trend24h.unhealthy_count} unhealthy health snapshots in the last 24h`, trend24h.average_score);
  }

  private summarizeHealthWindow(cutoffMs: number): { samples: number; average_score: number; unhealthy_count: number; degraded_count: number } {
    const samples = this.healthHistory.filter((entry) => new Date(entry.timestamp).getTime() >= cutoffMs);
    const average = samples.length === 0
      ? 1
      : samples.reduce((sum, entry) => sum + entry.score, 0) / samples.length;
    return {
      samples: samples.length,
      average_score: Number(average.toFixed(4)),
      unhealthy_count: samples.filter((entry) => entry.status === 'unhealthy').length,
      degraded_count: samples.filter((entry) => entry.status === 'degraded').length,
    };
  }

  private calculateOverallHealth(results: GToMHealthCheckResult[]): {
    score: number;
    status: GToMHealthStatus;
    details: Record<string, unknown>;
  } {
    const weights: Record<string, number> = {
      vulnerabilityManager: 0.08,
      authenticityScorer: 0.08,
      cognitiveICE: 0.06,
      conflictPredictor: 0.06,
      llm_api: 0.14,
      gbrain: 0.12,
      sandbox: 0.1,
      sync_freshness: 0.1,
      schema_version: 0.1,
      queue_health: 0.08,
      eval_capture: 0.08,
    };
    const weightedScore = results.reduce((sum, result) => sum + (weights[result.service] ?? 0) * result.score, 0);
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    const score = totalWeight === 0 ? 0 : Number((weightedScore / totalWeight).toFixed(4));
    return {
      score,
      status: this.statusFromScore(score),
      details: {
        formula: 'weighted_component_score',
        weights,
        failed_services: results.filter((result) => !result.healthy).map((result) => result.service),
      },
    };
  }

  private statusFromScore(score: number): GToMHealthStatus {
    if (score >= 0.9) return 'healthy';
    if (score >= 0.7) return 'degraded';
    return 'unhealthy';
  }

  private recordHealthSnapshot(score: number, status: GToMHealthStatus): void {
    this.healthHistory.push({
      timestamp: new Date().toISOString(),
      score,
      status,
    });
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.healthHistory = this.healthHistory.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
  }

  private pruneEvalCaptureFailures(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.evalCaptureFailures = this.evalCaptureFailures.filter((failure) => new Date(failure.timestamp).getTime() >= cutoff);
  }

  private errorMessage(error: unknown): string | undefined {
    if (error === undefined) return undefined;
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Get receipts
   */
  async getReceipts(options?: {
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    corpusSha8?: string;
  }): Promise<any[]> {
    return this.observability.timeAsync('getReceipts', async () => {
      if (options?.corpusSha8) {
      let result = await this.receiptRegistry.getByCorpusSha8(options.corpusSha8);
      if (options.startDate) {
        const start = new Date(options.startDate);
        result = result.filter((receipt) => new Date(receipt.timestamp) >= start);
      }
      if (options.endDate) {
        const end = new Date(options.endDate);
        result = result.filter((receipt) => new Date(receipt.timestamp) <= end);
      }
      if (options.offset) result = result.slice(options.offset);
      if (options.limit) result = result.slice(0, options.limit);
      return result;
      }

      if (options?.startDate || options?.endDate) {
      const start = options.startDate ? new Date(options.startDate) : new Date(0);
      const end = options.endDate ? new Date(options.endDate) : new Date();
      let result = await this.receiptRegistry.getAllBetween(start, end);
      if (options.offset) result = result.slice(options.offset);
      if (options.limit) result = result.slice(0, options.limit);
      return result;
      }
    
      // If no date range, get latest
      const latest = await this.receiptRegistry.getLatest();
      return latest ? [latest] : [];
    }, {
      has_date_range: Boolean(options?.startDate || options?.endDate),
      corpus_sha8: options?.corpusSha8,
      limit: options?.limit,
    });
  }

  /**
   * Detect drift in cognitive metrics
   */
  detectDrift(metricName?: string): any {
    return this.observability.timeSync('detectDrift', () => {
      if (metricName) {
        return this.driftDetector.detectDrift(metricName);
      }
      return this.driftDetector.detectAllDrift();
    }, { metric_name: metricName });
  }

  /**
   * Get drift statistics
   */
  async getDrift(metricName?: string): Promise<any[]> {
    return this.observability.timeAsync('getDrift', async () => {
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
    }, { metric_name: metricName });
  }

  /**
   * Get cost statistics
   */
  getCostStats() {
    return this.observability.timeSync('getCostStats', () => this.budgetLedger.getSummary());
  }

  /**
   * Get authenticity history
   */
  getAuthenticityHistory(limit: number = 10) {
    return this.observability.timeSync('getAuthenticityHistory', () => ({
      recent_scores: [],
      trend: 'stable',
      last_updated: new Date().toISOString(),
    }), { limit });
  }

  getObservabilitySnapshot(): Record<string, unknown> {
    return this.observability.snapshot();
  }

  exportMetrics(format: 'prometheus' | 'otel' | 'json' = 'json'): string | Record<string, unknown> {
    if (format === 'prometheus') return this.observability.metrics.exportPrometheus();
    if (format === 'otel') return this.observability.metrics.exportOpenTelemetry();
    return this.observability.metrics.getSnapshot();
  }

  recordShellJobAudit(entry: ShellJobAuditEntry): void {
    this.observability.audit.recordShellJob(entry);
  }

  private async alertOnHealthDrop(
    status: GToMHealthStatus,
    score: number,
    checks: GToMHealthCheckResult[],
    traceId: string,
  ): Promise<void> {
    const webhookUrl = process.env.GTOM_HEALTH_WEBHOOK_URL;
    const priorStatus = this.lastHealthStatus;
    this.lastHealthStatus = status;
    if (!webhookUrl || status === 'healthy' || priorStatus === status) {
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: 'gtom',
          status,
          score,
          trace_id: traceId,
          timestamp: new Date().toISOString(),
          failed_services: checks.filter((check) => !check.healthy).map((check) => check.service),
        }),
        signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
      });
      this.observability.metrics.incrementCounter('gtom_health_alerts_total');
    } catch (error) {
      this.observability.metrics.recordError('healthAlertWebhook');
      this.observability.logger.warn('Health alert webhook failed', { error, status, score });
    }
  }

  private parseCaps(value: string | undefined): Record<string, number> {
    if (!value) return {};
    const caps: Record<string, number> = {};
    for (const segment of value.split(',')) {
      const [key, rawAmount] = segment.split(':');
      const amount = Number(rawAmount);
      if (key && Number.isFinite(amount) && amount >= 0) {
        caps[key.trim()] = amount;
      }
    }
    return caps;
  }
}
