# Eval Baselines

GToM evals produce signed receipts that can be used for regression gates.

## Baseline Files

- `test/baselines/regression-baselines-v1.jsonl`: deterministic baseline scenarios.
- `gtom/test/baselines/receipts-YYYY-Www.jsonl`: runtime receipt output.
- `gtom/test/baselines/schema.json`: receipt schema metadata.

## Commands

```bash
gtom eval --json
gtom receipts --since 7d --json
gtom regress --baseline <receipt-a.jsonl> --current <receipt-b.jsonl> --json
npm run eval:record
npm run eval:summary
npm run eval:compare
```

## Regression Dimensions

Receipts track:

- `overall_score`
- per-dimension scores and confidence
- hard-gate pass/fail
- `cost_usd`
- `latency_ms`
- `tier1_success_rate`

Regression checks use Wilson intervals where sample sizes are available.
