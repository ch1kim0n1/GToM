# gtom-v0.1.0

Initial production-parity package release.

## Highlights

- Published CLI entry points for `gtom`, `gtom-gbrain-sync`, and `gstack-gbrain-sync`.
- Package exports for the core API, HTTP server, and CLI modules.
- SQLite postinstall schema setup with `better-sqlite3` rebuild guidance.
- Release workflow for npm provenance publishing, GitHub release notes, and platform binary assets.
- Homebrew formula scaffold for tag-based installs.

## Verification

- `npm run verify`
- `npm pack --dry-run`
- `npm run build:binaries`
