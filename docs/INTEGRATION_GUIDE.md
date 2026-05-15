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

const gtom = new GToM({ gbrainEndpoint: 'http://localhost:3000' });
const score = await gtom.scoreDecisionAuthenticity({
  context: 'User is choosing a plan',
  action: 'Buy annual plan',
});
```
