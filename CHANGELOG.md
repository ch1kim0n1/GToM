# Changelog

All notable changes to GToM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Persistence surface with SQL migrations, Postgres read-replica support, backup, restore, and export commands.
- Observability surface with redacted structured logs, audit JSONL, Prometheus/OTel metrics, tracing, and Grafana dashboard config.
- Documentation set for migrations, MCP, eval baselines, operations, troubleshooting, security, data flow, integration, ADRs, and API generation.
- `docs:api` script powered by TypeDoc.

### Changed
- Expanded README with current CLI, HTTP, MCP, environment, and verification guidance.
- Updated operations and testing guidance for current quality-parity workflows.

## [0.1.0] - 2026-05-13

### Added
- Vulnerability tracking, authenticity scoring, ICE conflict detection, and cognitive defense foundations
- Jest-based unit, integration, CLI, MCP, and e2e mocked tests
- Quality gates for package contracts, documentation, privacy scanning, test isolation, MCP contracts, and CLI smoke checks
- Eval scripts for local audit history, summary, comparison, and test-tier selection
- MCP server with evaluate and health operations
- CLI commands: evaluate, health
- Integration with GBrain for receipt storage
