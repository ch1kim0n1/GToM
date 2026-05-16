import { v4 as uuidv4 } from 'uuid';
import {
  ConflictPrediction,
  ConflictPredictionRequest,
  ConflictPredictionResponse,
  DyadMessage,
  RelationalConflictPrediction,
  RelationalConflictRequest,
  RelationalConflictResponse,
  RelationalConflictType,
} from '../types/index.js';
import { LLMClient, LLMCallResult } from './llm-client.js';

interface LLMCaller {
  call(prompt: string, options?: { model?: string; maxTokens?: number; temperature?: number }): Promise<LLMCallResult>;
}

/**
 * Conflict Predictor for GOrchestrator
 * 
 * Responsibilities:
 * - Predict conflicts between parallel agent attempts
 * - Recommend actions (reroute, serialize, merge, ignore)
 * - Analyze file, resource, semantic, and goal conflicts
 */
export class ConflictPredictor {
  constructor(private readonly llmClient: LLMCaller = new LLMClient()) {}

  /**
   * Predict conflicts for active attempts
   */
  async predictConflicts(request: ConflictPredictionRequest): Promise<ConflictPredictionResponse> {
    const predictions: ConflictPrediction[] = [];
    
    const attempts = request.active_attempts;
    
    // Check all pairs of attempts for conflicts
    for (let i = 0; i < attempts.length; i++) {
      for (let j = i + 1; j < attempts.length; j++) {
        const attemptA = attempts[i];
        const attemptB = attempts[j];
        
        const fileConflict = this.predictFileConflict(attemptA, attemptB);
        if (fileConflict) {
          predictions.push(fileConflict);
        }
        
        const resourceConflict = this.predictResourceConflict(attemptA, attemptB);
        if (resourceConflict) {
          predictions.push(resourceConflict);
        }
        
        const semanticConflict = this.predictSemanticConflict(attemptA, attemptB);
        if (semanticConflict) {
          predictions.push(semanticConflict);
        }
        
        const goalConflict = this.predictGoalConflict(attemptA, attemptB);
        if (goalConflict) {
          predictions.push(goalConflict);
        }
      }
    }
    
    return {
      predicted_conflicts: predictions,
    };
  }

  async predictRelationalConflicts(request: RelationalConflictRequest): Promise<RelationalConflictResponse> {
    try {
      const result = await this.llmClient.call(this.buildRelationalPrompt(request), {
        maxTokens: 900,
        temperature: 0.1,
      });
      const parsed = this.parseRelationalLLMResult(request, result.content);
      if (parsed.predicted_conflicts.length > 0) {
        return parsed;
      }
    } catch {
      // Fall through to deterministic local detector when LLM access is unavailable.
    }

    return this.predictRelationalConflictsFallback(request);
  }

  private buildRelationalPrompt(request: RelationalConflictRequest): string {
    return `You are GToM in relational conflict mode.
Detect bid_ignored, bid_rejected, repair_refused, labor_asymmetry, phantom_third_party, and attachment_threat.
Return strict JSON: {"predicted_conflicts":[{"conflict_type":"...","severity":0.0,"confidence":0.0,"reasoning":"...","recommended_action":"surface_gently|defer|refuse|monitor"}],"aggregate_risk":0.0,"confidence":0.0}
Do not diagnose or blame either participant.

${JSON.stringify(request, null, 2)}`;
  }

  private parseRelationalLLMResult(
    request: RelationalConflictRequest,
    content: string,
  ): RelationalConflictResponse {
    const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as {
      predicted_conflicts?: Array<Partial<RelationalConflictPrediction>>;
      aggregate_risk?: number;
      confidence?: number;
    };
    const validTypes = new Set<RelationalConflictType>([
      'bid_ignored',
      'bid_rejected',
      'repair_refused',
      'labor_asymmetry',
      'phantom_third_party',
      'attachment_threat',
    ]);
    const conflicts = (parsed.predicted_conflicts || [])
      .filter(item => validTypes.has(item.conflict_type as RelationalConflictType))
      .map(item => ({
        prediction_id: uuidv4(),
        dyad_id: request.dyad_id,
        conflict_type: item.conflict_type as RelationalConflictType,
        severity: clamp01(Number(item.severity)),
        confidence: clamp01(Number(item.confidence ?? parsed.confidence ?? 0.6)),
        reasoning: String(item.reasoning || 'LLM relational conflict signal'),
        recommended_action: item.recommended_action || 'monitor',
      }));
    const aggregateRisk = parsed.aggregate_risk === undefined
      ? aggregateRiskOf(conflicts)
      : clamp01(Number(parsed.aggregate_risk));
    return {
      predicted_conflicts: conflicts,
      aggregate_risk: aggregateRisk,
      confidence: clamp01(Number(parsed.confidence ?? average(conflicts.map(item => item.confidence), 1))),
    };
  }

