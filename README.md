## Quickstart (60 seconds)

```bash
npm install gtom
```

```typescript
import { GToMSDK } from 'gtom';
const gtom = new GToMSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
const result = await gtom.check('Limited time offer! Act NOW before it\'s too late!');
console.log(result.safe, result.manipulationPatterns);
```

> No Docker. No services. Detect manipulation patterns and cognitive safety risks in any text.

---

# GToM

GToM is the G-Stack cognitive defense and Theory of Mind service. It tracks cognitive vulnerability, detects influence patterns, scores decision authenticity, predicts conflicts, and exposes the same capabilities through CLI, HTTP, and MCP surfaces.

## Capabilities

- Vulnerability tracking for authority bias, scarcity pressure, social proof, framing effects, emotional manipulation, and related influence patterns.
- Decision authenticity scoring with multi-model consensus, local fallback, receipts, cost accounting, and regression gates.
- Conflict prediction for orchestrator workflows.
- Health, drift, persistence backup/restore/export, observability metrics, and audit receipts.
- MCP tools for embedding in agent workflows.

## Install

```bash
npm install
npm run build
```

Optional local CLI link:

```bash
npm link
gtom --help
```

## Quick Start

```bash
gtom ingest --content "Only 2 seats left. Buy now." --surface checkout --source user_input
gtom score --context "User is choosing a subscription" --action "Buy annual plan"
gtom vulnerabilities --json
gtom health --json
gtom metrics --format prometheus
gtom backup --output-dir ./.gtom/backups --json
```

## Main Commands

| Command | Purpose |
| --- | --- |
| `ingest` | Ingest an observation and update vulnerability state. |
| `score` | Score decision authenticity. |
| `audit` | Run a Cognitive ICE self-audit. |
| `vulnerabilities` | Show current vulnerability state. |
| `health` | Check dependencies, schema, queue health, freshness, and trends. |
| `eval` | Run authenticity eval cases and emit receipts. |
| `replay` | Replay receipts or corpus hashes. |
| `regress` | Compare receipts against regression tolerances. |
| `receipts` | List signed execution receipts. |
| `diff` | Diff two receipts. |
| `trend` | Analyze vulnerability trends. |
| `drift` | Detect metric/cohort drift. |
| `decay` | Apply vulnerability decay. |
| `reset` | Reset vulnerability state with confirmation. |
| `cost` | Show LLM spend summaries. |
| `metrics` | Export JSON, Prometheus, or OpenTelemetry-style metrics. |
| `backup` | Create a rotated persistence backup. |
| `restore` | Restore a persistence backup. |
| `export` | Export persistence data as JSON. |
| `migrate` | Migrate receipt JSONL files between supported schema versions. |
| `version-info` | Print package, schema, rubric, and API stability metadata. |
| `gbrain-sync` | Run gstack-compatible GBrain source sync for GToM and sibling tools. |
| `completion` | Print shell completion scripts. |

## Versioning

GToM follows SemVer for the published CLI, HTTP, MCP, receipt, and rubric surfaces:

- Patch releases fix bugs without changing public contracts.
- Minor releases add backward-compatible commands, endpoints, fields, or rubric dimensions.
- Major releases remove deprecated surfaces or introduce incompatible schema/rubric changes.

Release tags use `gtom-vMAJOR.MINOR.PATCH`, for example `gtom-v0.1.0`. API stability is tracked in code via `gtom version-info --json` and documented in [Versioning](docs/VERSIONING.md). Receipt schema migrations are explicit; migrate v1 receipts to the current schema with:

```bash
gtom migrate --from 1 --to 2 --input ./receipts-v1.jsonl --output ./receipts-v2.jsonl
```

## HTTP

The HTTP server exposes:

- `POST /gtom/predict-conflicts`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`
- `GET /metrics/otel`

Run:

```bash
npm run serve
```

## MCP

See [docs/MCP_CONTRACT.md](docs/MCP_CONTRACT.md) for the tool list, auth scopes, rate limits, and response contracts.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data flow](docs/DATA_FLOW.md)
- [Migrations](MIGRATIONS.md)
- [Operations](OPERATIONS.md)
- [Testing](TESTING.md)
- [Versioning](docs/VERSIONING.md)
- [Cross-tool integration](docs/CROSS_TOOL_INTEGRATION.md)
- [Runbook](docs/RUNBOOK.md)
- [Incident response](docs/INCIDENT_RESPONSE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Integration guide](docs/INTEGRATION_GUIDE.md)
- [Eval baselines](docs/EVAL_BASELINES.md)
- [ADRs](docs/adr/0001-observability-and-receipts.md)
- API docs: run `npm run docs:api` and open `docs/api/index.html`.

## Using GToM in your own application

GToM works as a standalone cognitive-safety library — no other g-tools required. The three examples below show common integration patterns.

### 1. Decision Audit Log

Any application that logs consequential decisions can use GToM to detect whether cognitive vulnerabilities influenced those decisions over time.

```typescript
import { GToM } from './src/core/gtom.js';

const gtom = new GToM();

