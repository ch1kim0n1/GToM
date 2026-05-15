# GToM Testing Guide

## Test Layout

```text
test/
├── authenticity.test.ts
├── authenticity.baseline.test.ts
├── budget-ledger.test.ts
├── drift-detector.test.ts
├── health-check.test.ts
├── mcp.test.ts
├── observability.test.ts
├── persistence.test.ts
├── receipt-registry.test.ts
├── vulnerability.test.ts
└── gtom.test.ts
```

## Run Tests

```bash
npm test
npm test -- --runInBand
npm run test:watch
npm run test:coverage
npm run typecheck
npm run build
```

## Quality Gates

```bash
npm run check:package
npm run check:docs
npm run check:privacy
npm run check:test-isolation
npm run check:mcp-contract
npm run check:all
```

## API Docs

```bash
npm run docs:api
```

The generated TypeDoc site is written to `docs/api/`.

## Coverage Expectations

- Core behavior: vulnerability, authenticity, ICE, conflict prediction.
- Operational behavior: health, persistence, metrics, backup/restore, receipts.
- Integration behavior: CLI smoke, MCP contract, end-to-end mocked flows.

## Baselines

Regression baselines live in `test/baselines/regression-baselines-v1.jsonl`. Runtime receipts are written under `gtom/test/baselines/`.

Use:

```bash
gtom eval --json
gtom regress --baseline <receipt-a> --current <receipt-b> --json
```
