import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import {
  AuthenticityScore,
  Decision,
  Vulnerability,
  CognitiveState,
  BidAuthenticityInput,
  BidAuthenticityResult,
  BidAuthenticityResultSchema,
} from '../types/index.js';
import { ReceiptRegistry } from './receipt-registry.js';
import { GTOM_RUBRIC_V1, authenticityToLevel, getRubricHash } from './gtom-rubric.js';
import { ExecutionReceipt } from '../types/quality-rubric.js';
import { LLMClient, LLMCallResult } from './llm-client.js';
import { globalObservability } from './observability.js';
import { API_STABILITY, CURRENT_RECEIPT_SCHEMA_VERSION } from './versioning.js';

type DecisionInput = {
  context: string;
  action: string;
  vulnerabilities: Vulnerability[];
  cognitiveState: CognitiveState;
  recentInfluences: string[];
};

interface LLMCaller {
  call(prompt: string, options?: { model?: string; maxTokens?: number; temperature?: number }): Promise<LLMCallResult>;
}

interface LLMAuthenticityAssessment {
  authenticity_score: number;
  confidence: number;
  factors: {
    self_alignment: number;
    external_pressure: number;
    time_pressure: number;
    information_completeness: number;
    emotional_state_impact: number;
  };
  manipulation_indicators: string[];
  reasoning: string;
  model_id: string;
  cost_usd: number;
}

interface ConsensusConfig {
  models: string[];
  consensusThreshold: number;
  allowTier3: boolean;
  enableEarlyStopping: boolean;
  dimensionAgreementTolerance: number;
  minModelsForConsensus: number;
}

interface ConsensusAssessment extends LLMAuthenticityAssessment {
  models_used: string[];
  consensus: {
    votes: Array<{
      model_id: string;
      verdict: 'pass' | 'pass_with_warnings' | 'fail';
      authenticity_score: number;
      confidence: number;
      cost_usd: number;
    }>;
    disqualified_models: Array<{ model_id: string; reason: string }>;
    consensus_threshold: number;
    required_agreeing_models: number;
    agreed: boolean;
    winning_verdict: 'pass' | 'pass_with_warnings' | 'fail';
    agreement_rate: number;
    per_dimension_agreement: Record<string, number>;
    wilson_95_ci: { lower: number; upper: number };
    small_sample_note: boolean;
    early_stopped: boolean;
    tier3_invoked: boolean;
  };
}

/**
 * Authenticity Scorer
 * 
 * Responsibilities:
 * - Score decision authenticity based on cognitive factors
 * - Detect manipulation indicators
 * - Evaluate self-alignment vs. external pressure
 * - Provide confidence scores
 */
export class AuthenticityScorer {
  private receiptRegistry: ReceiptRegistry;
  private llmClient: LLMCaller;
  private consensusConfig: ConsensusConfig;

  constructor(config: {
    llmClient?: LLMCaller;
    consensus?: Partial<ConsensusConfig>;
  } = {}) {
    this.receiptRegistry = new ReceiptRegistry('gtom');
    this.llmClient = config.llmClient ?? new LLMClient();
    this.consensusConfig = {
      models: config.consensus?.models ?? ['claude-sonnet-4-6', 'gpt-4o', 'claude-opus-4-7'],
      consensusThreshold: config.consensus?.consensusThreshold ?? Number(process.env.GTOM_CONSENSUS_THRESHOLD ?? 0.67),
      allowTier3: config.consensus?.allowTier3 ?? process.env.GTOM_ALLOW_TIER3 !== 'false',
      enableEarlyStopping: config.consensus?.enableEarlyStopping ?? true,
      dimensionAgreementTolerance: config.consensus?.dimensionAgreementTolerance ?? 0.15,
      minModelsForConsensus: config.consensus?.minModelsForConsensus ?? 2,
    };
  }

