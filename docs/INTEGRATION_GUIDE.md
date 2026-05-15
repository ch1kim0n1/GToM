# Integration Guide

## CLI Embedding

Use JSON output for automation:

```bash
gtom score --context "$CONTEXT" --action "$ACTION" --json
gtom vulnerabilities --json
gtom health --json
```

## HTTP Embedding

Start the server:

```bash
npm run serve
```

Call conflict prediction:

```bash
curl -s http://localhost:3003/gtom/predict-conflicts \
  -H 'Content-Type: application/json' \
  -H 'X-Trace-Id: upstream-trace-id' \
  -d '{"task":"merge generated code","active_attempts":[]}'
```

Scrape metrics:

```bash
curl -s http://localhost:3003/metrics
```

## MCP Embedding

Configure an MCP client to launch the GToM MCP server. Enable token auth in shared environments.

```json
{
  "mcpServers": {
    "gtom": {
      "command": "node",
      "args": ["dist/GToM/src/mcp/server.js"],
      "env": {
        "GTOM_MCP_AUTH_REQUIRED": "true"
      }
    }
  }
}
```

## Node Embedding

```ts
import { GToM } from 'gtom';

const gtom = new GToM({
  gbrainEndpoint: process.env.GTOM_GBRAIN_ENDPOINT,
  gbrainAuthToken: process.env.GTOM_GBRAIN_AUTH_TOKEN,
  gbrainMode: 'http',
});
const score = await gtom.scoreDecisionAuthenticity({
  context: 'User is choosing a plan',
  action: 'Buy annual plan',
  userId: 'user-123',
});
```

## GBrain Integration

GToM uses a typed GBrain client for `/health`, `/cognitive/query`, `/pages`, and `/whoknows/:userId`. Every call has a timeout, transient retry with backoff, Zod response validation, bearer-token auth, and circuit-breaker protection. If GBrain is unavailable, GToM degrades to local context instead of failing decision scoring or observation ingestion.

Set `GTOM_GBRAIN_MODE=mcp` and provide a `gbrainMcpClient` when embedding GToM in a process that should call GBrain MCP tools instead of HTTP.

## GStack-Compatible Source Sync

Run the compatibility sync to register the current GToM checkout plus sibling tools as federated GBrain code sources:

```bash
gtom gbrain-sync --incremental
gtom gbrain-sync --full
gtom gbrain-sync --dry-run
```

The sync emits gstack-style stage results, writes `.gbrain-source` in each attached checkout, uses `pathhash8` source IDs so multiple worktrees do not collide, removes legacy non-path-hashed sources, and protects state with a lock file plus stale-lock takeover after five minutes. State is written with tmp+rename under `GTOM_HOME` or `~/.gtom`.
