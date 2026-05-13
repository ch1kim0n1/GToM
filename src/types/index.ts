import { z } from 'zod';

// ============================================================================
// Core Type Schemas with Zod Validation
// ============================================================================

export const ObservationSchema = z.object({
  observation_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  surface: z.string(),
  content: z.string(),
  source: z.enum(['user_input', 'agent_action', 'system_event', 'external_signal']),
  metadata: z.record(z.any()).optional(),
});

export type Observation = z.infer<typeof ObservationSchema>;

export const InfluenceEventSchema = z.object({
  influence_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  source: z.string(),
  channel: z.enum(['ui', 'notification', 'email', 'social', 'content', 'advertising']),
  content: z.string(),
  detected_pattern: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
});

export type InfluenceEvent = z.infer<typeof InfluenceEventSchema>;

export const VulnerabilitySchema = z.object({
  vulnerability_id: z.string().uuid(),
  category: z.enum([
    'authority_bias',
    'scarcity_fear',
    'social_proof',
    'commitment_consistency',
    'reciprocity',
    'liking_similar',
    'attention_manipulation',
    'confirmation_bias',
    'framing_effects',
    'emotional_manipulation',
  ]),
  baseline_level: z.number().min(0).max(1),
  current_level: z.number().min(0).max(1),
  last_updated: z.string().datetime(),
  evidence_count: z.number().int().nonnegative(),
  recent_exposures: z.array(z.string()),
});

export type Vulnerability = z.infer<typeof VulnerabilitySchema>;

export const CognitiveStateSchema = z.object({
  state_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  trust_level: z.number().min(0).max(1),
  cognitive_load: z.number().min(0).max(1),
  emotional_state: z.enum(['neutral', 'positive', 'negative', 'stressed', 'excited']),
  attention_focus: z.string(),
  decision_fatigue: z.number().min(0).max(1),
});

export type CognitiveState = z.infer<typeof CognitiveStateSchema>;

export const AuthenticityScoreSchema = z.object({
  score_id: z.string().uuid(),
  decision_id: z.string().uuid(),
  authenticity_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  factors: z.object({
    self_alignment: z.number().min(0).max(1),
    external_pressure: z.number().min(0).max(1),
    time_pressure: z.number().min(0).max(1),
    information_completeness: z.number().min(0).max(1),
    emotional_state_impact: z.number().min(0).max(1),
  }),
  manipulation_indicators: z.array(z.string()),
  created_at: z.string().datetime(),
});

export type AuthenticityScore = z.infer<typeof AuthenticityScoreSchema>;

export const DecisionSchema = z.object({
  decision_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  context: z.string(),
  action: z.string(),
  authenticity_score: AuthenticityScoreSchema.optional(),
  vulnerability_context: z.array(z.string()),
  influence_context: z.array(z.string()),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const ConflictPredictionSchema = z.object({
  prediction_id: z.string().uuid(),
  attempt_ids: z.tuple([z.string().uuid(), z.string().uuid()]),
  conflict_type: z.enum(['file', 'resource', 'semantic', 'goal']),
  severity: z.number().min(0).max(1),
  predicted_at_step: z.number().int().optional(),
  recommended_action: z.enum(['reroute', 'serialize', 'merge', 'ignore']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export type ConflictPrediction = z.infer<typeof ConflictPredictionSchema>;

export const InterventionActionSchema = z.object({
  intervention_id: z.string().uuid(),
  action_type: z.enum([
    'warn',
    'block',
    'reroute',
    'add_context',
    'request_confirmation',
    'delay',
    'escalate',
  ]),
  target: z.string(),
  message: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  executed: z.boolean(),
  outcome: z.string().optional(),
});

export type InterventionAction = z.infer<typeof InterventionActionSchema>;

export const SelfAuditResultSchema = z.object({
  audit_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  agent_behavior: z.object({
    alignment_with_user_values: z.number().min(0).max(1),
    transparency_score: z.number().min(0).max(1),
    consent_respect: z.number().min(0).max(1),
    privacy_preservation: z.number().min(0).max(1),
  }),
  concerns: z.array(z.string()),
  recommendations: z.array(z.string()),
  passed: z.boolean(),
});

export type SelfAuditResult = z.infer<typeof SelfAuditResultSchema>;

export const IntentDisambiguationSchema = z.object({
  disambiguation_id: z.string().uuid(),
  original_intent: z.string(),
  disambiguated_intents: z.array(z.object({
    intent: z.string(),
    confidence: z.number().min(0).max(1),
    context: z.string(),
  })),
  ambiguity_source: z.enum(['vague_language', 'conflicting_goals', 'missing_context', 'cognitive_bias']),
  recommended_action: z.string(),
});

export type IntentDisambiguation = z.infer<typeof IntentDisambiguationSchema>;

export const ConflictPredictionRequestSchema = z.object({
  task: z.any(),
  active_attempts: z.array(z.object({
    attempt_id: z.string().uuid(),
    config_id: z.string().uuid(),
    current_state: z.record(z.any()),
    recent_actions: z.array(z.string()),
  })),
});

export type ConflictPredictionRequest = z.infer<typeof ConflictPredictionRequestSchema>;

export const ConflictPredictionResponseSchema = z.object({
  predicted_conflicts: z.array(ConflictPredictionSchema),
});

export type ConflictPredictionResponse = z.infer<typeof ConflictPredictionResponseSchema>;

export const GBrainCognitiveQuerySchema = z.object({
  query_type: z.enum(['beliefs', 'desires', 'intentions', 'biases']),
  context: z.string(),
  time_range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }).optional(),
});

export type GBrainCognitiveQuery = z.infer<typeof GBrainCognitiveQuerySchema>;

export const GBrainCognitiveResponseSchema = z.object({
  beliefs: z.array(z.object({
    content: z.string(),
    confidence: z.number().min(0).max(1),
    source: z.string(),
  })),
  desires: z.array(z.object({
    content: z.string(),
    priority: z.number().min(0).max(1),
  })),
  intentions: z.array(z.object({
    content: z.string(),
    timeframe: z.string(),
  })),
  biases: z.array(z.object({
    type: z.string(),
    strength: z.number().min(0).max(1),
  })),
});

export type GBrainCognitiveResponse = z.infer<typeof GBrainCognitiveResponseSchema>;

// Multi-Model Tier Configuration
export interface TierConfig {
  name: string;
  model_id: string;
  cost_per_1k_tokens_usd: number;
  avg_latency_ms: number;
  use_case: string;
}

export interface MultiModelConfig {
  default_tier: string;
  escalation_enabled: boolean;
  escalation_triggers: {
    min_confidence: number;
    min_quality_score: number;
    max_ambiguity: number;
  };
  consensus_threshold: number;
  cost_budget_usd_per_hour: number;
  allow_tier3: boolean;
}

export interface EscalationMetrics {
  total_tasks: number;
  escalated_tasks: number;
  tier1_success_rate: number;
  tier2_success_rate: number;
  tier3_success_rate: number;
  tier1_count: number;
  tier2_count: number;
  tier3_count: number;
  avg_cost_per_task_usd: number;
  avg_latency_ms: number;
  tier1_avg_latency_ms: number;
  tier2_avg_latency_ms: number;
  tier3_avg_latency_ms: number;
  consensus_agreement_rate: number;
  budget_remaining_usd: number;
}
