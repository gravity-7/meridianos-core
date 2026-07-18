# MeridianOS — Docker / Compose deployment (L2)

This is the "L2" deployment tier: one step up from bare `node <entrypoint>` execution, one step
below a managed platform. It packages this repo as a container image and a `docker-compose.yml`
so an operator can run pieces of MeridianOS without a local Node install.

**Read this alongside [GATEWAY.md](./GATEWAY.md) and [README.md](./README.md)** — this doc only
covers *how to run the container*; the request lifecycle, provider registry, and enforcement
semantics are documented there and are unchanged by Docker.

---

## What ships in the image, and what doesn't

This core has **no default tenant** — it ships zero product-specific config, prompts, or
`DomainPlugin` (see [README.md](./README.md) §7). That has a direct consequence for packaging:

| Entrypoint | Needs a `DomainPlugin`? | Runnable from this image alone? |
|---|---|---|
| **Gateway sidecar** (`gateway/cli.mjs`, bin `meridian-gateway`) | No — standalone by design | **Yes** — this is the image's default `CMD` |
| **Daemon** (`scheduler.mjs`, the autonomous loop + dashboard) | Yes — `config.mjs` *throws* if none is injected | No — a tenant must build their own image on top (see below) |

So `docker build .` / `docker compose up` in this repo gives you a working **gateway sidecar**
container out of the box — the local forward-proxy that meters and enforces spend for every
agent→provider LLM call. It does not, by itself, give you the full autonomous daemon; that
requires a tenant's own composition root (e.g. PropertyVerdict's `tools/aios/scheduler.mjs`
wrapper that calls `start({ domain: PV_DOMAIN })`) layered on top. See *Running the full daemon*
below.

---

## Build

```sh
docker build -t meridianos-core-gateway .
```

Base image: `node:24-slim` (matches the `engines`/CI Node version this repo requires — `node:sqlite`
and the `better-sqlite3` native ABI need Node 24). Dependencies are installed with
`npm ci --omit=dev` before the source is copied in, so rebuilds after a source-only change reuse
the dependency layer.

## Run via Compose

```sh
docker compose up --build
```

This starts the **gateway** service: `node gateway/cli.mjs --port=8787 --tenant=... --ledger=...`
(see `docker-compose.yml`). By default it boots with no provider run registered (every request
401s until you register one) — see *Registering a run* below.

Bind a different host port with `GATEWAY_PORT`:

```sh
GATEWAY_PORT=9000 docker compose up
```

## Registering a run (routing traffic through the sidecar)

The CLI can register one default run at boot when given `--provider` (see `gateway/README.md`
for the full flag reference). Uncomment the relevant lines in `docker-compose.yml`'s `command:`
block, e.g.:

```yaml
command:
  - "--port=8787"
  - "--tenant=${GATEWAY_TENANT:-default}"
  - "--ledger=/app/.ai/gateway/ledger.db"
  - "--provider=deepseek"
  - "--model=deepseek-chat"
```

The container logs the minted gateway token on startup (`docker compose logs gateway`) — point
your agent's base URL at `http://localhost:${GATEWAY_PORT:-8787}` and send that token on
`x-gateway-token` (or `x-api-key` / `Authorization: Bearer`).

## Enforcing a real budget policy

By default the CLI boots with an **empty** policy (no caps enforced). To enforce real
`agent_budget` caps, mount your `policy.yaml` read-only and pass `--policy`:

```yaml
volumes:
  - ./policy.yaml:/app/policy.yaml:ro
command:
  - "--policy=/app/policy.yaml"
  # ...
```

## Ledger persistence

The gateway's own append-only SQLite ledger (`.ai/gateway/ledger.db` — never the daemon's board
DB) is written inside the container at `/app/.ai/gateway`. `docker-compose.yml` mounts this as a
named volume (`gateway-ledger`) so metering history survives container restarts/recreates.

---

## BYO-key: how secrets reach the container