  /**
   * Score a decision for authenticity
   */
  async scoreDecision(decision: DecisionInput): Promise<AuthenticityScore> {
    const assessment = await this.evaluateWithConsensus(decision).catch((error) => {
      globalObservability.logger.warn('LLM authenticity assessment failed, using local safety fallback', { error });
      const fallback = this.evaluateWithLocalFallback(decision);
      return {
        ...fallback,
        models_used: [fallback.model_id],
        consensus: this.buildFallbackConsensus(fallback),
      };
    });

    const scoreId = uuidv4();
    const decisionId = uuidv4();

    // Emit execution receipt for quality tracking (fire-and-forget).
    const receipt: ExecutionReceipt = {
      receipt_id: uuidv4(),
      schema_version: CURRENT_RECEIPT_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      project: 'gtom' as const,
      rubric_name: GTOM_RUBRIC_V1.name,
      rubric_sha8: getRubricHash(GTOM_RUBRIC_V1),
      input_hash: crypto.createHash('sha256').update(JSON.stringify(decision)).digest('hex').substring(0, 16),
      models_used: assessment.models_used,
      config_hash: crypto.createHash('sha256').update(JSON.stringify(GTOM_RUBRIC_V1)).digest('hex').substring(0, 16),
      verdict: assessment.authenticity_score >= 0.6 ? 'pass' : assessment.authenticity_score >= 0.4 ? 'pass_with_warnings' : 'fail',
      scores: {
        authenticity: { score: assessment.authenticity_score, confidence: assessment.confidence, weight: 1.0 },
      },
      overall_score: assessment.authenticity_score,
      hard_gates_passed: assessment.authenticity_score >= 0.6,
      cost_usd: assessment.cost_usd,
      metadata: {
        decision_id: decisionId,
        score_id: scoreId,
        api_stability: API_STABILITY.receipts.level,
        rubric_version: GTOM_RUBRIC_V1.name,
        rubric_level: authenticityToLevel(assessment.authenticity_score),
        manipulation_indicators: assessment.manipulation_indicators,
        reasoning: assessment.reasoning,
        consensus: assessment.consensus,
      },
    };
    this.receiptRegistry.append(receipt).catch(err => {
      globalObservability.logger.warn('Failed to emit receipt', { error: err });
    });

    return {
      score_id: scoreId,
      decision_id: decisionId,
      authenticity_score: assessment.authenticity_score,
      confidence: assessment.confidence,
      factors: {
        self_alignment: assessment.factors.self_alignment,
        external_pressure: assessment.factors.external_pressure,
        time_pressure: assessment.factors.time_pressure,
        information_completeness: assessment.factors.information_completeness,
        emotional_state_impact: assessment.factors.emotional_state_impact,
      },
      manipulation_indicators: assessment.manipulation_indicators,
      created_at: new Date().toISOString(),
    };
  }

  async scoreBidAuthenticity(input: BidAuthenticityInput): Promise<BidAuthenticityResult> {
    try {
      const result = await this.llmClient.call([
        'You are GToM evaluating an emotional bid in a relationship.',
        'Assess whether the bid is genuine, proportionate, safe to respond to, and whether compliance pressure or coercive language is present.',
        'Return strict JSON with keys: is_genuine, is_proportionate, is_safe_to_respond, compliance_pressure_detected, authenticity_score, confidence, reasoning.',
        JSON.stringify(input, null, 2),
      ].join('\n'), {
        maxTokens: 700,
        temperature: 0.1,
      });
      return BidAuthenticityResultSchema.parse(JSON.parse(this.extractJsonObject(result.content)));
    } catch (error) {
      globalObservability.logger.warn('LLM bid authenticity assessment failed, using local fallback', { error });
      return this.scoreBidAuthenticityFallback(input);
    }
  }

