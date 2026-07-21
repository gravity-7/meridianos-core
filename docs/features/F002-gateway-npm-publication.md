# F002 – Gateway npm Publication & Distribution

**Feature ID:** F002
**Area:** Foundation
**Wedge:** Governance Gateway (Wedge 1)
**Status:** Proposed
**Priority:** P0 — Critical Path
**Estimated Effort:** 4 hours
**Assigned To:** Founder
**Dependencies:** None (parallel with F001)
**Blocks:** F003, F004, F005, F009, F011

---

## Business Context

### Problem
The MeridianOS gateway sidecar (`gateway/cli.mjs`, bin name `meridian-gateway`) is fully built, tested (860 tests, 851 pass), and dogfooded live against DeepSeek. But it exists ONLY as source code in a GitHub repo. A prospect cannot install it. There is no `npm install -g meridian-gateway` experience. The product has no distribution.

### Why This Matters
- The standalone gateway is the **lead product** for Wedge 1 — the simplest path to revenue
- The pitch is "60 seconds to know what your AI is costing" — that requires a one-command install
- `npx meridian-gateway` is the demo that proves the product is real
- Without publication, every prospect conversation starts with "clone this repo and..."

### Success Criteria
A developer anywhere in the world can run:
```sh
npx meridian-gateway --port 8787 --provider deepseek --model deepseek-v4-flash
```
...and see a working gateway print its URL and token within 5 seconds.

---

## Functional Requirements

### FR1: npm Package Publication
The package `@gravity-7/meridianos-core` SHALL be publishable to npm with:
- Correct `bin` entry mapping `meridian-gateway` → `gateway/cli.mjs`
- All runtime dependencies declared in `package.json`
- `better-sqlite3` as the sole dependency (already declared)
- `"type": "module"` preserved
- `.gitignore` excluding `.env`, `ledger.db`, and test artifacts from the published tarball

### FR2: npx Execution
Running `npx meridian-gateway` SHALL:
- Download the package if not cached
- Execute `gateway/cli.mjs` as a Node.js ESM script
- Print usage if no `--provider` flag given
- Boot a working gateway when `--provider` and `--model` are supplied
- Exit cleanly on SIGINT (Ctrl+C)

### FR3: Standalone Zero-Config Experience
The CLI SHALL work with ZERO configuration files:
- No `.ai/` directory required
- No `policy.yaml` required (empty policy `{}` default)
- No `pricing.json` required (costs return `null`, not errors)
- No `.env` required (key read from shell environment)
- Ledger defaults to `.ai/gateway/ledger.db` (auto-created)

### FR4: Version Bump to v0.3.0
The package version SHALL be bumped from `0.2.1` to `0.3.0`:
- Semver minor bump (new feature: standalone CLI as first-class product)
- CHANGELOG entry documenting the standalone gateway as a product
- Git tag `v0.3.0` pushed to origin

### FR5: Installation Verification
A test script SHALL verify post-publish:
- `npm install -g @gravity-7/meridianos-core` succeeds
- `meridian-gateway --help` prints usage (or at minimum starts without error)
- `meridian-gateway --version` prints `0.3.0`

### FR6: README Updates
The root `README.md` SHALL include:
- One-liner: "`npx meridian-gateway` — cost-governed AI proxy in 60 seconds"
- Quickstart section showing the 3-command flow
- Link to full gateway docs (`docs/GATEWAY.md`)

---

## Technical Requirements

### TR1: package.json Configuration
```json
{
  "name": "@gravity-7/meridianos-core",
  "version": "0.3.0",
  "bin": {
    "meridian-gateway": "./gateway/cli.mjs"
  },
  "files": [
    "gateway/",
    "config.mjs",
    "providers.mjs",
    "budget.mjs",
    "pricing.mjs",
    "pricing-refresh.mjs",
    "db.mjs",
    "schema.sql",
    "*.mjs",
    "!test/",
    "!tests/",
    "!docs/",
    "!.env",
    "!.ai/"
  ]
}
```
Note: The `files` field controls what goes into the npm tarball. Adjust based on what runtime modules `gateway/cli.mjs` transitively imports.

### TR2: Dependency Audit
Verify `better-sqlite3` is the ONLY runtime dependency needed for the standalone gateway path:
- Walk the import graph from `gateway/cli.mjs` → `gateway/index.mjs` → `gateway/server.mjs` etc.
- Confirm `node:sqlite` (built-in, Node 24) handles the board DB path; `better-sqlite3` is only for the ledger
- If any test-only dependency is accidentally in `dependencies` vs `devDependencies`, fix it