**No API key or other secret literal is ever baked into the image, the Dockerfile, or
`docker-compose.yml`.** Every provider descriptor in `providers.mjs` names a `keyEnv` — an
environment variable *name* — never a literal value; the real key is resolved server-side, at
forward-time, only inside the running container, and is never logged or printed (see
`gateway/cli.mjs`'s own comment on this and `docs/GATEWAY.md`).

To supply a key at runtime:

1. Create an untracked `.env` file next to `docker-compose.yml` (add it to your own `.gitignore`
   if you haven't already) with real values:
   ```
   DEEPSEEK_KEY=sk-...
   ANTHROPIC_API_KEY=sk-ant-...
   ```
2. Compose forwards each *name* declared under `environment:` in `docker-compose.yml` from your
   shell/`.env` into the container — the compose file itself only ever lists names, never values.
3. Add more names to the `environment:` list for any other provider your policy/registry
   routes to (see `providers.mjs` for the full `keyEnv` catalog).

This is the same BYO-key invariant the rest of the repo enforces — Docker doesn't change it.

---

## Environment variables reference

These apply to the **daemon** (`scheduler.mjs`) if/when a tenant layers it on this image (see
below); the standalone **gateway CLI** takes its config via flags instead (`--port`, `--tenant`,
`--policy`, `--ledger`, `--provider`, `--model`, `--agent`, `--token` — see `gateway/README.md`).

| Var | Used by | Meaning |
|---|---|---|
| `AIOS_ROOT` | `config.mjs` | Repo root override (default: two dirs up from `config.mjs`). Set this when the daemon runs from a mounted/derived location. |
| `AIOS_DB` | `config.mjs`, `db.mjs` | SQLite state-DB path override (default `<root>/.ai/state/aios.db`). |
| `AIOS_WORKTREE_ROOT` | `config.mjs`, `worktree.mjs` | Where isolated per-agent worktrees are created — deliberately *outside* the repo root; give each tenant container its own so `pruneAllWorktrees()` never sweeps another tenant's. |
| `AIOS_AGENTS` | `config.mjs` | Comma-separated roster override (only applied when the tenant's `DomainPlugin` didn't already set `agents` explicitly). |
| `AIOS_DASHBOARD_PORT` | `scheduler.mjs`, `dashboard/server.mjs` | Dashboard HTTP port (default `4317`). |
| `AIOS_DASH_TOKEN` | `dashboard/server.mjs` | Dashboard auth token (default: a random UUID minted at boot if unset — set this explicitly in a container so the token is stable/known). |
| `AIOS_GATEWAY_PORT` | `scheduler.mjs` | Port for the daemon's *inline* gateway assembly (opt-in; distinct from the standalone `gateway/cli.mjs` port). |
| `AIOS_DRY_RUN` | `scheduler.mjs` | Set to `1` to skip real agent spawns (dry-run mode). |
| `AIOS_ESCALATION_WEBHOOK` | `escalation-push.mjs` | Webhook URL for §6 escalation pushes — a secret; supply via env/`.env`, never commit it. |
| `<provider>_KEY` (e.g. `DEEPSEEK_KEY`) | `providers.mjs` via `keyEnv` | The BYO provider API key — see *BYO-key* above. |

---

## Running the full daemon under Docker

Because this core ships no `DomainPlugin`, `docker build .` in *this* repo cannot produce a
working daemon container on its own — `createAios({domain})` throws immediately without one. A
tenant that wants the daemon (not just the gateway sidecar) builds their own image on top of this
one:

```dockerfile
# Dockerfile.daemon — lives in the TENANT's repo, not this one
FROM meridianos-core-gateway

# Your DomainPlugin + a small composition-root script that injects it.
COPY my-tenant-domain.mjs my-entry.mjs ./

CMD ["node", "my-entry.mjs"]
```

```js
// my-entry.mjs — the tenant's composition root
import { start } from './scheduler.mjs';
import { MY_DOMAIN } from './my-tenant-domain.mjs';

start({ domain: MY_DOMAIN }).catch((e) => {
  console.error('daemon start failed', e);
  process.exit(1);
});
```

Then add a `daemon` service (in the tenant's own compose file, or by uncommenting the reference
block in this repo's `docker-compose.yml`) with:
- `AIOS_ROOT`, `AIOS_DASHBOARD_PORT`, `AIOS_DASH_TOKEN`, `AIOS_ESCALATION_WEBHOOK` set as needed,
- a volume mounting the tenant's own `.ai/` state directory (board DB, policy.yaml, secrets) —
  **never** the orchestrator's own session state from this core repo,
- port `4317` published for the dashboard.

This mirrors how PropertyVerdict (tenant #0) runs the daemon today — see
`docs/README.md` §7 and its own `tools/aios/scheduler.mjs`/`tools/aios/pv-domain.mjs` — just
containerized instead of run as a native scheduled task.

---

## What's excluded from the image

`.dockerignore` keeps the following out of every build context/layer:
- `node_modules/`, `.git/`, `.github/`, `.claude/` — reinstalled/irrelevant at runtime,
- `tests/`, `test/`, `gateway/tests/`, `*.test.mjs` — no runtime purpose in the image,
- `.ai/` — **critically**, this excludes any session/secret state that might exist in a checkout
  (`.ai/secrets/`, `.ai/state/*.db*`, `.ai/gateway/`, `.ai/logs/` — see the root `.gitignore`) so
  none of it is ever baked into a layer. A tenant supplies their *own* `.ai/` at runtime via a
  mounted volume, never at build time.
- local `.env`/`*.db` artifacts.

---

## Verification performed for this card (C6)

- `npm test` run in the worktree before opening the PR (unaffected — new files only).
- `node gateway/cli.mjs --port 0` run directly (outside Docker) to confirm the CLI boots cleanly
  and prints the expected banner — this is the exact command the image's `ENTRYPOINT`/`CMD` runs.
- `docker build .` — see the PR description for whether a Docker daemon was available in the
  sandbox this card was built in, and the result if so.
