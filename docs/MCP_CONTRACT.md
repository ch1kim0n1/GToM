# MCP Contract

GToM exposes an MCP server for agent workflows. The server is implemented in `src/mcp/server.ts`.

## Tools

| Tool | Scope | Purpose |
| --- | --- | --- |
| `gtom_ingest` | write | Ingest observation content. |
| `gtom_score` | write | Score decision authenticity. |
| `gtom_get_vulnerabilities` | read | Return vulnerability state. |
| `get_vulnerabilities` | read | Alias for vulnerability state. |
| `gtom_health` | read | Return health check details. |
| `health` | read | Alias for health check. |
| `gtom_get_receipts` | read | Return execution receipts. |
| `get_receipts` | read | Alias for receipts. |
| `gtom_get_drift` | read | Return drift detection results. |
| `get_drift` | read | Alias for drift detection. |
| `gtom_get_cost` | read | Return budget and cost summary. |
| `get_cost` | read | Alias for cost summary. |
| `gtom_get_authenticity_history` | read | Return authenticity history summary. |
| `get_authenticity_history` | read | Alias for authenticity history. |
| `gtom_get_indicators` | read | Return manipulation indicators. |
| `get_indicators` | read | Alias for indicators. |

## Auth

Set `GTOM_MCP_AUTH_REQUIRED=true` to require bearer tokens.

| Variable | Scope |
| --- | --- |
| `GTOM_MCP_READ_TOKEN` | read |
| `GTOM_MCP_WRITE_TOKEN` | read, write |
| `GTOM_MCP_ADMIN_TOKEN` | read, write, admin |

## Rate Limits

- `GTOM_RATE_LIMIT_RPM`: per-token requests per minute.
- `GTOM_RATE_LIMIT_RPH`: per-token requests per hour.

## Response Shape

Tools return MCP `content` arrays with JSON text payloads. Errors are surfaced as MCP tool errors and are also recorded in structured logs and metrics.
