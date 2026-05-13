# GToM Security

GToM evaluates cognitive vulnerability and authenticity. It must protect user context, avoid manipulation amplification, and keep safety checks explicit.

## Principles

- Do not hardcode credentials, tokens, private endpoints, or secrets.
- Treat cognitive state, vulnerability state, and influence ledgers as sensitive data.
- Do not expose raw vulnerability details to systems that could exploit them.
- Fail closed on malformed authenticity, ICE, or MCP contracts.
- Keep cognitive defense logic user-protective rather than persuasion-optimizing.

## Checks

Run:

```bash
npm run check:privacy
npm run check:mcp-contract
npm run verify
```

Before release, run `npm run ci:local` to include build and CLI smoke checks.
