# Agent Guidance for GToM

GToM is the cognitive defense and Theory-of-Mind layer for the G-Stack. Agents should prioritize user protection, explicit scoring, and safe handling of vulnerability data.

## Rules

- Preserve MCP tool names and schemas unless intentionally changing public contracts.
- Update tests and docs for all public behavior changes.
- Never repurpose vulnerability signals for persuasion optimization.
- Run `npm run verify` after edits.
- Run `npm run ci:local` before release-level changes.

## Contract Surfaces

- CLI: `src/cli.ts`
- MCP: `src/mcp/server.ts`
- Vulnerability tracking: `src/core/vulnerability.ts`
- Authenticity scoring: `src/core/authenticity.ts`
- ICE conflict logic: `src/core/ice-conflict.ts`
