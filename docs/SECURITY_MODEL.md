# Security Model

## Trust Boundaries

- CLI users are local operators.
- MCP clients are untrusted unless token auth is enabled.
- GBrain and LLM providers are external services.
- Receipts are local evidence and are HMAC signed.

## Controls

- MCP token scopes: read, write, admin.
- MCP per-token rate limits.
- Receipt HMAC signing and verification.
- PII redaction in logs and audit records.
- Budget caps for LLM calls.
- Backup/restore commands that operate on known persistence roots.

## Secrets

Never commit:

- `GTOM_RECEIPT_HMAC_SECRET`
- LLM API keys
- MCP tokens
- Postgres URLs with credentials

## Audit Evidence

GToM writes:

- `~/.gtom/audit/decisions-YYYY-Www.jsonl`
- `~/.gtom/audit/shell-jobs-YYYY-Www.jsonl`
- signed execution receipts under `gtom/test/baselines/`

Audit entries are JSONL and PII-redacted before write.
