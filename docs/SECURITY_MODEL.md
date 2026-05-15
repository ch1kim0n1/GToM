# Security Model

## Trust Boundaries

- CLI users are local operators.
- MCP clients are untrusted unless token auth is enabled.
- HTTP callers are public network clients unless the deployment puts GToM behind an authenticated gateway.
- GBrain, gstack, and LLM providers are external services.
- Receipts are local evidence and are HMAC signed.
- The local secret store is trusted only to the current OS user account.

## Controls

- MCP token auth is enabled with `GTOM_MCP_AUTH_REQUIRED=true`.
- MCP token scopes are `read`, `write`, and `admin`; write tools require write scope, read tools accept read or write scope, and admin bypasses narrower checks.
- MCP configured tokens are read from the secret manager first: `GTOM_MCP_ADMIN_TOKEN`, `GTOM_MCP_WRITE_TOKEN`, and `GTOM_MCP_READ_TOKEN`.
- MCP per-token rate limits are controlled by `GTOM_RATE_LIMIT_RPM` and `GTOM_RATE_LIMIT_RPH`.
- HTTP public endpoint rate limits are controlled by `GTOM_HTTP_RATE_LIMIT_RPM` and `GTOM_HTTP_RATE_LIMIT_RPH`.
- HTTP request bodies are capped by `GTOM_HTTP_MAX_BODY_BYTES` and user-facing strings are sanitized for control characters and length.
- Receipt HMAC signing and verification.
- PII redaction in logs and audit records.
- Budget caps for LLM calls.
- Multi-user permissions can be supplied through `GTOM_USERS`, a JSON array of users with `userId`, `roles`, and optional `scopes`.
- Backup/restore commands that operate on known persistence roots.

## Secrets

Use the local secret manager for runtime credentials:

```bash
gtom secrets set OPENAI_API_KEY --value "$OPENAI_API_KEY" --scope llm
gtom secrets set ANTHROPIC_API_KEY --value "$ANTHROPIC_API_KEY" --scope llm
gtom secrets set GTOM_RECEIPT_HMAC_SECRET --value "$GTOM_RECEIPT_HMAC_SECRET" --scope receipts
gtom secrets set GTOM_MCP_WRITE_TOKEN --value "$GTOM_MCP_WRITE_TOKEN" --scope mcp
gtom secrets rotate OPENAI_API_KEY --value "$NEW_OPENAI_API_KEY"
gtom secrets list
```

The default store is `~/.gtom/secrets.json`; override it with `GTOM_SECRETS_FILE`.
Set `GTOM_SECRETS_MASTER_KEY` to encrypt stored values with AES-256-GCM. Without a master key, the store is local-file protected and should be treated like any other credential file.

Environment variables remain supported only as migration fallback. Never commit:

- `GTOM_RECEIPT_HMAC_SECRET`
- LLM API keys
- MCP tokens
- Postgres URLs with credentials
- `GTOM_SECRETS_MASTER_KEY`

## Threat Model

Primary threats and mitigations:

- Unauthorized MCP tool execution: require MCP auth, store tokens in the secret manager, grant the narrowest token scope, and audit failed auth.
- Token guessing or noisy clients: enforce MCP and HTTP rate limits and monitor `security-events-YYYY-Www.jsonl`.
- Credential leakage in logs or receipts: logs, audit records, and receipts are redacted before write; commands never print secret values.
- Malicious CLI or HTTP input: user-facing strings, identifiers, paths, URLs, and JSON request strings are validated for type, length, and control characters.
- Multi-user misuse: declare users and roles in `GTOM_USERS`, then map tokens to least-privilege scopes.
- Receipt tampering: receipts are HMAC signed with the receipt secret; rotate the secret if it is exposed and preserve old evidence separately.

## Audit Evidence

GToM writes:

- `~/.gtom/audit/decisions-YYYY-Www.jsonl`
- `~/.gtom/audit/shell-jobs-YYYY-Www.jsonl`
- `~/.gtom/audit/security-events-YYYY-Www.jsonl`
- signed execution receipts under `gtom/test/baselines/`

Audit entries are JSONL and PII-redacted before write.