### TR3: Shebang
`gateway/cli.mjs` line 1 SHALL be `#!/usr/bin/env node` (already present — verify).

### TR4: Windows Compatibility
The CLI SHALL work on Windows:
- `node gateway/cli.mjs` works (POSIX shebang ignored, Node handles `.mjs`)
- `npx meridian-gateway` works via npm's bin shim (npm creates `.cmd` wrapper on Windows)
- Path separators use `node:path` (already the case — verify)

### TR5: Registry Configuration
The `publishConfig` in `package.json` currently points to GitHub Packages:
```json
"publishConfig": { "registry": "https://npm.pkg.github.com" }
```
This SHALL be changed to the public npm registry OR kept as GitHub Packages with clear documentation. Decision: **Use public npm registry** for maximum reach (matching the `npx` zero-friction goal). The GitHub Packages registry requires authentication even for public packages.

---

## Architecture

### Distribution Flow
```
Developer                    npm Registry                  GitHub Releases
    │                             │                              │
    │ npx meridian-gateway        │                              │
    ├────────────────────────────▶│                              │
    │                             │ fetch @gravity-7/meridianos  │
    │                             │         -core@0.3.0          │
    │◀────────────────────────────│                              │
    │                             │                              │
    │ execute gateway/cli.mjs    │                              │
    │ boot gateway on :8787       │                              │
    │ print URL + token           │                              │
```

### Module Import Graph (standalone path)
```
gateway/cli.mjs
  → gateway/index.mjs (assembleGateway)
      → gateway/server.mjs (startGateway)
      → gateway/ledger.mjs (openLedger, appendEvent)
      → gateway/run-registry.mjs (createRunRegistry)
      → gateway/registry-source.mjs (buildProviderRegistry)
      → gateway/registry-pull.mjs (createRegistryStore)
      → gateway/windows.mjs (makeCheckVerdict)
      → budget.mjs (loadPolicy, verdictFor)
      → pricing.mjs (loadPricing, costFor)
  → providers.mjs (PROVIDERS registry)
```

Every module in this graph must be included in the npm tarball.

---

## Database Changes

**None.** The ledger SQLite file is created on first use by `openLedger` → `migrate()` → `ledger-schema.sql`. No pre-existing DB required.

---

## Security

- **API keys:** Never in the package. The `keyEnv` mechanism ensures keys stay in `process.env`. The published package contains ZERO secrets.
- **npm publish token:** Use a granular npm access token with read+write on `@gravity-7/meridianos-core` only. Store in GitHub Secrets or use `npm login` interactively.
- **.npmignore / files field:** Explicitly exclude `.env`, `.ai/`, test fixtures, and any file that could contain local paths or secrets.
- **Supply chain:** The package has exactly one dependency (`better-sqlite3`). Minimal attack surface.

---

## Validation

### Pre-publish Checklist
- [ ] `npm test` passes (851 pass, 0 fail, 9 skipped)
- [ ] `npm pack --dry-run` shows expected files only (no `.env`, no test cassettes, no local ledger)
- [ ] `node gateway/cli.mjs --help` exits without crashing (or prints usage)
- [ ] `package.json` version is `0.3.0`
- [ ] CHANGELOG entry exists
- [ ] Git working tree is clean (all changes committed)

### Post-publish Checklist
- [ ] `npm view @gravity-7/meridianos-core version` returns `0.3.0`
- [ ] `npx @gravity-7/meridianos-core` executes (may error on missing --provider, but must not crash with module-not-found)
- [ ] `npm install -g @gravity-7/meridianos-core` succeeds on a clean machine
- [ ] `meridian-gateway --version` prints `0.3.0`

---

## Testing

### Automated
- Existing test suite: `npm test` (860 tests)
- Add a smoke test: `tests/gateway-cli-smoke.test.mjs` — spawns `node gateway/cli.mjs --provider test --model test` as a child process, verifies it boots and prints a listening URL, sends SIGINT, verifies clean exit

### Manual
- `npm pack` → inspect tarball contents
- `npm install ./meridianos-core-0.3.0.tgz -g` on a separate machine/VM
- Full `npx` workflow from a different directory

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| User runs `npx meridian-gateway` with no flags | Prints usage/help text, exits non-zero (or boots with nothing registered) |
| User has Node < 24 | `npx` fails with engine requirement error. `package.json` `engines` field should specify `node >= 24` |
| User is on Windows, no `claude` CLI | Gateway boots fine — it's a proxy, doesn't need `claude`. Only agent invocations need harness CLIs |
| `better-sqlite3` fails to compile (native addon) | Prebuilt binaries exist for Win/Mac/Linux. If not, user needs build tools. Document in README |
| npm registry is down | `npx` uses cache. Document fallback: clone repo and run `node gateway/cli.mjs` directly |
| Package name collision | `@gravity-7/meridianos-core` is scoped — no collision risk |

