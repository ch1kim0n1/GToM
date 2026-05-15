# Performance

## SLOs and SLIs

Primary service-level indicators:

- `predict_conflict_p95_ms`: p95 latency for `POST /gtom/predict-conflicts`.
- `score_decision_p95_ms`: p95 latency for authenticity scoring.
- `http_error_rate`: non-2xx responses divided by total HTTP requests.
- `backpressure_queue_depth`: queued GToM operations.
- `cache_hit_rate`: GBrain context cache hits divided by hits plus misses.
- `heap_used_bytes`: Node heap used during steady-state load.

Default service-level objectives:

- `POST /gtom/predict-conflicts` p95 under 500 ms for local inference paths.
- Authenticity scoring p95 under 1500 ms when no remote LLM is configured.
- HTTP error rate below 1% excluding intentional 4xx validation responses.
- Backpressure queue depth below `GTOM_MAX_QUEUED_OPERATIONS`.
- Heap growth below 25 MB across the memory profile workload.

## Runtime Controls

- Backpressure: `GTOM_MAX_CONCURRENT_OPERATIONS` and `GTOM_MAX_QUEUED_OPERATIONS`.
- Cache: `GTOM_CACHE_MAX_ENTRIES`, `GTOM_CACHE_TTL_MS`, and per-call `bypassCache`.
- Cancellation: pass `CancellationToken` through GToM operation options or disconnect from the streaming HTTP endpoint.
- Progress: pass `onProgress` through GToM operation options or use `POST /gtom/predict-conflicts/stream`.
- Model resolution: the LLM client uses the exported eight-tier `MODEL_RESOLUTION_CHAIN`.

## Benchmarking

```bash
npm run build
npm run benchmark
npm run profile:memory
```

`npm run benchmark` writes `benchmarks/latest.json` and compares p95 latency to `benchmarks/gtom-baseline.json`. Set `BENCHMARK_ENFORCE=1` in CI to fail on regression.

## Load Testing

Start the server first:

```bash
npm run build
npm run serve
```

Run either load test:

```bash
k6 run scripts/load-test-k6.js
artillery run scripts/artillery.yml
```

Both scripts target `http://localhost:3003` by default. For k6, override with `GTOM_URL`, `VUS`, and `DURATION`.
