# Releasing GToM

## Prerequisites

- `NPM_TOKEN` configured in GitHub Actions with publish access.
- GitHub contents write permission enabled for the release workflow.
- Native build tools available for `better-sqlite3` verification.

## Release Steps

1. Update `CHANGELOG.md` and add `docs/releases/gtom-vX.Y.Z.md`.
2. Run `npm run verify`.
3. Run `npm pack --dry-run` and inspect the package contents.
4. Create and push an annotated tag:

```bash
git tag -a gtom-vX.Y.Z -F docs/releases/gtom-vX.Y.Z.md
git push origin gtom-vX.Y.Z
```

The release workflow publishes npm with provenance, builds platform binaries with `npm run build:binaries`, uploads release assets, and uses the tag-specific release notes.

## Local Install

Use `npm run install:local` to install dependencies, rebuild `better-sqlite3`, build TypeScript, and initialize the SQLite schema.

Set `GTOM_SKIP_POSTINSTALL=1` to skip schema setup in constrained build environments.