  private predictRelationalConflictsFallback(request: RelationalConflictRequest): RelationalConflictResponse {
    const conflicts: RelationalConflictPrediction[] = [];
    const messages = request.message_window;
    const bidMessages = messages.filter(message => message.type === 'bid');
    const ignoredBids = bidMessages.filter(message => message.response_type === 'ignored');
    const rejectedBids = bidMessages.filter(message => message.response_type === 'away' || message.response_type === 'against');
    const repairs = messages.filter(message => message.type === 'repair_attempt');
    const refusedRepairs = repairs.filter(message => message.success === false);
    const participantABids = bidMessages.filter(message => message.participant === 'a').length;
    const participantBBids = bidMessages.filter(message => message.participant === 'b').length;
    const totalBids = Math.max(1, bidMessages.length);
    const laborRatioA = participantABids / totalBids;
    const thirdPartyCount = messages.filter(message => hasThirdPartySignal(message.text)).length;

    if (ignoredBids.length > 0) {
      conflicts.push(this.relationalConflict(request.dyad_id, 'bid_ignored', ignoredBids.length / totalBids, 'Recent bids appear to be ignored.'));
    }
    if (rejectedBids.length > 0) {
      conflicts.push(this.relationalConflict(request.dyad_id, 'bid_rejected', rejectedBids.length / totalBids, 'Recent bids include away or against responses.'));
    }
    if (refusedRepairs.length > 0) {
      conflicts.push(this.relationalConflict(request.dyad_id, 'repair_refused', refusedRepairs.length / Math.max(1, repairs.length), 'Repair attempts have recently failed.'));
    }
    if (Math.abs(laborRatioA - 0.5) > 0.25 && bidMessages.length >= 3) {
      conflicts.push(this.relationalConflict(request.dyad_id, 'labor_asymmetry', Math.abs(laborRatioA - 0.5) * 2, 'One participant is carrying a disproportionate share of bids.'));
    }
    if (thirdPartyCount > 0) {
      conflicts.push(this.relationalConflict(request.dyad_id, 'phantom_third_party', Math.min(1, thirdPartyCount / 3), 'Third-party references may be affecting the dyad.'));
    }
    if (this.hasAttachmentThreat(request, messages)) {
      conflicts.push(this.relationalConflict(request.dyad_id, 'attachment_threat', 0.7, 'Bid and repair signals suggest attachment threat.'));
    }

    return {
      predicted_conflicts: conflicts,
      aggregate_risk: aggregateRiskOf(conflicts),
      confidence: conflicts.length > 0 ? average(conflicts.map(conflict => conflict.confidence), 0.75) : 0.8,
    };
  }

  private relationalConflict(
    dyadId: string,
    conflictType: RelationalConflictType,
    severity: number,
    reasoning: string,
  ): RelationalConflictPrediction {
    const normalizedSeverity = clamp01(severity);
    return {
      prediction_id: uuidv4(),
      dyad_id: dyadId,
      conflict_type: conflictType,
      severity: normalizedSeverity,
      confidence: Math.max(0.55, Math.min(0.9, normalizedSeverity + 0.2)),
      reasoning,
      recommended_action: normalizedSeverity > 0.8 ? 'refuse' : normalizedSeverity > 0.5 ? 'surface_gently' : 'monitor',
    };
  }

  private hasAttachmentThreat(request: RelationalConflictRequest, messages: DyadMessage[]): boolean {
    const anxious = request.participant_a.attachment_style === 'anxious' || request.participant_b.attachment_style === 'anxious';
    const avoidant = request.participant_a.attachment_style === 'avoidant' || request.participant_b.attachment_style === 'avoidant';
    const rejectedCount = messages.filter(message => message.response_type === 'away' || message.response_type === 'against').length;
    return rejectedCount >= 2 && (anxious || avoidant);
  }

