# GToM Architecture

## System Overview

GToM is a cognitive-state and cognitive-defense system that models vulnerability, influence, and authenticity to defend users from manipulation.

## Core Components

### 1. VulnerabilityManager
**Location**: `src/core/vulnerability.ts`

Tracks cognitive vulnerabilities per user:
- Manages 10 cognitive vulnerability categories
- Processes observations to update vulnerability levels
- Tracks evidence counts and recent exposures
- Provides current vulnerability state

### 2. InfluenceLedger
**Location**: Integrated in VulnerabilityManager

Records manipulative influences:
- Tracks influence events from various sources
- Records surface (UI, notification, social, etc.)
- Records source (user input, external signal, etc.)
- Maintains influence history for analysis

### 3. AuthenticityScorer
**Location**: `src/core/authenticity.ts`

Scores decision authenticity:
- Analyzes context, action, and cognitive state
- Calculates self-alignment score
- Calculates external pressure penalty
- Applies vulnerability and influence penalties
- Returns authenticity score with manipulation indicators

### 4. ManipulationDetector
**Location**: Integrated in VulnerabilityManager

Detects manipulation patterns:
- Authority bias patterns (expert, authority, doctor, CEO, management, official)
- Scarcity patterns (limited time, only X left, expiring soon)
- Social proof patterns (everyone is, trending, popular)
- Urgency patterns (act now, don't wait, immediate)

### 5. CognitiveStateTracker
**Location**: Integrated in system

Maintains theory-of-mind state:
- Beliefs, desires, intentions
- Trust level, cognitive load, emotional state
- Attention focus, decision fatigue
- Updates based on observations and influences

### 6. ICEEngine
**Location**: Integrated in system

Generates cognitive ICE alerts:
- Triggers alerts when vulnerabilities exceed thresholds
- Identifies active manipulation patterns
- Provides countermeasure suggestions
- Maintains alert history

## Vulnerability Categories

1. **Authority bias** — Susceptibility to authority figures
2. **Scarcity fear** — Fear of missing out
3. **Social proof** — Influence of social pressure
4. **Reciprocity** — Obligation to return favors
5. **Commitment consistency** — Desire to act consistently
6. **Liking** — Influence from sources we like
7. **Authority deference** — Default deference to experts
8. **Loss aversion** — Fear of loss over gain
9. **Anchoring** — Reliance on first information
10. **Confirmation bias** — Preference for confirming information

## Data Flow

```
Observation (content, surface, source)
    ↓
ManipulationDetector (detect patterns)
    ↓
VulnerabilityManager (update vulnerability levels)
    ↓
InfluenceLedger (record influence event)
    ↓
CognitiveStateTracker (update mental state)
    ↓
AuthenticityScorer (score decision authenticity)
    ↓
AuthenticityScore (score, factors, manipulation indicators)
    ↓
ICEEngine (trigger alerts if needed)
```

## Authenticity Scoring

```typescript
interface AuthenticityScore {
  score_id: string;
  authenticity_score: number; // 0-1
  confidence: number; // 0-1
  factors: {
    self_alignment: number;
    external_pressure: number;
    cognitive_load_penalty: number;
    vulnerability_penalty: number;
    influence_penalty: number;
  };
  manipulation_indicators: string[];
}
```

## Key Design Decisions

### Cognitive Defense Focus
- Primary focus on detecting and countering manipulation
- Theory of Mind as substrate, not headline
- Cognitive ICE as product framing

### Non-Autonomous
- GToM does not make decisions for users
- Provides information and alerts
- Users (or their agents) make final decisions

### No Self-Exploitation
- Hard constraint: GToM must not exploit vulnerabilities
- Even if effective, manipulation is prohibited
- Ethical boundary is non-negotiable

### Continuous Tracking
- Vulnerability levels change over time
- Influence history matters
- Cognitive state is dynamic, not static

## Configuration Schema

```typescript
interface GToMConfig {
  endpoints: {
    gbrain: string;
  };
  vulnerability: {
    alertThreshold: number;
    criticalThreshold: number;
  };
  authenticity: {
    minAuthenticityScore: number;
    highRiskThreshold: number;
  };
  ice: {
    sensitivity: 'low' | 'medium' | 'high';
    alertOnAuthority: boolean;
    alertOnScarcity: boolean;
    alertOnSocialProof: boolean;
  };
  influence: {
    retentionDays: number;
    maxInfluences: number;
  };
}
```

## Error Handling Strategy

- **GBrain unavailable**: Use in-memory tracking, log warning
- **Observation parsing failure**: Skip observation, log error
- **Scoring failure**: Return default score, log error

## Extension Points

- **Custom vulnerability categories**: Add domain-specific vulnerabilities
- **Custom manipulation patterns**: Add pattern detection rules
- **Alternative scoring models**: Implement different authenticity algorithms
- **Custom alert rules**: Domain-specific alert triggers

## Testing Strategy

- Unit tests for each core module
- Vulnerability detection tests with various content patterns
- Authenticity scoring tests with different scenarios
- Influence ledger tests
- Cognitive state tracking tests
