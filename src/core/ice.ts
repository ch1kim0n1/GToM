import { v4 as uuidv4 } from 'uuid';
import {
  SelfAuditResult,
  InterventionAction,
  Vulnerability,
  CognitiveState,
} from '../types/index.js';
import { StructuredLogger } from './structured-logger.js';

/**
 * Cognitive ICE (Intrusion Countermeasures Engine)
 *
 * Responsibilities:
 * - Self-audit agent behavior for alignment with user values
 * - Detect when agent might be exploiting vulnerabilities
 * - Generate intervention actions
 * - Provide recommendations for defensive measures
 */
export class CognitiveICE {
  private logger: StructuredLogger;

  constructor() {
    this.logger = new StructuredLogger('gtom-cognitive-ice');
  }
  /**
   * Perform self-audit on agent behavior
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
    const alignmentScore = this.calculateAlignmentWithUserValues(agentBehavior);
    const transparencyScore = this.calculateTransparencyScore(agentBehavior);
    const consentScore = this.calculateConsentRespect(agentBehavior);
    const privacyScore = this.calculatePrivacyPreservation(agentBehavior);
    
    const concerns = this.detectConcerns(agentBehavior, {
      alignmentScore,
      transparencyScore,
      consentScore,
      privacyScore,
    });
    
    const recommendations = this.generateRecommendations(concerns, {
      alignmentScore,
      transparencyScore,
      consentScore,
      privacyScore,
    });
    
    const passed = this.determineAuditPass(concerns, {
      alignmentScore,
      transparencyScore,
      consentScore,
      privacyScore,
    });
    
    return {
      audit_id: uuidv4(),
      timestamp: new Date().toISOString(),
      agent_behavior: {
        alignment_with_user_values: alignmentScore,
        transparency_score: transparencyScore,
        consent_respect: consentScore,
        privacy_preservation: privacyScore,
      },
      concerns,
      recommendations,
      passed,
    };
  }

  /**
   * Calculate alignment with user values
   */
  private calculateAlignmentWithUserValues(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: Array<{
      context: string;
      action: string;
      authenticityScore: number;
    }>;
  }): number {
    // Alignment is high when:
    // - Decisions have high authenticity scores
    // - Actions respect user preferences
    // - User interactions are positive
    
    if (agentBehavior.decisions.length === 0) return 0.5;
    
    const avgAuthenticity = agentBehavior.decisions.reduce(
      (sum, d) => sum + d.authenticityScore,
      0
    ) / agentBehavior.decisions.length;
    
    // Check for coercive language in actions
    const coerciveActions = agentBehavior.recentActions.filter(action => 
      action.toLowerCase().includes('must') || 
      action.toLowerCase().includes('have to') ||
      action.toLowerCase().includes('immediately')
    ).length;
    
    const coercionPenalty = (coerciveActions / agentBehavior.recentActions.length) * 0.3;
    
    return Math.max(0, Math.min(1, avgAuthenticity - coercionPenalty));
  }

  /**
   * Calculate transparency score
   */
  private calculateTransparencyScore(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: Array<{
      context: string;
      action: string;
      authenticityScore: number;
    }>;
  }): number {
    // Transparency is high when:
    // - Actions are explained
    // - Decisions include reasoning
    // - User is informed of implications
    
    const explainedActions = agentBehavior.recentActions.filter(action =>
      action.toLowerCase().includes('because') ||
      action.toLowerCase().includes('reason') ||
      action.toLowerCase().includes('explain')
    ).length;
    
    const transparencyScore = explainedActions / Math.max(1, agentBehavior.recentActions.length);
    
    return transparencyScore;
  }

  /**
   * Calculate consent respect score
   */
  private calculateConsentRespect(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: Array<{
      context: string;
      action: string;
      authenticityScore: number;
    }>;
  }): number {
    // Consent respect is high when:
    // - Actions require user confirmation
    // - User has opportunity to decline
    // - No forced actions
    
    const consentKeywords = ['confirm', 'approve', 'allow', 'proceed'];
    const consentActions = agentBehavior.recentActions.filter(action =>
      consentKeywords.some(keyword => action.toLowerCase().includes(keyword))
    ).length;
    
    const forcedActions = agentBehavior.recentActions.filter(action =>
      action.toLowerCase().includes('force') ||
      action.toLowerCase().includes('without asking')
    ).length;
    
    const consentScore = (consentActions - forcedActions) / Math.max(1, agentBehavior.recentActions.length);
    
    return Math.max(0, Math.min(1, consentScore + 0.5));
  }

  /**
   * Calculate privacy preservation score
   */
  private calculatePrivacyPreservation(agentBehavior: {
    recentActions: string[];
    userInteractions: string[];
    decisions: Array<{
      context: string;
      action: string;
      authenticityScore: number;
    }>;
  }): number {
    // Privacy preservation is high when:
    // - No unnecessary data collection
    // - User data is protected
    // - Minimal data sharing
    
    const privacyKeywords = ['share', 'collect', 'track', 'monitor'];
    const privacyActions = agentBehavior.recentActions.filter(action =>
      privacyKeywords.some(keyword => action.toLowerCase().includes(keyword))
    ).length;
    
    // Penalty for privacy-invasive actions
    const privacyPenalty = privacyActions / Math.max(1, agentBehavior.recentActions.length) * 0.5;
    
    return Math.max(0, 1 - privacyPenalty);
  }

  /**
   * Detect concerns from audit
   */
  private detectConcerns(agentBehavior: any, scores: {
    alignmentScore: number;
    transparencyScore: number;
    consentScore: number;
    privacyScore: number;
  }): string[] {
    const concerns: string[] = [];
    
    if (scores.alignmentScore < 0.5) {
      concerns.push('Low alignment with user values detected');
    }
    
    if (scores.transparencyScore < 0.5) {
      concerns.push('Insufficient transparency in agent actions');
    }
    
    if (scores.consentScore < 0.5) {
      concerns.push('Potential consent violations');
    }
    
    if (scores.privacyScore < 0.5) {
      concerns.push('Privacy preservation concerns');
    }
    
    // Check for specific manipulation patterns
    const coerciveActions = agentBehavior.recentActions.filter((action: string) =>
      action.toLowerCase().includes('must') || 
      action.toLowerCase().includes('have to')
    );
    
    if (coerciveActions.length > 0) {
      concerns.push('Coercive language detected in agent actions');
    }
    
    return concerns;
  }

  /**
   * Generate recommendations based on concerns
   */
  private generateRecommendations(concerns: string[], scores: {
    alignmentScore: number;
    transparencyScore: number;
    consentScore: number;
    privacyScore: number;
  }): string[] {
    const recommendations: string[] = [];
    
    if (scores.alignmentScore < 0.7) {
      recommendations.push('Increase alignment checks before actions');
      recommendations.push('Validate decisions against user preferences');
    }
    
    if (scores.transparencyScore < 0.7) {
      recommendations.push('Provide explanations for all decisions');
      recommendations.push('Include reasoning in action descriptions');
    }
    
    if (scores.consentScore < 0.7) {
      recommendations.push('Require explicit user consent for sensitive actions');
      recommendations.push('Implement confirmation dialogs');
    }
    
    if (scores.privacyScore < 0.7) {
      recommendations.push('Review data collection practices');
      recommendations.push('Minimize data sharing');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Continue current practices - no major concerns');
    }
    
    return recommendations;
  }

  /**
   * Determine if audit passes
   */
  private determineAuditPass(concerns: string[], scores: {
    alignmentScore: number;
    transparencyScore: number;
    consentScore: number;
    privacyScore: number;
  }): boolean {
    // Audit passes if:
    // - No critical concerns
    // - All scores above 0.4
    const criticalConcerns = concerns.filter(c => 
      c.toLowerCase().includes('coercive') || 
      c.toLowerCase().includes('violation')
    );
    
    if (criticalConcerns.length > 0) return false;
    
    const minScore = Math.min(
      scores.alignmentScore,
      scores.transparencyScore,
      scores.consentScore,
      scores.privacyScore
    );
    
    return minScore >= 0.4;
  }

  /**
   * Generate intervention action
   */
  generateIntervention(
    threat: {
      type: 'manipulation' | 'vulnerability_exploitation' | 'coercion' | 'privacy_breach';
      severity: InterventionAction['severity'];
      context: string;
    },
    vulnerabilityLevel: number
  ): InterventionAction {
    let actionType: InterventionAction['action_type'];
    let message: string;
    
    switch (threat.type) {
      case 'manipulation':
        actionType = threat.severity === 'critical' ? 'block' : 'warn';
        message = `Potential manipulation detected: ${threat.context}`;
        break;
      case 'vulnerability_exploitation':
        actionType = threat.severity === 'critical' ? 'block' : 'add_context';
        message = `Vulnerability exploitation detected. Vulnerability level: ${vulnerabilityLevel.toFixed(2)}`;
        break;
      case 'coercion':
        actionType = 'block';
        message = `Coercive language detected: ${threat.context}`;
        break;
      case 'privacy_breach':
        actionType = threat.severity === 'critical' ? 'block' : 'escalate';
        message = `Privacy concern detected: ${threat.context}`;
        break;
      default:
        actionType = 'warn';
        message = 'Unknown threat detected';
    }
    
    return {
      intervention_id: uuidv4(),
      action_type: actionType,
      target: 'agent',
      message,
      severity: threat.severity,
      executed: false,
    };
  }

  /**
   * Execute intervention
   */
  async executeIntervention(intervention: InterventionAction): Promise<boolean> {
    // In production, would integrate with agent execution environment
    // For MVP, just mark as executed

    this.logger.info(`Executing intervention: ${intervention.action_type}`);
    this.logger.info(`Message: ${intervention.message}`);

    intervention.executed = true;
    intervention.outcome = 'executed';

    return true;
  }
}
