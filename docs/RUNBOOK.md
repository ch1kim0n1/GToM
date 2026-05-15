# GToM Runbook

## First Response

1. Run `gtom health --json`.
2. Check `gtom metrics --format prometheus`.
3. Inspect recent receipts with `gtom receipts --since 24h --json`.
4. Check audit logs in `~/.gtom/audit/`.

## Health Drop

1. Confirm failed services in the `overall_health` details.
2. If `gbrain` is down, verify the endpoint and network route.
3. If `schema_version` fails, back up state and run migrations.
4. If `sync_freshness` fails, verify receipt emission and filesystem permissions.
5. If `queue_health` fails, inspect active budget reservations and receipt append queues.

## Persistence Recovery

```bash
gtom backup --json
gtom export --format json --json
gtom restore --backup-dir <backup-dir> --json
```

## Release Verification

```bash
npm run typecheck
npm test -- --runInBand
npm run build
npm run docs:api
npm run check:all
```
