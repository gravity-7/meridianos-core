---
name: "meridianos-data"
description: "MeridianOS Data Storage Patterns — SQLite schemas, event store, document store, project store, migration conventions"
---

# MeridianOS Data Skill

## Architecture Overview

MeridianOS uses SQLite (via `better-sqlite3`) for all persistent storage.
The database files live under `.ai/` and are gitignored — they are runtime state, not source code.
There are two primary databases: state (`aios.db`) and gateway ledger (`ledger.db`).

## Key Files

| File | Purpose |
|------|---------|
| `state-store.mjs` | Task board CRUD — `.ai/state/aios.db` |
| `db.mjs` | Database connection management |
| `schema.sql` | State database schema |
| `gateway/ledger.mjs` | Cost ledger queries |
| `gateway/ledger-schema.sql` | Gateway ledger schema |
| `event-store.mjs` | Event sourcing store |
| `event-log.mjs` | Event log operations |
| `doc-store.mjs` | Document storage |
| `project-store.mjs` | Project metadata storage |
| `domain-record.mjs` | Domain record persistence |
| `runlog.mjs` | Agent run logging |

## Database Locations

| Database | Path | Purpose |
|----------|------|---------|
| State DB | `.ai/state/aios.db` | Task board, agent state |
| Gateway Ledger | `.ai/gateway/ledger.db` | Token events, cost tracking |

## Schema Conventions

- Timestamps: ISO 8601 text (`datetime('now')`)
- IDs: Auto-increment integers
- Foreign keys: Enabled via `PRAGMA foreign_keys = ON`
- Migrations: Incremental ALTER TABLE statements (no ORM)

## Migration Pattern

```javascript
// Add new column (SQLite limitation: no DROP COLUMN in older versions)
db.exec(`ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0`);
```

## Common Modifications

- **Adding a new table**: Create migration SQL → add CRUD module
- **Changing schema**: Add ALTER TABLE migration → update all readers/writers
- **Adding a new database**: Create new db module with connection management
- **Querying ledger**: Use `ledger.mjs` helpers, never direct SQL from outside gateway/
