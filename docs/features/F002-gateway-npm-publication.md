# Feature Spec: F002 — Gateway npm Publication & Distribution

This document defines the specification and design for distributing the MeridianOS Gateway sidecar as a standalone, lightweight, publicly accessible NPM package (`@gravity-7/meridian-gateway`) on the public npm registry (`npmjs.com`).

---

## User Story

- **As a** developer or agent-fleet operator,
- **I want** to run the MeridianOS Gateway sidecar via a single command (e.g. `npx @gravity-7/meridian-gateway --port 8787`),
- **so that** I can meter and cap my LLM calls with zero local configuration, zero daemon overhead, and no required GitHub authentication credentials.

---

## Requirements

### TR1: Standalone Package Identity
- **Package Name:** `@gravity-7/meridian-gateway`
- **Scope:** Scoped to the `@gravity-7` organization, but published with **public access** so it can be installed or run via `npx` by anyone without authentication.
- **Entry point:** Resolves to the gateway's standalone CLI (`gateway/cli.mjs`), bound to the binary command `meridian-gateway` in the `bin` field.

### TR2: Zero External Dependencies & Low Footprint
- The package must carry **zero external runtime dependencies** in its `package.json` (except Node's own built-ins like `node:sqlite`).
- Native binaries like `better-sqlite3` are excluded from the runtime footprint since the gateway uses Node 22.5.0+'s built-in `node:sqlite` module.

### TR3: Self-Contained Bundling/Vendoring
- The gateway references files in the root folder (e.g. `budget.mjs`, `pricing.mjs`, `providers.mjs`, `yaml-lite.mjs`).
- The packaging pipeline must vendor/bundle these local modules directly into the package structure and rewrite the relative import paths in JavaScript files (e.g., rewriting `import { loadPolicy } from '../budget.mjs'` to `import { loadPolicy } from './core/budget.mjs'`).
- The committed pricing database `pricing.json` must be copied into the distribution package to allow standalone cost computation.

### TR4: Automated Distribution Pipeline
- Provide a PowerShell script `scripts/publish-gateway.ps1` that automates:
  1. Version extraction from the root `package.json`.
  2. Setup of a clean temporary build workspace.
  3. Bundling the gateway code and local core files into the build workspace.
  4. Path rewriting for dependencies.
  5. Generating a clean gateway-specific `package.json`.
  6. Publishing the workspace to the public registry (`https://registry.npmjs.org/`) with `--access public`.
  7. Graceful cleanup of temporary build folders.

### TR5: Security & Token Custody
- The NPM publishing token must be passed securely via the `NPM_TOKEN` (or `NODE_AUTH_TOKEN`) environment variable.
- The pipeline must use transient `.npmrc` files containing only the environment variable reference, never writing the raw token to disk.

---

## Architecture & Packaging Strategy

### File structure of the published package
The transient package directory layout will be:
```
@gravity-7/meridian-gateway/
├── package.json              <-- Lightweight, registry-targeted configuration
├── README.md                 <-- Extracted from gateway/README.md
├── LICENSE
├── cli.mjs                   <-- Standalone CLI entrypoint
├── index.mjs                 <-- Gateway assembly root
├── inject.mjs
├── ledger.mjs
├── ledger-schema.sql
├── provider-registry.mjs
├── registry-pull.mjs
├── registry-source.mjs
├── run-registry.mjs
├── server.mjs
├── token-event.mjs
├── windows.mjs
└── core/                     <-- Core modules vendored into the package
    ├── budget.mjs            <-- Isolated with minimal dependencies
    ├── pricing.mjs
    ├── pricing.json          <-- Default pricing catalog
    ├── providers.mjs
    └── yaml-lite.mjs
```

### Path Rewriting Logic
During packaging, the CLI and assembly files require adjustment of parent-directory imports to point to the `core/` folder. The replacement mapping is:
- `../budget.mjs`       -> `./core/budget.mjs`
- `../pricing.mjs`      -> `./core/pricing.mjs`
- `../providers.mjs`    -> `./core/providers.mjs`
- `../yaml-lite.mjs`     -> `./core/yaml-lite.mjs`
- `./core/budget.mjs` relative imports (like `./config.mjs`) must be cleaned/decoupled or shimmed if they are not used in the gateway path.

---

## Data Models

### Gateway `package.json` Schema
```json
{
  "name": "@gravity-7/meridian-gateway",
  "version": "0.2.1",
  "description": "Standalone cost-governance forward-proxy for heterogeneous agent fleets",
  "type": "module",
  "main": "./index.mjs",
  "bin": {
    "meridian-gateway": "./cli.mjs"
  },
  "engines": {
    "node": ">=22.5.0"
  },
  "publishConfig": {
    "registry": "https://registry.npmjs.org/",
    "access": "public"
  }
}
```

---

## Database & State Changes

**None.** The SQLite ledger remains self-contained inside the gateway's workspace (`.ai/gateway/ledger.db` or customized path) and utilizes the `DatabaseSync` class.

---

## Validation & Testing

- [ ] Test local assembly inside a clean `node_modules` container.
- [ ] Confirm `npx @gravity-7/meridian-gateway --port 0` boots correctly in a workspace containing no files except Node.
- [ ] Verify cost functions run without errors, leveraging the local `core/pricing.json`.
- [ ] Ensure `meridian-gateway` CLI returns correct usage statistics from the standalone ledger.

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Run on Node version < 22.5.0 | Fails at startup due to missing `node:sqlite`. Prevented by `engines` configuration. |
| Missing local `policy.yaml` | Starts with empty policy, logging a warning but never crashing. |
| Registry connection timeout | Fails the publish script gracefully, cleaning up the temporary folder. |

---

## Acceptance Criteria

1. ✅ An automated command packages the gateway sidecar with all its parent dependencies localized.
2. ✅ The package `@gravity-7/meridian-gateway` contains zero third-party NPM runtime dependencies.
3. ✅ The package exposes the `meridian-gateway` bin command.
4. ✅ The package can be run directly using `npx` with zero authentication/token requirements for pulling.
5. ✅ Path rewriting successfully redirects parent imports to the vendored `core/` folder.
6. ✅ Decoupled files (like `budget.mjs`) do not trigger import errors when missing their non-gateway dependencies.

---

*Feature spec version: 1.0 | Updated: 2026-07-19 | Finalized for implementation*
