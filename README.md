# GToM — Cognitive Defense and Theory of Mind System

The cognitive immune system of the G-Stack. GToM models cognitive vulnerability, influence exposure, manipulation detection, and decision authenticity to defend users from manipulation by other systems.

## What It Does

- **Cognitive vulnerability tracking**: Monitor which biases and vulnerabilities are elevated for each user
- **Influence exposure modeling**: Track manipulative influences from content, systems, and designs
- **Manipulation detection**: Identify dark patterns, scarcity timers, social-proof exploitation, attention-economy mechanics
- **Decision authenticity scoring**: Assess how likely decisions reflect stable values vs. induced states
- **Cognitive ICE**: Intrusion Countermeasures for the mind — detect and counter cognitive intrusions
- **Theory of Mind substrate**: Model beliefs, desires, and intentions as a structured mental-state foundation

## Core Product: Cognitive ICE

The marketed name for GToM's user-protective surface is **Cognitive ICE** (Intrusion Countermeasures Electronics, for the mind). It detects and counters:

- Dark patterns and manipulative UI
- Scarcity timers and urgency mechanics
- Social-proof exploitation
- Attention-economy mechanics
- Authority bias triggers
- Cognitive load exploitation

## Installation

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
# Assess decision authenticity
gtom assess --context "user wants to buy product" --action "purchase" --content "Only 2 left! Limited time offer"

# Check cognitive vulnerability state
gtom vulnerability-status --user-id user123

# Scan content for manipulation patterns
gtom scan-content --content "Everyone is buying this! Act now before it's gone!"

# View recent influence exposures
gtom influence-log --user-id user123
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `assess` | Score decision authenticity |
| `vulnerability-status` | View current cognitive vulnerability state |
| `scan-content` | Scan content for manipulation patterns |
| `influence-log` | View recent influence exposures |
| `cognitive-state` | View current theory-of-mind state |
| `ice-alerts` | View cognitive ICE alerts |

## Configuration

GToM uses a configuration file (default: `~/.gtom/config.json`) to define:

- **GBrain endpoint**: Where to read/write cognitive state
- **Vulnerability thresholds**: When to trigger alerts
- **Authenticity thresholds**: What counts as inauthentic
- **ICE sensitivity**: Alert sensitivity levels
- **Influence retention**: How long to track influences

Example configuration:

```json
{
  "endpoints": {
    "gbrain": "http://localhost:3000"
  },
  "vulnerability": {
    "alertThreshold": 0.7,
    "criticalThreshold": 0.9
  },
  "authenticity": {
    "minAuthenticityScore": 0.6,
    "highRiskThreshold": 0.3
  },
  "ice": {
    "sensitivity": "medium",
    "alertOnAuthority": true,
    "alertOnScarcity": true,
    "alertOnSocialProof": true
  },
  "influence": {
    "retentionDays": 30,
    "maxInfluences": 100
  }
}
```

## Architecture

GToM consists of several core modules:

- **VulnerabilityManager**: Tracks cognitive biases and vulnerabilities per user
- **InfluenceLedger**: Records manipulative influences and their effects
- **AuthenticityScorer**: Scores decisions for authenticity based on cognitive state
- **ManipulationDetector**: Identifies dark patterns and manipulation tactics
- **CognitiveStateTracker**: Maintains theory-of-mind state (beliefs, desires, intentions)
- **ICEEngine**: Generates cognitive ICE alerts and countermeasures

## Vulnerability Categories

GToM tracks 10 cognitive vulnerability categories:

1. **Authority bias** — Susceptibility to authority figures
2. **Scarcity fear** — Fear of missing out
3. **Social proof** — Influence of social pressure
4. **Reciprocity** — Obligation to return favors
5. **Commitment consistency** — Desire to act consistently with past actions
6. **Liking** — Influence from sources we like
7. **Authority deference** — Default deference to perceived experts
8. **Loss aversion** — Fear of loss over gain
9. **Anchoring** — Reliance on first information
10. **Confirmation bias** — Preference for confirming information

## Authenticity Scoring

GToM produces authenticity scores based on:

- **Self-alignment**: How well the decision aligns with the user's stated goals
- **External pressure**: How much external pressure influenced the decision
- **Cognitive load**: Whether the decision was made under high cognitive load
- **Vulnerability levels**: Which vulnerabilities were elevated
- **Recent influences**: What manipulative influences were recently exposed

Scores range from 0-1, with higher scores indicating more authentic decisions.

## MCP Integration

GToM exposes an MCP server for Claude Code integration:

```json
{
  "mcpServers": {
    "gtom": {
      "command": "gtom",
      "args": ["mcp"]
    }
  }
}
```

Exposed tools:
- `gtom_assess` — Score decision authenticity
- `gtom_vulnerability` — Query vulnerability state
- `gtom_scan` — Scan content for manipulation
- `gtom_state` — Query cognitive state
- `gtom_ice` — Query ICE alerts

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Full verification
npm run verify

# Watch mode
npm run dev
```

## Testing

GToM includes comprehensive test coverage:

- Unit tests for core modules (vulnerability, authenticity, ICE)
- Behavioral tests for vulnerability detection
- Authenticity scoring tests with various scenarios
- Influence ledger tests
- Cognitive state tracking tests

Run tests:

```bash
npm test                    # All tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

## Environment Variables

- `GBRAIN_ENDPOINT` — Override GBrain endpoint
- `VULNERABILITY_ALERT_THRESHOLD` — Override vulnerability alert threshold
- `AUTHENTICITY_MIN_SCORE` — Override minimum authenticity score
- `ICE_SENSITIVITY` — Override ICE sensitivity (low/medium/high)

## Contributing

See `ARCHITECTURE.md` for detailed design documentation.

## License

MIT