  private async evaluateWithConsensus(decision: DecisionInput): Promise<ConsensusAssessment> {
    const votes: LLMAuthenticityAssessment[] = [];
    const disqualifiedModels: Array<{ model_id: string; reason: string }> = [];
    const models = this.consensusConfig.allowTier3
      ? this.consensusConfig.models
      : this.consensusConfig.models.slice(0, 2);
    let earlyStopped = false;
    let tier3Invoked = false;

    for (const [index, model] of models.entries()) {
      if (index >= 2) {
        tier3Invoked = true;
      }
      try {
        votes.push(await this.evaluateWithLLM(decision, model));
      } catch (error) {
        disqualifiedModels.push({
          model_id: model,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      if (
        this.consensusConfig.enableEarlyStopping &&
        index >= 1 &&
        !this.consensusConfig.allowTier3 &&
        this.hasConsensus(votes)
      ) {
        earlyStopped = true;
        break;
      }
    }

    if (votes.length < this.consensusConfig.minModelsForConsensus) {
      throw new Error(`Consensus requires at least ${this.consensusConfig.minModelsForConsensus} qualified model votes; got ${votes.length}`);
    }

    const consensus = this.calculateConsensus(votes, disqualifiedModels, earlyStopped, tier3Invoked);
    if (!consensus.agreed && this.consensusConfig.allowTier3 && !tier3Invoked && this.consensusConfig.models[2]) {
      const tier3Model = this.consensusConfig.models[2];
      try {
        votes.push(await this.evaluateWithLLM(decision, tier3Model));
        consensus.tier3_invoked = true;
      } catch (error) {
        disqualifiedModels.push({
          model_id: tier3Model,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const finalConsensus = this.calculateConsensus(votes, disqualifiedModels, earlyStopped, consensus.tier3_invoked);
    const winningVotes = votes.filter((vote) => this.verdictForScore(vote.authenticity_score) === finalConsensus.winning_verdict);
    const contributingVotes = finalConsensus.agreed && winningVotes.length > 0 ? winningVotes : votes;
    const costUsd = votes.reduce((sum, vote) => sum + vote.cost_usd, 0);
    const score = this.average(contributingVotes.map((vote) => vote.authenticity_score));

    return {
      authenticity_score: score,
      confidence: this.average(contributingVotes.map((vote) => vote.confidence)) * finalConsensus.agreement_rate,
      factors: {
        self_alignment: this.average(contributingVotes.map((vote) => vote.factors.self_alignment)),
        external_pressure: this.average(contributingVotes.map((vote) => vote.factors.external_pressure)),
        time_pressure: this.average(contributingVotes.map((vote) => vote.factors.time_pressure)),
        information_completeness: this.average(contributingVotes.map((vote) => vote.factors.information_completeness)),
        emotional_state_impact: this.average(contributingVotes.map((vote) => vote.factors.emotional_state_impact)),
      },
      manipulation_indicators: Array.from(new Set(contributingVotes.flatMap((vote) => vote.manipulation_indicators))),
      reasoning: contributingVotes.map((vote) => `${vote.model_id}: ${vote.reasoning}`).join('\n'),
      model_id: finalConsensus.winning_verdict,
      cost_usd: costUsd,
      models_used: votes.map((vote) => vote.model_id),
      consensus: finalConsensus,
    };
  }

  private async evaluateWithLLM(decision: DecisionInput, model?: string): Promise<LLMAuthenticityAssessment> {
    const prompt = [
      'You are GToM, a decision-authenticity evaluator.',
      'Assess whether the proposed action reflects the user\'s stable intent or is being distorted by manipulation, coercion, urgency, scarcity, social proof, authority pressure, decision fatigue, or emotional vulnerability.',
      'Return only strict JSON with keys: authenticity_score, confidence, factors, manipulation_indicators, reasoning.',
      'The factors object must include all five keys: self_alignment, external_pressure, time_pressure, information_completeness, emotional_state_impact.',
      'All numeric scores must be between 0 and 1. Higher authenticity_score means more self-aligned and less coerced.',
      '',
      JSON.stringify({
        context: decision.context,
        action: decision.action,
        vulnerabilities: decision.vulnerabilities.map((v) => ({
          category: v.category,
          baseline_level: v.baseline_level,
          current_level: v.current_level,
          evidence_count: v.evidence_count,
        })),
        cognitive_state: {
          trust_level: decision.cognitiveState.trust_level,
          cognitive_load: decision.cognitiveState.cognitive_load,
          emotional_state: decision.cognitiveState.emotional_state,
          attention_focus: decision.cognitiveState.attention_focus,
          decision_fatigue: decision.cognitiveState.decision_fatigue,
        },
        recent_influences: decision.recentInfluences,
      }),
    ].join('\n');

    const result = await this.llmClient.call(prompt, {
      model,
      maxTokens: 800,
      temperature: 0.1,
    });
    const parsed = this.parseLLMAssessment(result.content);

    return {
      ...parsed,
      model_id: result.model_id,
      cost_usd: result.cost_usd,
    };
  }

  private parseLLMAssessment(content: string): Omit<LLMAuthenticityAssessment, 'model_id' | 'cost_usd'> {
    const jsonText = this.extractJsonObject(content);
    const parsed = JSON.parse(jsonText) as Partial<LLMAuthenticityAssessment>;
    const factors = (parsed.factors ?? {}) as Partial<LLMAuthenticityAssessment['factors']>;
    const requiredFactors: Array<keyof LLMAuthenticityAssessment['factors']> = [
      'self_alignment',
      'external_pressure',
      'time_pressure',
      'information_completeness',
      'emotional_state_impact',
    ];
    for (const factor of requiredFactors) {
      if (!Number.isFinite(Number(factors[factor]))) {
        throw new Error(`LLM response missing required factor: ${factor}`);
      }
    }
    if (!Number.isFinite(Number(parsed.authenticity_score)) || !Number.isFinite(Number(parsed.confidence))) {
      throw new Error('LLM response missing numeric authenticity_score or confidence');
    }

    return {
      authenticity_score: this.clamp01(Number(parsed.authenticity_score)),
      confidence: this.clamp01(Number(parsed.confidence)),
      factors: {
        self_alignment: this.clamp01(Number(factors.self_alignment)),
        external_pressure: this.clamp01(Number(factors.external_pressure)),
        time_pressure: this.clamp01(Number(factors.time_pressure)),
        information_completeness: this.clamp01(Number(factors.information_completeness)),
        emotional_state_impact: this.clamp01(Number(factors.emotional_state_impact)),
      },
      manipulation_indicators: Array.isArray(parsed.manipulation_indicators)
        ? parsed.manipulation_indicators.map(String)
        : [],
      reasoning: String(parsed.reasoning ?? ''),
    };
  }

  private evaluateWithLocalFallback(decision: DecisionInput): LLMAuthenticityAssessment {
    const selfAlignment = this.calculateSelfAlignment(decision);
    const externalPressure = this.calculateExternalPressure(decision);
    const timePressure = this.calculateTimePressure(decision);
    const informationCompleteness = this.calculateInformationCompleteness(decision);
    const emotionalStateImpact = this.calculateEmotionalStateImpact(decision);

    const authenticityScore = this.calculateOverallScore({
      selfAlignment,
      externalPressure,
      timePressure,
      informationCompleteness,
      emotionalStateImpact,
    });

    return {
      authenticity_score: authenticityScore,
      confidence: this.calculateConfidence(decision),
      factors: {
        self_alignment: selfAlignment,
        external_pressure: externalPressure,
        time_pressure: timePressure,
        information_completeness: informationCompleteness,
        emotional_state_impact: emotionalStateImpact,
      },
      manipulation_indicators: this.detectManipulationIndicators(decision),
      reasoning: 'Local safety fallback used because LLM assessment was unavailable.',
      model_id: 'local-safety-fallback',
      cost_usd: 0,
    };
  }

  private calculateConsensus(
    votes: LLMAuthenticityAssessment[],
    disqualifiedModels: Array<{ model_id: string; reason: string }>,
    earlyStopped: boolean,
    tier3Invoked: boolean,
  ): ConsensusAssessment['consensus'] {
    const voteSummaries = votes.map((vote) => ({
      model_id: vote.model_id,
      verdict: this.verdictForScore(vote.authenticity_score),
      authenticity_score: vote.authenticity_score,
      confidence: vote.confidence,
      cost_usd: vote.cost_usd,
    }));
    const verdictCounts = voteSummaries.reduce<Record<'pass' | 'pass_with_warnings' | 'fail', number>>((counts, vote) => {
      counts[vote.verdict]++;
      return counts;
    }, { pass: 0, pass_with_warnings: 0, fail: 0 });
    const winningVerdict = (Object.entries(verdictCounts) as Array<['pass' | 'pass_with_warnings' | 'fail', number]>)
      .sort((a, b) => b[1] - a[1])[0][0];
    const winningCount = verdictCounts[winningVerdict];
    const thresholdRequired = votes.length === 3 && this.consensusConfig.consensusThreshold <= (2 / 3) + 0.005
      ? 2
      : Math.ceil(votes.length * this.consensusConfig.consensusThreshold);
    const requiredAgreeingModels = Math.max(this.consensusConfig.minModelsForConsensus, thresholdRequired);
    const agreementRate = votes.length === 0 ? 0 : winningCount / votes.length;

    return {
      votes: voteSummaries,
      disqualified_models: disqualifiedModels,
      consensus_threshold: this.consensusConfig.consensusThreshold,
      required_agreeing_models: requiredAgreeingModels,
      agreed: winningCount >= requiredAgreeingModels,
      winning_verdict: winningVerdict,
      agreement_rate: agreementRate,
      per_dimension_agreement: this.calculateDimensionAgreement(votes),
      wilson_95_ci: this.wilsonInterval(winningCount, votes.length),
      small_sample_note: votes.length < 30,
      early_stopped: earlyStopped,
      tier3_invoked: tier3Invoked,
    };
  }

  private calculateDimensionAgreement(votes: LLMAuthenticityAssessment[]): Record<string, number> {
    const dimensions: Array<keyof LLMAuthenticityAssessment['factors']> = [
      'self_alignment',
      'external_pressure',
      'time_pressure',
      'information_completeness',
      'emotional_state_impact',
    ];
    const result: Record<string, number> = {};
    for (const dimension of dimensions) {
      let matchingPairs = 0;
      let totalPairs = 0;
      for (let i = 0; i < votes.length; i++) {
        for (let j = i + 1; j < votes.length; j++) {
          totalPairs++;
          if (Math.abs(votes[i].factors[dimension] - votes[j].factors[dimension]) <= this.consensusConfig.dimensionAgreementTolerance) {
            matchingPairs++;
          }
        }
      }
      result[dimension] = totalPairs === 0 ? 1 : matchingPairs / totalPairs;
    }
    return result;
  }

  private hasConsensus(votes: LLMAuthenticityAssessment[]): boolean {
    if (votes.length < this.consensusConfig.minModelsForConsensus) return false;
    return this.calculateConsensus(votes, [], false, false).agreed;
  }

  private verdictForScore(score: number): 'pass' | 'pass_with_warnings' | 'fail' {
    return score >= 0.6 ? 'pass' : score >= 0.4 ? 'pass_with_warnings' : 'fail';
  }

  private wilsonInterval(successes: number, total: number): { lower: number; upper: number } {
    if (total === 0) {
      return { lower: 0, upper: 0 };
    }
    const z = 1.96;
    const phat = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = phat + (z * z) / (2 * total);
    const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
    return {
      lower: this.clamp01((center - margin) / denominator),
      upper: this.clamp01((center + margin) / denominator),
    };
  }

  private buildFallbackConsensus(fallback: LLMAuthenticityAssessment): ConsensusAssessment['consensus'] {
    const verdict = this.verdictForScore(fallback.authenticity_score);
    return {
      votes: [{
        model_id: fallback.model_id,
        verdict,
        authenticity_score: fallback.authenticity_score,
        confidence: fallback.confidence,
        cost_usd: fallback.cost_usd,
      }],
      disqualified_models: [],
      consensus_threshold: this.consensusConfig.consensusThreshold,
      required_agreeing_models: this.consensusConfig.minModelsForConsensus,
      agreed: false,
      winning_verdict: verdict,
      agreement_rate: 1,
      per_dimension_agreement: {
        self_alignment: 1,
        external_pressure: 1,
        time_pressure: 1,
        information_completeness: 1,
        emotional_state_impact: 1,
      },
      wilson_95_ci: this.wilsonInterval(1, 1),
      small_sample_note: true,
      early_stopped: false,
      tier3_invoked: false,
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private extractJsonObject(content: string): string {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('LLM response did not contain a JSON object');
    }
    return content.slice(start, end + 1);
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Calculate self-alignment score
   */
  private calculateSelfAlignment(decision: DecisionInput): number {
    // Higher self-alignment when:
    // - Trust level is high
    // - Cognitive load is low
    // - Vulnerabilities are low
    // - Recent influences are minimal
    
    const trustScore = decision.cognitiveState.trust_level;
    const cognitiveLoadPenalty = decision.cognitiveState.cognitive_load * 0.3;
    
    const avgVulnerability = decision.vulnerabilities.length > 0
      ? decision.vulnerabilities.reduce((sum, v) => sum + v.current_level, 0) / decision.vulnerabilities.length
      : 0;

    const vulnerabilityPenalty = avgVulnerability * 0.4;
    
    const influencePenalty = Math.min(0.3, decision.recentInfluences.length * 0.05);
    
    const score = trustScore - cognitiveLoadPenalty - vulnerabilityPenalty - influencePenalty;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate external pressure score
   */
  private calculateExternalPressure(decision: DecisionInput): number {
    // Higher external pressure when:
    // - Many recent influence events
    // - High vulnerability to social proof, authority, scarcity
    // - Urgent language in context
    
    const influenceScore = Math.min(1, decision.recentInfluences.length * 0.1);
    
    const socialPressureVuln = decision.vulnerabilities.find(v => v.category === 'social_proof');
    const authorityVuln = decision.vulnerabilities.find(v => v.category === 'authority_bias');
    const scarcityVuln = decision.vulnerabilities.find(v => v.category === 'scarcity_fear');
    
    const pressureVulnScore = (
      (socialPressureVuln?.current_level || 0) +
      (authorityVuln?.current_level || 0) +
      (scarcityVuln?.current_level || 0)
    ) / 3;
    
    const urgentLanguage = this.detectUrgentLanguage(decision.context) ? 0.3 : 0;
    
    return Math.min(1, influenceScore + pressureVulnScore * 0.5 + urgentLanguage);
  }

  /**
   * Calculate time pressure score
   */
  private calculateTimePressure(decision: DecisionInput): number {
    // Higher time pressure when:
    // - Urgent language present
    // - Decision fatigue is high
    // - Scarcity vulnerability is elevated
    
    const urgentLanguage = this.detectUrgentLanguage(decision.context) ? 0.5 : 0;
    const decisionFatigue = decision.cognitiveState.decision_fatigue;
    const scarcityVuln = decision.vulnerabilities.find(v => v.category === 'scarcity_fear');
    const scarcityPressure = scarcityVuln?.current_level || 0;
    
    return Math.min(1, urgentLanguage + decisionFatigue * 0.3 + scarcityPressure * 0.2);
  }

  /**
   * Calculate information completeness score
   */
  private calculateInformationCompleteness(decision: DecisionInput): number {
    // Higher completeness when:
    // - Context is detailed
    // - Action is specific
    // - Cognitive load is manageable
    
    const contextLength = decision.context.length;
    const actionLength = decision.action.length;
    
    const lengthScore = Math.min(1, (contextLength + actionLength) / 200);
    const cognitiveLoadPenalty = decision.cognitiveState.cognitive_load * 0.3;
    
    return Math.max(0, lengthScore - cognitiveLoadPenalty);
  }

  /**
   * Calculate emotional state impact score
   */
  private calculateEmotionalStateImpact(decision: DecisionInput): number {
    // Higher impact when:
    // - Emotional state is negative or stressed
    // - Emotional manipulation vulnerability is high
    
    const emotionalState = decision.cognitiveState.emotional_state;
    let emotionScore = 0;
    
    if (emotionalState === 'stressed' || emotionalState === 'negative') {
      emotionScore = 0.7;
    } else if (emotionalState === 'excited') {
      emotionScore = 0.5;
    } else {
      emotionScore = 0.2;
    }
    
    const emotionalVuln = decision.vulnerabilities.find(v => v.category === 'emotional_manipulation');
    const vulnerabilityScore = emotionalVuln?.current_level || 0;
    
    return Math.min(1, emotionScore + vulnerabilityScore * 0.3);
  }

  /**
   * Calculate overall authenticity score
   */
  private calculateOverallScore(factors: {
    selfAlignment: number;
    externalPressure: number;
    timePressure: number;
    informationCompleteness: number;
    emotionalStateImpact: number;
  }): number {
    // Authenticity is high when:
    // - Self-alignment is high
    // - External pressure is low
    // - Time pressure is low
    // - Information is complete
    // - Emotional state impact is low
    
    const score = (
      factors.selfAlignment * 0.4 +
      (1 - factors.externalPressure) * 0.2 +
      (1 - factors.timePressure) * 0.15 +
      factors.informationCompleteness * 0.15 +
      (1 - factors.emotionalStateImpact) * 0.1
    );
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate confidence in authenticity score
   */
  private calculateConfidence(decision: DecisionInput): number {
    // Confidence based on:
    // - Amount of context available
    // - Number of vulnerability data points
    // - Recency of cognitive state
    
    const contextScore = Math.min(1, (decision.context.length + decision.action.length) / 100);
    const vulnerabilityScore = Math.min(1, decision.vulnerabilities.length / 10);
    const stateRecency = decision.cognitiveState ? 0.8 : 0.5;
    
    return (contextScore + vulnerabilityScore + stateRecency) / 3;
  }

  /**
   * Detect manipulation indicators
   */
  private detectManipulationIndicators(decision: DecisionInput): string[] {
    const indicators: string[] = [];
    const lowerContext = decision.context.toLowerCase();
    
    // Check for urgency indicators
    if (this.detectUrgentLanguage(decision.context)) {
      indicators.push('urgency_pressure');
    }
    
    // Check for authority appeals
    if (lowerContext.includes('expert') || lowerContext.includes('authority')) {
      indicators.push('authority_appeal');
    }
    
    // Check for scarcity
    if (lowerContext.includes('limited') || lowerContext.includes('only')) {
      indicators.push('scarcity_tactic');
    }
    
    // Check for social proof
    if (lowerContext.includes('everyone') || lowerContext.includes('popular')) {
      indicators.push('social_proof_tactic');
    }
    
    // Check for high external pressure
    const externalPressure = this.calculateExternalPressure(decision);
    if (externalPressure > 0.7) {
      indicators.push('high_external_pressure');
    }
    
    // Check for high time pressure
    const timePressure = this.calculateTimePressure(decision);
    if (timePressure > 0.7) {
      indicators.push('time_pressure');
    }
    
    return indicators;
  }

  /**
   * Detect urgent language
   */
  private detectUrgentLanguage(text: string): boolean {
    const urgentKeywords = ['urgent', 'immediately', 'now', 'right now', 'asap', 'hurry', 'limited time', 'expires'];
    const lowerText = text.toLowerCase();
    
    return urgentKeywords.some(keyword => lowerText.includes(keyword));
  }

  private scoreBidAuthenticityFallback(input: BidAuthenticityInput): BidAuthenticityResult {
    const combined = `${input.bid_text}\n${input.emotional_context}`.toLowerCase();
    const compliancePressureDetected = /\b(if you loved me|you owe me|have to|must|prove it|or else|make you)\b/i.test(combined);
    const disproportionate = /\b(always|never|everything|nothing|right now)\b/i.test(combined) || input.bid_text.length > 500;
    const unsafe = /\b(threat|hurt|punish|leave you unless|kill|harm)\b/i.test(combined);
    const repeatedIgnored = input.recent_bid_history.filter(bid => bid.response_type === 'ignored' || bid.response_type === 'against').length;
    const authenticityScore = this.clamp01(
      0.85 -
      (compliancePressureDetected ? 0.35 : 0) -
      (disproportionate ? 0.2 : 0) -
      (unsafe ? 0.4 : 0) -
      Math.min(0.2, repeatedIgnored * 0.05),
    );

    return {
      is_genuine: authenticityScore >= 0.5 && !compliancePressureDetected,
      is_proportionate: !disproportionate,
      is_safe_to_respond: !unsafe,
      compliance_pressure_detected: compliancePressureDetected,
      authenticity_score: authenticityScore,
      confidence: 0.72,
      reasoning: compliancePressureDetected
        ? 'Local fallback detected compliance pressure in the bid language.'
        : 'Local fallback found no strong coercion markers in the bid language.',
    };
  }
}