  /**
   * Predict file conflicts
   */
  private predictFileConflict(
    attemptA: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] },
    attemptB: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] }
  ): ConflictPrediction | null {
    // Check if both attempts are modifying the same files
    const filesA = this.extractFilesFromActions(attemptA.recent_actions);
    const filesB = this.extractFilesFromActions(attemptB.recent_actions);
    
    const commonFiles = filesA.filter(f => filesB.includes(f));
    
    if (commonFiles.length === 0) return null;
    
    const severity = commonFiles.length > 3 ? 0.9 : commonFiles.length > 1 ? 0.6 : 0.3;
    
    return {
      prediction_id: uuidv4(),
      attempt_ids: [attemptA.attempt_id, attemptB.attempt_id],
      conflict_type: 'file',
      severity,
      predicted_at_step: 5,
      recommended_action: severity > 0.7 ? 'serialize' : 'merge',
      confidence: 0.8,
      reasoning: `Both attempts modifying same files: ${commonFiles.join(', ')}`,
    };
  }

  /**
   * Predict resource conflicts
   */
  private predictResourceConflict(
    attemptA: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] },
    attemptB: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] }
  ): ConflictPrediction | null {
    // Check if both attempts are using the same exclusive resources
    const resourcesA = this.extractResourcesFromState(attemptA.current_state);
    const resourcesB = this.extractResourcesFromState(attemptB.current_state);
    
    const commonResources = resourcesA.filter(r => resourcesB.includes(r));
    
    if (commonResources.length === 0) return null;
    
    return {
      prediction_id: uuidv4(),
      attempt_ids: [attemptA.attempt_id, attemptB.attempt_id],
      conflict_type: 'resource',
      severity: 0.7,
      recommended_action: 'serialize',
      confidence: 0.7,
      reasoning: `Both attempts using same resources: ${commonResources.join(', ')}`,
    };
  }

  /**
   * Predict semantic conflicts
   */
  private predictSemanticConflict(
    attemptA: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] },
    attemptB: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] }
  ): ConflictPrediction | null {
    // Check if attempts have contradictory approaches
    const approachA = this.inferApproach(attemptA.recent_actions);
    const approachB = this.inferApproach(attemptB.recent_actions);
    
    if (this.areApproachesCompatible(approachA, approachB)) return null;
    
    return {
      prediction_id: uuidv4(),
      attempt_ids: [attemptA.attempt_id, attemptB.attempt_id],
      conflict_type: 'semantic',
      severity: 0.5,
      recommended_action: 'ignore', // Semantic conflicts can often be resolved later
      confidence: 0.5,
      reasoning: `Approaches may conflict: ${approachA} vs ${approachB}`,
    };
  }

  /**
   * Predict goal conflicts
   */
  private predictGoalConflict(
    attemptA: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] },
    attemptB: { attempt_id: string; config_id: string; current_state: any; recent_actions: string[] }
  ): ConflictPrediction | null {
    // Check if attempts are pursuing contradictory goals
    const goalA = this.inferGoal(attemptA.recent_actions);
    const goalB = this.inferGoal(attemptB.recent_actions);
    
    if (this.areGoalsCompatible(goalA, goalB)) return null;
    
    return {
      prediction_id: uuidv4(),
      attempt_ids: [attemptA.attempt_id, attemptB.attempt_id],
      conflict_type: 'goal',
      severity: 0.8,
      recommended_action: 'reroute',
      confidence: 0.6,
      reasoning: `Goals may conflict: ${goalA} vs ${goalB}`,
    };
  }

  /**
   * Extract file paths from actions
   */
  private extractFilesFromActions(actions: string[]): string[] {
    const files: string[] = [];
    const filePattern = /[\w\-\.]+\.(ts|js|py|go|rs|json|yaml|md|txt)/g;
    
    for (const action of actions) {
      const matches = action.match(filePattern);
      if (matches) {
        files.push(...matches);
      }
    }
    
    return [...new Set(files)];
  }

  /**
   * Extract resources from state
   */
  private extractResourcesFromState(state: any): string[] {
    const resources: string[] = [];
    
    if (state.locks) {
      resources.push(...Object.keys(state.locks));
    }
    
    if (state.activeConnections) {
      resources.push(...Object.keys(state.activeConnections));
    }
    
    return resources;
  }

  /**
   * Infer approach from actions
   */
  private inferApproach(actions: string[]): string {
    const lowerActions = actions.map(a => a.toLowerCase());
    
    if (lowerActions.includes('refactor') || lowerActions.includes('clean')) {
      return 'refactoring';
    }
    if (lowerActions.includes('add') || lowerActions.some(a => a.includes('implement'))) {
      return 'feature_addition';
    }
    if (lowerActions.includes('fix') || lowerActions.some(a => a.includes('bug'))) {
      return 'bug_fix';
    }
    
    return 'unknown';
  }

  /**
   * Infer goal from actions
   */
  private inferGoal(actions: string[]): string {
    const lowerActions = actions.map(a => a.toLowerCase());
    
    if (lowerActions.includes('optimize') || lowerActions.some(a => a.includes('performance'))) {
      return 'performance';
    }
    if (lowerActions.includes('security') || lowerActions.some(a => a.includes('safe'))) {
      return 'security';
    }
    if (lowerActions.includes('test') || lowerActions.some(a => a.includes('coverage'))) {
      return 'testing';
    }
    
    return 'general';
  }

  /**
   * Check if approaches are compatible
   */
  private areApproachesCompatible(approachA: string, approachB: string): boolean {
    const incompatible: Record<string, string[]> = {
      refactoring: ['feature_addition'],
      feature_addition: ['refactoring'],
    };
    
    const incompatibilities = incompatible[approachA] || [];
    return !incompatibilities.includes(approachB);
  }

  /**
   * Check if goals are compatible
   */
  private areGoalsCompatible(goalA: string, goalB: string): boolean {
    // Most goals are compatible unless explicitly contradictory
    return true;
  }
}

function lowerIncludes(str: string, search: string): boolean {
  return str.toLowerCase().includes(search);
}

function hasThirdPartySignal(text: string): boolean {
  return /\b(ex|mom|dad|parent|friend|coworker|therapist)\b/i.test(text);
}

function aggregateRiskOf(conflicts: Array<{ severity: number; confidence: number }>): number {
  if (conflicts.length === 0) return 0;
  const maxSeverity = Math.max(...conflicts.map(conflict => conflict.severity));
  const avgWeighted = average(conflicts.map(conflict => conflict.severity * conflict.confidence), 0);
  return clamp01(Math.max(maxSeverity, avgWeighted));
}

function average(values: number[], fallback: number): number {
  return values.length === 0 ? fallback : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
