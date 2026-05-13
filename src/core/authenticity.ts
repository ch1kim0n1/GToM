import { v4 as uuidv4 } from 'uuid';
import {
  AuthenticityScore,
  Decision,
  Vulnerability,
  CognitiveState,
} from '../types/index.js';

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
  /**
   * Score a decision for authenticity
   */
  scoreDecision(
    decision: {
      context: string;
      action: string;
      vulnerabilities: Vulnerability[];
      cognitiveState: CognitiveState;
      recentInfluences: string[];
    }
  ): AuthenticityScore {
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
    
    const manipulationIndicators = this.detectManipulationIndicators(decision);
    
    return {
      score_id: uuidv4(),
      decision_id: uuidv4(),
      authenticity_score: authenticityScore,
      confidence: this.calculateConfidence(decision),
      factors: {
        self_alignment: selfAlignment,
        external_pressure: externalPressure,
        time_pressure: timePressure,
        information_completeness: informationCompleteness,
        emotional_state_impact: emotionalStateImpact,
      },
      manipulation_indicators: manipulationIndicators,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Calculate self-alignment score
   */
  private calculateSelfAlignment(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): number {
    // Higher self-alignment when:
    // - Trust level is high
    // - Cognitive load is low
    // - Vulnerabilities are low
    // - Recent influences are minimal
    
    const trustScore = decision.cognitiveState.trust_level;
    const cognitiveLoadPenalty = decision.cognitiveState.cognitive_load * 0.3;
    
    const avgVulnerability = decision.vulnerabilities.reduce(
      (sum, v) => sum + v.current_level,
      0
    ) / decision.vulnerabilities.length;
    
    const vulnerabilityPenalty = avgVulnerability * 0.4;
    
    const influencePenalty = Math.min(0.3, decision.recentInfluences.length * 0.05);
    
    const score = trustScore - cognitiveLoadPenalty - vulnerabilityPenalty - influencePenalty;
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate external pressure score
   */
  private calculateExternalPressure(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): number {
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
  private calculateTimePressure(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): number {
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
  private calculateInformationCompleteness(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): number {
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
  private calculateEmotionalStateImpact(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): number {
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
  private calculateConfidence(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): number {
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
  private detectManipulationIndicators(decision: {
    context: string;
    action: string;
    vulnerabilities: Vulnerability[];
    cognitiveState: CognitiveState;
    recentInfluences: string[];
  }): string[] {
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
