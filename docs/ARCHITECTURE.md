# GToM Architecture

## Overview

GToM is a TypeScript service with CLI, HTTP, MCP, and embeddable Node surfaces. The core object is `GToM` in `src/core/gtom.ts`.

## Components

| Component | File | Responsibility |
| --- | --- | --- |
| `GToM` | `src/core/gtom.ts` | Orchestrates vulnerability tracking, authenticity scoring, conflict prediction, health, drift, cost, and observability. |
| `VulnerabilityManager` | `src/core/vulnerability.ts` | Detects influence patterns and maintains vulnerability/cognitive state. |
| `AuthenticityScorer` | `src/core/authenticity.ts` | Scores decisions with consensus and local fallback, then emits receipts. |
| `CognitiveICE` | `src/core/ice.ts` | Runs self-audits and user-protection checks. |
| `ConflictPredictor` | `src/core/conflict-predictor.ts` | Predicts conflict risk between attempts. |
| `ReceiptRegistry` | `src/core/receipt-registry.ts` | Stores signed receipts and optional Postgres mirror writes. |
| `BudgetLedger` | `src/core/budget-ledger.ts` | Tracks LLM reservations and spend. |
| `DriftDetector` | `src/core/drift-detector.ts` | Detects metric drift and cohort anomalies. |
| `Observability` | `src/core/observability.ts` | Provides redacted logs, audit JSONL, metrics, and spans. |

## Surfaces

- CLI: `src/cli.ts`
- HTTP: `src/server.ts`
- MCP: `src/mcp/server.ts`
- Node imports: `src/core/index.ts`

## Persistence

- SQLite for local state.
- Postgres for concurrent-writer production deployments.
- Versioned SQL migrations in `migrations/`.
- Receipts in weekly JSONL files.
- Audit files under `~/.gtom/audit/`.

## Observability

All public methods should record throughput counters, error counters, P50/P95/P99 latency summaries, trace spans, and relevant audit records.

HTTP responses include `X-Trace-Id`, and GBrain probes propagate `X-GToM-Trace-Id` plus `traceparent`.
