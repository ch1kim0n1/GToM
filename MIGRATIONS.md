# GToM Migrations

GToM uses versioned SQL files in `migrations/` plus the `Migrator` in `src/core/migrate.ts`.

## File Format

Migration files use this naming and section format:

```text
001_initial_persistence.sql
```

```sql
-- migrate:up
CREATE TABLE IF NOT EXISTS example (...);

-- migrate:down
DROP TABLE IF EXISTS example;
```

Rules:

- Prefix with a zero-padded integer version.
- Keep `up` and `down` sections reversible.
- Prefer additive migrations for production data.
- Do not edit a migration after it has been applied in a shared environment; add a new version instead.

## Running Migrations

Application code can load and run SQL migrations:

```ts
import { createDefaultEngine, createMigrator, loadSqlMigrations } from './src/core';

const engine = createDefaultEngine();
await engine.initialize();
const migrator = createMigrator(engine, 'sqlite');
migrator.registerMigrations(await loadSqlMigrations('migrations'));
await migrator.run();
```

The runner wraps each migration plus the migration ledger write in a transaction.

## Storage Engines

- SQLite is the default local engine.
- PostgreSQL is supported for concurrent-writer deployments.
- Postgres read replicas can be configured with `GTOM_POSTGRES_READ_REPLICA_URL`.

## Backup Before Migrations

```bash
gtom backup --output-dir ./.gtom/backups --rotate 10 --json
```

Restore if needed:

```bash
gtom restore --backup-dir ./.gtom/backups/<backup-name> --json
```