---

## Acceptance Criteria

1. ✅ `npm publish` succeeds and `@gravity-7/meridianos-core@0.3.0` is on the public npm registry
2. ✅ `npx @gravity-7/meridianos-core` (or `npx meridian-gateway`) executes without crashing
3. ✅ `npm install -g @gravity-7/meridianos-core` works on a clean Node 24 installation
4. ✅ `meridian-gateway --version` prints `0.3.0`
5. ✅ Git tag `v0.3.0` exists on GitHub with release notes
6. ✅ `README.md` updated with quickstart instructions
7. ✅ CHANGELOG entry for v0.3.0 documents the standalone gateway

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `better-sqlite3` native build failure on some platforms | Medium | Some users can't install | Prebuilt binaries cover Win/Mac/Linux x64+arm64. Document build-from-source fallback |
| npm 2FA required for publish | High | Procedural | Use `npm login` interactively + `--otp` flag, or CI token with Automation type (bypasses 2FA) |
| `files` field misses a required module | Medium | Runtime `ERR_MODULE_NOT_FOUND` | `npm pack --dry-run` + manual `npm install` test on clean machine |
| GitHub Packages → npm registry migration confusion | Low | Users pulling from wrong registry | Clear docs. Both registries could publish same version (GitHub for existing users, npm for new) |

---

## Dependencies

- **External:** npm account with publish access to `@gravity-7` scope, Node.js 24+
- **Internal:** `gateway/cli.mjs`, `gateway/index.mjs`, `gateway/server.mjs`, and all transitive imports
- **Infra:** npm registry access, GitHub for git tag + release notes

---

## Non-Functional Requirements

- **Install time:** < 30 seconds on broadband (package is small — no heavy dependencies beyond `better-sqlite3`)
- **Startup time:** < 2 seconds from `npx` to "listening at http://..."
- **Package size:** < 5 MB (source only, no binaries except `better-sqlite3` prebuilt)
- **Documentation:** Quickstart in README, full docs in `docs/GATEWAY.md`

---

## AI Implementation Guidance

### Step 1: Audit the import graph
Write a quick script that traces all imports from `gateway/cli.mjs` and verifies each imported file exists and will be included in the npm tarball. The `files` field in `package.json` is the gate.

### Step 2: Update package.json
- Version: `0.3.0`
- `files` array: explicit list of all runtime files
- `engines`: `{ "node": ">=24.0.0" }`
- `publishConfig.registry`: `https://registry.npmjs.org/`

### Step 3: Add .npmignore if needed
If the `files` field is used, `.npmignore` is generally not needed. But add one explicitly denying `.env`, `.ai/`, `test/` directories anyway as belt-and-suspenders.

### Step 4: Smoke test script
Create `tests/gateway-cli-smoke.test.mjs`:
- Spawn `node gateway/cli.mjs --port 0 --provider deepseek --model deepseek-v4-flash`
- Parse stdout for "listening at http://"
- Send SIGINT
- Assert exit code 0 (or 130 for SIGINT on Unix)
- Skip if `DEEPSEEK_KEY` not set (same convention as other e2e tests)

### Step 5: Publish
```bash
npm test                          # must pass
npm version 0.3.0                 # bump version, create git tag
git push origin main --tags       # push tag
npm publish --access public       # publish to npm
```

### Step 6: Verify
```bash
npm view @gravity-7/meridianos-core version  # should print 0.3.0
npx @gravity-7/meridianos-core --help         # should execute
```

### Key Files to Modify
- `package.json` — version, files, engines
- `README.md` — add quickstart section
- `CHANGELOG.md` — v0.3.0 entry (create if doesn't exist)
- `.npmignore` — create if needed

---

## Deliverables

1. `@gravity-7/meridianos-core@0.3.0` on npm registry
2. Git tag `v0.3.0` with GitHub release
3. Updated `package.json` with correct `files`, `engines`, `publishConfig`
4. Updated `README.md` with quickstart
5. `CHANGELOG.md` with v0.3.0 entry
6. `tests/gateway-cli-smoke.test.mjs`

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
