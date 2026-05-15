# GToM Versioning

## SemVer Strategy

GToM uses SemVer for public surfaces: CLI commands and JSON output, HTTP endpoints, MCP tools, receipt schemas, and rubric definitions.

- Patch: compatible bug fixes only.
- Minor: additive commands, fields, endpoints, tools, or rubric metadata.
- Major: incompatible removals, renamed fields, or changed scoring semantics.

Releases are tracked with git tags named `gtom-vMAJOR.MINOR.PATCH`. Breaking changes must be called out in the release notes and linked to the issue or commit that introduced the migration.

## API Stability

Stability levels are exported by `gtom version-info --json`.

| Surface | Level | Policy |
| --- | --- | --- |
| CLI | beta | Command names and JSON fields are backward-compatible within a major version. |
| HTTP | beta | Response changes are additive within a minor release. |
| MCP | beta | Tool names and required parameters stay stable within a major version. |
| Receipts | stable | Schema changes require a migration path and backward-compat tests. |
| Rubric | beta | Version changes require a migration note and regression baseline update. |

Deprecated code paths use `@deprecated` JSDoc and remain available until the next major release unless a security fix requires faster removal.

## Receipt Schema Migration

Current receipt schema: v2.

Supported reads: v1 and v2. v1 receipts are migrated in memory by `migrateReceipt()` so old regression baselines remain usable.

To migrate a JSONL receipt file:

```bash
gtom migrate --from 1 --to 2 --input ./receipts-v1.jsonl --output ./receipts-v2.jsonl
```

Use `--dry-run --json` in CI to validate migration readiness without writing output.

## Rubric Migration

The current rubric is `gtom_v1@1.0`. Rubric migrations are tracked separately from receipt schema migrations because a rubric change can be additive while receipt storage remains stable. A rubric version change must include:

- a migration note describing changed dimensions or weights
- updated regression baselines
- compatibility notes for consumers reading old receipts

## SDK Pinning

Runtime SDK dependencies are pinned in `package.json` instead of ranged with `^` so dependent tools resolve the same provider and MCP contracts across CI and local installs. SDK upgrades should be made intentionally and paired with release notes when they affect public behavior.
