# ADR 0001: Observability and Receipts as Local Evidence

## Status

Accepted

## Context

GToM needs production-parity observability without depending on a hosted control plane for local development and agent embedding.

## Decision

- Public methods record process-local counters, error counters, latency histograms, and spans.
- Metrics can be exported as JSON, Prometheus text, or OpenTelemetry-style JSON.
- Decisions and shell jobs are written as local JSONL audit records.
- Evaluation receipts remain the durable regression and audit evidence.

## Consequences

- Local usage works offline.
- Operators can scrape metrics when running the HTTP server.
- Distributed tracing uses propagated trace headers where available and local spans otherwise.
