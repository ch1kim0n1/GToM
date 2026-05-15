# Troubleshooting

## `gtom health` Reports Unhealthy

- `gbrain`: check `--gbrain`, DNS, port, and `/health`.
- If `gbrain` is degraded but the rest of GToM is healthy, inspect `GTOM_GBRAIN_ENDPOINT`, `GTOM_GBRAIN_AUTH_TOKEN`, `GTOM_GBRAIN_TIMEOUT_MS`, and the circuit state in the health details. GToM keeps running with local context while the GBrain circuit is open.
- `llm_api`: verify `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; local fallback is degraded but usable.
- `sync_freshness`: run an eval or score command to emit a fresh receipt.
- `schema_version`: inspect `gtom/test/baselines/schema.json`.
- `queue_health`: check budget reservations and receipt append failures.

## Receipts Fail Signature Verification

Use the same `GTOM_RECEIPT_HMAC_SECRET` that created the receipt. If the secret is lost, treat existing receipts as historical evidence but do not use them as trusted regression inputs.

## Postgres Connection Fails

Verify:

- `EngineConfig.connectionString`
- network access
- database user grants
- read replica URL, if `GTOM_POSTGRES_READ_REPLICA_URL` is set

## Metrics Are Empty

Metrics are process-local. Hit one or more public methods before scraping `GET /metrics` or running `gtom metrics`.

## High LLM Spend

Run:

```bash
gtom cost --by-model --by-operation
```

Set `GTOM_MAX_BUDGET_USD`, `GTOM_RESOLVER_CAPS_USD`, or `GTOM_SCOPE_CAPS_USD`.
