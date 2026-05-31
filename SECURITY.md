# GToM Security

GToM evaluates cognitive vulnerability and authenticity. It must protect user context, avoid manipulation amplification, and keep safety checks explicit.

## Principles

- Do not hardcode credentials, tokens, private endpoints, or secrets.
- Treat cognitive state, vulnerability state, and influence ledgers as sensitive data.
- Do not expose raw vulnerability details to systems that could exploit them.
- Fail closed on malformed authenticity, ICE, or MCP contracts.
- Keep cognitive defense logic user-protective rather than persuasion-optimizing.

## Secret storage at rest

The default `FileSecretManager` (`~/.gtom/secrets.json`) encrypts secrets with
AES-256-GCM **only when `GTOM_SECRETS_MASTER_KEY` is set**.

- If `GTOM_SECRETS_MASTER_KEY` is **not** set, non-sensitive secrets are stored
  as **base64, which is NOT encryption** — it is trivially reversible. A loud
  warning and an audit event (`secret_stored_unencrypted`) are emitted on every
  such write.
- Storing a **sensitive** secret (names matching `api_key`, `secret`, `token`,
  `password`, `credential`, `auth`) without a master key is **refused** unless
  you explicitly set `GTOM_ALLOW_PLAINTEXT_SECRETS=true` (not recommended).
- Set `GTOM_SECRETS_MASTER_KEY` in production to enable encryption at rest.

## Outbound endpoint SSRF protection

`sanitizeUrl` (used for the configurable GBrain endpoint) blocks private,
loopback, link-local, and cloud-metadata hosts (RFC1918, `127.0.0.0/8`,
`169.254.0.0/16`, IPv6 loopback/ULA/link-local, `localhost`, `*.local`) by
default. Set `GTOM_ALLOW_PRIVATE_ENDPOINTS=true` to allow them in local
development.

## HTTP / MCP authentication

- MCP auth is required by default; set `GTOM_MCP_AUTH_REQUIRED=false` only for
  local dev. Tokens must be signed (`<payload>.<hmac>`) and carry a valid,
  unexpired `exp` claim; opaque/unsigned bearer tokens are rejected.
- HTTP auth is required by default; set `GTOM_HTTP_AUTH_REQUIRED=false` for local
  dev. `/metrics` is auth-gated by default (`GTOM_METRICS_REQUIRE_AUTH=false` to
  disable).
- The rate limiter only trusts `X-Forwarded-For` when `GTOM_TRUSTED_PROXY=true`.

## Checks

Run:

```bash
npm run check:privacy
npm run check:mcp-contract
npm run verify
```

Before release, run `npm run ci:local` to include build and CLI smoke checks.