// Log each observation as the user encounters influence events
await gtom.ingestObservation({
  content: 'Upgrade now — only 3 seats left at this price!',
  surface: 'checkout',
  source: 'page_content',
  userId: 'user-123',
});

await gtom.ingestObservation({
  content: 'Experts unanimously recommend the premium plan.',
  surface: 'checkout',
  source: 'page_content',
  userId: 'user-123',
});

// Read accumulated vulnerability state before the user commits
const vulnerabilities = gtom.getVulnerabilities();
const highRisk = vulnerabilities.filter(v => v.level === 'high');

if (highRisk.length > 0) {
  console.log('Decision made under influence:', highRisk.map(v => v.pattern));
  // Log, flag for review, or surface a nudge to the user
}
```

### 2. Content Moderation

Detect manipulation patterns in user-generated content or agent outputs before they reach end users.

```typescript
import { GToM } from './src/core/gtom.js';

const gtom = new GToM();

async function moderateContent(text: string, authorId: string): Promise<boolean> {
  await gtom.ingestObservation({
    content: text,
    surface: 'user_message',
    source: 'user_input',
    userId: authorId,
  });

  const vulns = gtom.getVulnerabilities();
  // Check for patterns like authority_bias, scarcity_pressure, social_proof
  const manipulativePatterns = vulns.filter(
    v => ['authority_bias', 'scarcity_pressure', 'coercive_framing'].includes(v.pattern)
      && v.level !== 'low'
  );

  if (manipulativePatterns.length > 0) {
    console.warn(`Blocked content from ${authorId}: patterns=${manipulativePatterns.map(p => p.pattern)}`);
    return false; // block
  }
  return true; // allow
}
```

### 3. A/B Test Cognitive Safety

Score whether a UI variant creates more decision fatigue or vulnerability than the control, using GToM's authenticity scorer as an objective signal.

```typescript
import { GToM } from './src/core/gtom.js';

async function scoreCognitiveLoad(
  variantLabel: string,
  userContext: string,
  proposedAction: string,
): Promise<number> {
  const gtom = new GToM();

  // Score the decision authenticity for this variant
  const result = await gtom.scoreDecisionAuthenticity({
    context: userContext,
    action: proposedAction,
  });

  console.log(`${variantLabel}: authenticity=${result.authenticity_score.toFixed(2)}, confidence=${result.confidence.toFixed(2)}`);
  // Lower authenticity score signals more cognitive pressure / decision fatigue
  return result.authenticity_score;
}

// Compare control vs. treatment variant
const controlScore   = await scoreCognitiveLoad('control',   'User viewing pricing page', 'Choose monthly plan');
const treatmentScore = await scoreCognitiveLoad('treatment', 'User viewing pricing page (urgent banner)', 'Choose monthly plan');

if (treatmentScore < controlScore - 0.1) {
  console.warn('Treatment variant reduces decision authenticity — review before shipping.');
}
```

## Environment

| Variable | Purpose |
| --- | --- |
| `GTOM_MAX_BUDGET_USD` | Max command/session LLM budget. |
| `GTOM_RESOLVER_CAPS_USD` | Comma-separated resolver caps, for example `gtom:1.50`. |
| `GTOM_SCOPE_CAPS_USD` | Comma-separated scope caps. |
| `GTOM_RECEIPT_HMAC_SECRET` | HMAC secret for signed receipts. |
| `GTOM_RECEIPT_POSTGRES_URL` | Optional durable receipt mirror. |
| `GTOM_POSTGRES_READ_REPLICA_URL` | Optional Postgres read replica. |
| `GTOM_GBRAIN_ENDPOINT` | GBrain HTTP endpoint. Falls back to `GBRAIN_ENDPOINT` or `http://localhost:3000`. |
| `GTOM_GBRAIN_AUTH_TOKEN` | Bearer token for GBrain HTTP requests. Falls back to `GBRAIN_AUTH_TOKEN`. |
| `GTOM_GBRAIN_MODE` | `http` or `mcp` integration mode for GBrain. |
| `GTOM_GBRAIN_TIMEOUT_MS` | Per-call timeout for GBrain requests. |
| `GTOM_GBRAIN_MAX_RETRIES` | Retry count for transient GBrain failures. |
| `GTOM_GBRAIN_CIRCUIT_FAILURE_THRESHOLD` | Failure count before opening the GBrain circuit breaker. |
| `GTOM_HOME` | Optional home for GToM local state; GBrain sync uses `~/.gtom` by default. |
| `GTOM_HEALTH_WEBHOOK_URL` | Webhook called when health drops below healthy. |
| `GTOM_MCP_AUTH_REQUIRED` | Require MCP token auth when set to `true`. |
| `GTOM_MCP_READ_TOKEN` | Read-scope MCP token. |
| `GTOM_MCP_WRITE_TOKEN` | Write-scope MCP token. |
| `GTOM_MCP_ADMIN_TOKEN` | Admin-scope MCP token. |

## Verification

```bash
npm run typecheck
npm test -- --runInBand
npm run build
npm run check:all
```

## License

MIT
