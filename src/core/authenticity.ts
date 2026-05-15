import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import {
  AuthenticityScore,
  Decision,
  Vulnerability,
  CognitiveState,
} from '../types/index.js';
import { ReceiptRegistry } from './receipt-registry.js';
import { GTOM_RUBRIC_V1, authenticityToLevel, getRubricHash } from './gtom-rubric.js';
import { ExecutionReceipt } from '../types/quality-rubric.js';
import { LLMClient, LLMCallResult } from './llm-client.js';

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

  constructor(config: { llmClient?: LLMCaller } = {}) {
    this.receiptRegistry = new ReceiptRegistry('gtom');
    this.llmClient = config.llmClient ?? new LLMClient();
  }

  /**
   * Score a decision for authenticity
   */
  async scoreDecision(decision: DecisionInput): Promise<AuthenticityScore> {
    const assessment = await this.evaluateWithLLM(decision).catch((error) => {
      console.warn('[GToM] LLM authenticity assessment failed, using local safety fallback:', error);
      return this.evaluateWithLocalFallback(decision);
    });

    const scoreId = uuidv4();
    const decisionId = uuidv4();

    // Emit execution receipt for quality tracking (fire-and-forget).
    const receipt: ExecutionReceipt = {
      receipt_id: uuidv4(),
      schema_version: 1,
      timestamp: new Date().toISOString(),
      project: 'gtom' as const,
      rubric_name: GTOM_RUBRIC_V1.name,
      rubric_sha8: getRubricHash(GTOM_RUBRIC_V1),
      input_hash: crypto.createHash('sha256').update(JSON.stringify(decision)).digest('hex').substring(0, 16),
      models_used: [assessment.model_id],
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
        rubric_level: authenticityToLevel(assessment.authenticity_score),
        manipulation_indicators: assessment.manipulation_indicators,
        reasoning: assessment.reasoning,
      },
    };
    this.receiptRegistry.append(receipt).catch(err => {
      console.warn('[GToM] Failed to emit receipt:', err);
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

  private async evaluateWithLLM(decision: DecisionInput): Promise<LLMAuthenticityAssessment> {
    const prompt = [
      'You are GToM, a decision-authenticity evaluator.',
      'Assess whether the proposed action reflects the user\'s stable intent or is being distorted by manipulation, coercion, urgency, scarcity, social proof, authority pressure, decision fatigue, or emotional vulnerability.',
      'Return only strict JSON with keys: authenticity_score, confidence, factors, manipulation_indicators, reasoning.',
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
}
