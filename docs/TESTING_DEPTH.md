# Testing Depth

## Test Tiers

- Unit and regression: `npm test`.
- Coverage gate: `npm run test:coverage`, enforced at 80% statements, functions, and lines with a branch floor.
- Integration: `npm run test:integration` with `INTEGRATION=1` and provider keys; nightly CI runs this path.
- Property tests: `npm run test:property` using `fast-check`.
- Chaos tests: `npm run test:chaos`.
- Fuzz tests: `npm run test:fuzz`.
- Stability tests: `npm run test:stability`; local smoke defaults to a short loop, CI or nightly can set `STABILITY=1` for a longer run.
- Concurrent access: `npm run test:concurrent`.
- Consumer contracts: `npm run test:contracts` verifies the Pact fixture in `contracts/`.
- Flaky detection: `npm run test:flaky` repeats Jest and fails on any intermittent run.
- Mutation testing: `npm run test:mutation` uses `stryker.conf.json`.

## Cross-Tool E2E

The consumer contract fixture models the gstack/gorchestrator to GToM conflict-prediction boundary. In the full stack, the intended path is:

```text
gorchestrator -> gmirror -> GToM -> glearn -> gagent
```

GToM owns the `POST /gtom/predict-conflicts` provider contract and the MCP contract in `docs/MCP_CONTRACT.md`; sibling repos should consume those contracts in their own e2e suites.
