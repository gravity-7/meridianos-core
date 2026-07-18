# Contract — Gateway standalone CLI (card C1)

Scope item 1 (**the wedge**). A thin, dependency-free CLI that runs the gateway sidecar
independently — no tenant, no loop, no DomainPlugin. "Cost governance + audit for heterogeneous
agent fleets," runnable in one command.

## Existing seams (do NOT re-implement)
- `gateway/index.mjs` → `assembleGateway({ config, policy, port=0, tenant='pv', ledgerPath, now })`
  — builds the sidecar. `config` is nullable (standalone is a first-class supported mode).
- `gateway/server.mjs` → `startGateway({ ... })` opens the HTTP listener on `127.0.0.1`.

## C1 deliverables

### `gateway/cli.mjs` (new) — the thin entry
```
node gateway/cli.mjs [--port N] [--tenant NAME] [--policy path] [--ledger path]
```
- Parse flags (reuse the arg-parse idiom from `tools/aios/cli.mjs`; no new dep).
- `assembleGateway({ policy?, port, tenant, ledgerPath })` → `startGateway(...)`; print the bound
  URL + tenant + ledger path to stdout; handle SIGINT for clean shutdown.
- Keys are injected server-side from env var **names** (existing gateway behavior — the CLI adds no
  new key handling and never logs a key).
- `main()`-guarded (`if (import.meta.url === ...)`), so importing the module has no side effects.

### `package.json` (chokepoint — C1 holds it)
Add `"bin": { "meridian-gateway": "./gateway/cli.mjs" }`. Additive; no other package.json change.

### `gateway/README.md` (new) + `docs/GATEWAY.md` quickstart section (chokepoint)
Quickstart: install → set a provider key env var → `npx meridian-gateway --port 8787` → point an
agent's base URL at it → show a ledger row. ≤30 lines, copy-pasteable.

## Acceptance criteria
- **AC1** `node gateway/cli.mjs --port 0` boots, prints a `127.0.0.1:<port>` URL, and exits 0 on
  SIGINT.
- **AC2** A request proxied through the running CLI appends exactly one event to the ledger at the
  `--ledger` path (assert via `listEvents`).
- **AC3** Importing `gateway/cli.mjs` (not running it) starts no server (main-guard holds).
- **AC4** `--tenant acme` labels the ledger event `tenant:'acme'`.
- **AC5** A budget-deny still returns the non-retryable 403 through the CLI path (enforcement is not
  bypassed by running standalone).

## Out of scope
Auth/multi-user, TLS, a hosted control plane, config file formats beyond the existing policy YAML,
Docker (that's C6).
