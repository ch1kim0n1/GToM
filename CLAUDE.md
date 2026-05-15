# GToM — Agent-Readable Contract

## Purpose
GToM (Theory of Mind) predicts conflicts and models cognitive/emotional state. It currently targets **AI agent conflicts** (file/resource/semantic/goal collisions between parallel task attempts). For DYAD it must be extended to model **human–human relational dynamics** — the same underlying framework applies, but the vocabulary, conflict types, and state model must cover emotional bids, repair attempts, and attachment dynamics.

## Current Core Capabilities
- Predict conflicts between parallel agent attempts
- Model cognitive state (cognitive_load, trust_level, emotional_state, decision_fatigue)
- Detect external influence / manipulation indicators
- Score decision authenticity (AuthenticityScorer)
- HTTP server on port 3003 (`POST /gtom/predict-conflicts`, `/health/live`, `/health/ready`)
- Receipt storage (JSONL per ISO week), SQLite persistence with schema_version + migrations
- Observability (`GET /metrics`, `GET /metrics/otel`, redacted structured logs, local audit JSONL)

## API Contract (current)

### Conflict Prediction
```typescript
interface ConflictPredictionRequest {
  task: string;
  active_attempts: Array<{
    attempt_id: string;
    config_id: string;
    current_state: Record<string, any>;
    recent_actions: string[];
  }>;
}

interface ConflictPredictionResponse {
  predicted_conflicts: ConflictPrediction[];
  aggregate_risk: number;       // 0–1
  recommendation: string;
  confidence: number;
}

interface ConflictPrediction {
  prediction_id: string;
  attempt_ids: [string, string];
  conflict_type: 'file' | 'resource' | 'semantic' | 'goal';
  severity: number;             // 0–1
  recommended_action: 'serialize' | 'merge' | 'reroute' | 'abort';
  reasoning: string;
  confidence: number;
}
```

### Cognitive State
```typescript
interface CognitiveState {
  state_id: string;
  trust_level: number;          // 0–1
  cognitive_load: number;       // 0–1
  emotional_state: 'neutral' | 'positive' | 'negative' | 'stressed' | 'excited';
  attention_focus: string;
  decision_fatigue: number;     // 0–1
  timestamp: string;
}
```

---

## What Must Change for DYAD

### 1. New Conflict Mode: `relational`
Add a second operating mode alongside the existing agent-conflict mode. Engineers must add:

```typescript
// New conflict types for relational mode
type RelationalConflictType =
  | 'bid_ignored'           // emotional bid sent, no acknowledgment
  | 'bid_rejected'          // bid acknowledged but turned away
  | 'repair_refused'        // repair attempt rejected by partner
  | 'labor_asymmetry'       // one party carries disproportionate emotional labor
  | 'phantom_third_party'   // external influence disrupting dyad equilibrium
  | 'attachment_threat'     // security of attachment bond threatened

// New request type for DYAD
interface RelationalConflictRequest {
  dyad_id: string;
  participant_a: RelationalParticipant;
  participant_b: RelationalParticipant;
  message_window: DyadMessage[];   // recent messages to analyze
  analysis_mode: 'relational';
}

interface RelationalParticipant {
  participant_id: string;
  attachment_style?: 'secure' | 'anxious' | 'avoidant' | 'disorganized';
  recent_bid_history: BidEvent[];
  emotional_signature: EmotionalSignature;
}
```

**File to modify:** `src/core/conflict-predictor.ts` — add `predictRelationalConflicts()` method alongside the existing `predictConflicts()`.

### 2. Extend CognitiveState for Relational Context
The current `emotional_state` is a single enum. For DYAD it must carry relational-specific fields:

```typescript
interface RelationalCognitiveState extends CognitiveState {
  bid_responsiveness: number;   // 0–1, how responsive this person has been to bids
  repair_willingness: number;   // 0–1
  attachment_security: number;  // 0–1 (derived from recent bid/response pattern)
  emotional_labor_ratio: number; // >1 means this party is carrying more
}
```

**File to modify:** `src/types/index.ts` — extend `CognitiveStateSchema`.

### 3. Phantom Third Party Detector
The existing external influence / manipulation detection in `src/core/vulnerability.ts` is the right substrate. For DYAD, add a `PhantomThirdParty` vulnerability category:

```typescript
// In vulnerability categories, add:
| 'phantom_third_party'   // a third party whose presence affects the dyad
                           // (e.g., ex-partner, parent, colleague being triangulated)
```

Wire the existing `VulnerabilityManager.detectInfluencePatterns()` to recognize message patterns that indicate triangulation or third-party emotional influence.

### 4. AuthenticityScorer → Bid/Response Authenticity
The existing `AuthenticityScorer.scoreDecision()` can be repurposed. For DYAD, add `scoreBidAuthenticity()` that evaluates whether an emotional bid is:
- Genuine (not manipulative / coercive)
- Proportionate to the emotional context
- Safe to respond to (no hidden compliance pressure)

**File to modify:** `src/core/authenticity.ts`

### 5. New HTTP Endpoints
Add to `src/server.ts`:
- `POST /gtom/predict-relational-conflicts` — takes `RelationalConflictRequest`
- `POST /gtom/score-bid` — takes a single bid+context, returns authenticity score
- `GET /gtom/attachment-state/:dyad_id` — returns current relational cognitive state

### 6. DriftDetector for Relationship Trends
The existing `DriftDetector` in the constructor is wired but unused. For DYAD, feed it:
- `bid_acceptance_rate` metric per dyad
- `repair_success_rate` metric per dyad

Alert when either drops by >20% over a 7-day window — this signals a deteriorating relationship.

---

## Persistence
- SQLite: local default via `vulnerability-persistence.ts`
- PostgreSQL: supported for concurrent writers and read replicas
- Schema migrations: `migrations/*.sql` via `src/core/migrate.ts`
- Receipts: `GToM/test/baselines/receipts-YYYY-Www.jsonl`
- Audit: `~/.gtom/audit/decisions-YYYY-Www.jsonl` and `shell-jobs-YYYY-Www.jsonl`

## Service Port
Default: `3003`

## Integration Points
- **Called by:** GOrchestrator (conflict pre-check before parallel execution), DYAD (relational analysis pipeline)
- **Calls:** GBrain (entity enrichment), shared/ DriftDetector, CostLedger, AuditLogger
