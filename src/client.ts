/**
 * GToM HTTP client
 */

export interface ConflictPredictionInput {
  task: string;
  active_attempts?: Array<{
    attempt_id: string;
    config_id: string;
    current_state: Record<string, unknown>;
    recent_actions: string[];
  }>;
  context?: string;
  constraints?: string[];
}

export interface ConflictPredictionResponse {
  task: string;
  conflicts: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    probability: number;
  }>;
  overall_risk: 'low' | 'medium' | 'high';
  confidence: number;
  timestamp: string;
}

export interface RelationalConflictRequest {
  dyad_id: string;
  participant_a: Record<string, unknown>;
  participant_b: Record<string, unknown>;
  message_window: Array<Record<string, unknown>>;
  analysis_mode: 'relational';
}

export interface RelationalConflictResponse {
  dyad_id: string;
  predicted_conflicts: Array<{
    conflict_type: string;
    severity: number;
    description: string;
    recommended_action: string;
    confidence: number;
  }>;
  aggregate_risk: number;
  recommendation: string;
  confidence: number;
  timestamp: string;
}

export interface BidAuthenticityInput {
  bid_text: string;
  bid_type?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BidAuthenticityResult {
  is_authentic: boolean;
  authenticity_score: number;
  is_proportionate: boolean;
  is_safe_to_respond: boolean;
  confidence: number;
  reasoning?: string;
  timestamp: string;
}

export interface AttachmentState {
  dyad_id: string;
  bid_responsiveness?: number;
  repair_willingness?: number;
  attachment_security?: number;
  emotional_labor_ratio?: number;
  [key: string]: unknown;
}

export interface HealthResult {
  status: string;
  timestamp: string;
  [key: string]: unknown;
}

export class GToMClient {
  private baseUrl: string;
  private token?: string;

  constructor(options: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl = options.baseUrl ?? 'http://localhost:3003';
    this.token = options.token;
  }

  /** POST /gtom/predict-conflicts */
  async predictConflicts(request: ConflictPredictionInput): Promise<ConflictPredictionResponse> {
    return this.request<ConflictPredictionResponse>('POST', '/gtom/predict-conflicts', request);
  }

  /** POST /gtom/predict-relational-conflicts */
  async predictRelationalConflicts(request: RelationalConflictRequest): Promise<RelationalConflictResponse> {
    return this.request<RelationalConflictResponse>('POST', '/gtom/predict-relational-conflicts', request);
  }

  /** POST /gtom/score-bid */
  async scoreBid(input: BidAuthenticityInput): Promise<BidAuthenticityResult> {
    return this.request<BidAuthenticityResult>('POST', '/gtom/score-bid', input);
  }

  /** GET /gtom/attachment-state/:dyad_id */
  async getAttachmentState(dyadId: string): Promise<AttachmentState> {
    return this.request<AttachmentState>('GET', `/gtom/attachment-state/${encodeURIComponent(dyadId)}`);
  }

  /** GET /health/live */
  async health(): Promise<HealthResult> {
    return this.request<HealthResult>('GET', '/health/live');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}
