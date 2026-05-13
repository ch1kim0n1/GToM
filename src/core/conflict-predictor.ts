import { v4 as uuidv4 } from 'uuid';
import {
  ConflictPrediction,
  ConflictPredictionRequest,
  ConflictPredictionResponse,
} from '../types/index.js';

/**
 * Conflict Predictor for GOrchestrator
 * 
 * Responsibilities:
 * - Predict conflicts between parallel agent attempts
 * - Recommend actions (reroute, serialize, merge, ignore)
 * - Analyze file, resource, semantic, and goal conflicts
 */
export class ConflictPredictor {
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
