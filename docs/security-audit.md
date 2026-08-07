# Security Audit — Multi-Tenant Platform (T202)

**Date**: 2026-08-03
**Scope**: `auth/`, `licensing/`, `compliance/`, `control-plane.mjs`, `dashboard/server.mjs`,
`gateway/`, database schemas, dependency tree, and secrets handling for the multi-tenant
platform (`specs/006-multi-tenant-platform/`).

**Method**: manual code review of authentication, authorization, and data-access paths;
automated static scanning for common vulnerability classes (`scripts/security-audit.mjs`,
runnable on demand or in CI); `npm audit` for dependency vulnerabilities. This is a code-level
audit, not a live penetration test against a running deployment — there was no staging
environment available to attack in this pass. See **Recommendations** for what a follow-up
external penetration test should cover.

Run the automated checks yourself at any time:

```bash
node scripts/security-audit.mjs
```

## Summary

| Severity | Count | Disposition |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | Fixed during this task (§6, backup file permissions) |
| Low / informational | 3 | Documented below |
| Findings requiring manual confirmation (automated scanner) | 11 | All sampled hits verified as false positives (see below); remaining hits should be re-checked on future changes to those files |

No critical or high-severity vulnerabilities were found in the areas reviewed.

## What was checked, and what was found

### 1. Authentication (`auth/`)

- **Password hashing**: `auth/user-store.mjs` uses `crypto.scryptSync` with `N=16384, r=8, p=1`
  (reasonable, OWASP-aligned cost parameters) and a 32-byte random salt per password.
  `verifyPassword` compares hashes with `crypto.timingSafeEqual`, avoiding a timing side-channel
  on password comparison. **No issue.**
- **JWT**: `auth/jwt.mjs` implements HMAC-SHA256 signing with a fixed algorithm (the signing
  algorithm is never read from attacker-controlled input, so there is no "alg confusion" /
  "alg:none" attack surface). `loadSecret()` throws if `.ai/auth/jwt-secret` is missing — there is
  no insecure fallback secret. **No issue.**
- **JWT secret storage**: generated via `scripts/generate-jwt-secret.mjs` with `crypto.randomBytes(64)`
  and written with file mode `0600`. `.ai/` (which contains the secret and `control-plane.db`) is
  excluded in `.gitignore` — the repo's history notes this was added after a prior real
  secret-leak incident. **No issue**, verified by the automated scanner on every run.
- **Dashboard auth gate** (`dashboard/server.mjs`'s `requireAuth`): every `/api/` route requires
  either a valid Bearer JWT or a valid `ApiKey` token; unauthenticated/malformed requests are
  rejected before touching any handler. The dashboard binds to loopback by design and additionally
  enforces a per-boot token (documented in-file as a fix for a prior postmortem finding). **No
  issue.**
- **Rate limiting**: tiered per-IP rate limits (stricter for `/api/auth/*`) with `X-RateLimit-*`
  response headers, reducing brute-force/credential-stuffing feasibility against login. **No
  issue.**

### 2. Authorization / tenant isolation

- **RBAC**: `auth/auth.mjs` enforces role-based access control; project membership and roles are
  checked per-request rather than assumed from the token alone.
- **Data isolation**: `control-plane.mjs`'s `createAios({root, domain})` gives each project its
  own database, worktree root, and `policy.yaml` — confirmed by the existing
  `tests/integration/test-project-isolation.mjs` suite (config/db isolation between two
  concurrently-registered projects).

### 3. Injection

- **SQL**: every query construction site reviewed uses parameterized `?` placeholders for actual
  *values*. A handful of files (see the automated scanner's `sql-injection-review` warnings)
  interpolate *clause structure* (column names, `WHERE`/`SET` fragments) via template strings —
  the same textual shape as a real injection bug. Three representative instances were manually
  traced and confirmed safe:
  - `control-plane.mjs` (`ALTER TABLE projects ADD COLUMN ${column} ${definition}`) — `column`/
    `definition` come from a hardcoded object literal, never external input.
  - `event-log.mjs` (`readEvents`'s dynamic `WHERE` clause) — clause text is built from fixed
    strings (`'level = ?'`, `'source = ?'`); the actual values are always bound via `?`.
  - `auth/user-store.mjs`'s `updateUser` (`UPDATE users SET ${fields.join(', ')}`) — `fields` is
    built only from keys present in a hardcoded `allowedFields` whitelist (`['full_name',
    'is_active']`); values are bound via `?`.

  This is a consistent, intentional idiom across the codebase, not scattered accidents — but
  because the automated check can't statically distinguish "fixed clause text" from "attacker
  string," every hit is reported as a `warning` requiring a human to re-confirm the pattern holds
  whenever one of these files changes. **No exploitable SQL injection found in this pass; treat
  new hits from the scanner as a required manual-review gate, not an auto-pass.**
- **Shell/command injection**: `execSync`/`exec` calls with interpolated paths were reviewed.
  `vscode-extension/daemon-manager.mjs`'s install commands interpolate a VS Code
  extension-storage path — operator/OS-controlled, not reachable from network input.
  `dashboard/server.mjs`'s `generateSelfSignedCert` (OpenSSL cert/key generation) interpolates
  `certPath`/`keyPath` into a shell string; this function is currently **unreferenced dead code**
  (no call site), so it is not presently reachable/exploitable — but it should be fixed (proper
  argument-array `spawn`/`execFile` instead of a shell string) before anything ever calls it. Noted
  for the team; not fixed here since it's dead code outside this task's polish scope.
- **`eval()`**: none found in application code (one earlier false-positive hit was the word "eval"
  inside a code comment, not a function call — fixed in the scanner).
- **TLS verification**: no `rejectUnauthorized: false` found anywhere in the codebase — outbound
  TLS (SMTP, license-server calls) verifies certificates by default.

### 4. Dependencies

- `npm audit --omit=dev`: **0 known vulnerabilities** in production dependencies
  (`better-sqlite3`, `stripe`) at time of audit. Re-run this on every release — it is now wired
  into `scripts/security-audit.mjs`.

### 5. Secrets & sensitive data handling

- No hardcoded API keys, passwords, or private keys found in source (spot-checked via grep for
  common secret-shaped strings; none matched outside test fixtures using obviously-fake values).
- License signing keys (`licensing/license-key.mjs`) are generated in-process via
  `crypto.generateKeyPairSync('rsa', {modulusLength: 2048, ...})` and held in a private static
  field, never serialized to disk or logged.
- Stripe webhook handling (`licensing/stripe-webhook.mjs`) — not modified in this task; verify
  separately that webhook signature verification is enforced (out of scope for this pass, flagged
  for the next audit cycle).

### 6. Backup files (Medium — new in this task, T197) — Fixed

`db-backup.mjs`'s `backupDatabase` writes backups via `VACUUM INTO`, which — like any new file
SQLite creates — inherits the process's default umask rather than the mode of the original
database file. A backup of `control-plane.db` (containing password hashes, JWT-signed session
data, and license keys) could have ended up more permissive than the source file on a
misconfigured host. **Fixed in this task**: `backupDatabase` now `chmod`s the resulting file to
`0600` on POSIX platforms immediately after `VACUUM INTO` completes (a no-op on Windows, which has
no chmod bit model). Covered by `tests/db-backup.test.mjs`.

### 7. Availability/correctness bugs found during this audit (not security vulnerabilities, but flagged)

Three defects were discovered incidentally while writing this task's tests and are tracked as
separate follow-up work (not fixed here — out of this task's scope, and each needs focused
review):

- `LicenseKey.generate()`/`LicenseKey.validate()` do not round-trip — a freshly generated license
  key fails its own validation. This affects the *new-purchase validation* path, not the
  *feature-gating* path (`LicenseValidator.checkFeature`/`getLimits` trust the `licenses` DB row
  directly and don't re-invoke this crypto check) — so it is a billing/onboarding correctness bug,
  not a tier-gating bypass.
- `ActivityLogger.log()` writes its row inside a fire-and-forget `import('node:crypto').then()`
  callback instead of awaiting it, so a caller that logs an action and immediately queries for it
  can race and see nothing — an audit-trail completeness/timing issue, not a data-integrity
  compromise (the row does land, just not necessarily before the caller's next statement).
- `ProjectManager.stopProject()`'s SIGTERM triggers the same `'exit'` listener used for
  crash-auto-restart, so a graceful, intentional stop currently schedules an unwanted restart 5
  seconds later. This is an operational-control bug (an operator's "stop" doesn't reliably stay
  stopped), not a data-exposure issue.

## Recommendations

1. **External/dynamic penetration test**: this audit is static and code-level. Before a
   production multi-tenant launch, run an authenticated dynamic test (e.g. OWASP ZAP or a
   contracted pentest) against a real staging deployment — covering session fixation, CSRF on any
   state-changing dashboard route, and JWT replay/expiry edge cases under real network conditions.
2. Fix `db-backup.mjs` permission inheritance (§6) before backups are used against a production
   `control-plane.db`.
3. Fix or remove the dead `generateSelfSignedCert` shell-interpolation code (§3) rather than leave
   it as a landmine for a future caller.
4. Re-run `node scripts/security-audit.mjs` and manually re-confirm every `sql-injection-review`/
   `shell-injection` warning whenever the flagged files change, and add it to CI as a non-blocking
   report (it already exits non-zero only on `critical` findings).
5. Verify Stripe webhook signature validation explicitly (§5) — not covered in this pass.

## Addendum — 2026-08-07

Found during a documentation accuracy pass over the same scope (`auth/`, `licensing/`,
`dashboard/server.mjs`), not a follow-up security review — recorded here rather than silently
folded into the original findings above, which reflect the 2026-08-03 pass only.

### 8. OAuth SSO authentication does not complete (functional gap, not itself a vulnerability)

`dashboard/server.mjs`'s `handleOAuthAuthorize`/`handleOAuthCallback` call four
`auth/oauth-provider.mjs` methods with mismatched arguments (one, `exchangeCodeForTokens`, doesn't
exist — the real method is `exchangeCode(providerName, code)`), and rely on `req.session`, which
nothing on this `node:http` server ever populates. Net effect: OAuth login cannot currently
complete for any configured provider — full detail and the fix in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md#oauth-sso-login-does-not-complete). Flagged here rather than as a
new numbered severity finding because it's an availability/correctness bug (the flow fails closed,
with no partial-auth or credential-exposure state reachable), matching the framing already used in
§7 above for similar functional bugs found incidentally.

### 9. License-key signing keypair not persisted across restarts

`licensing/license-key.mjs`'s `LicenseKey.initializeKeys()` generates its RSA-2048 keypair in
memory and never writes it to disk, unlike `auth/jwt.mjs`'s file-backed, `0600`-permissioned JWT
secret. Every restart invalidates every license key signed before it, for the *new-purchase
validation* path specifically — day-to-day feature gating trusts the `licenses` table directly and
is unaffected. Not a confidentiality/integrity issue (the private key never leaves the process
either way), but an availability one worth fixing the same way the JWT secret already is. Detail
in [KNOWN-ISSUES.md](KNOWN-ISSUES.md#license-keys-invalidated-on-every-restart).

### 10. Three of four compliance reports return non-real data

Out of scope for the original audit (it covered auth/authz/injection/secrets, not report
correctness), but adjacent enough to note here since compliance reports are a control this
platform's own audience relies on: only `compliance/reports/soc2.mjs` queries real
`compliance_log`/`activity_log` data. `gdpr.mjs` returns a hardcoded 2-entry `dataFlows` array,
`model-usage.mjs` returns a hardcoded 2-entry model list, and `cost-allocation.mjs` computes
per-project cost via `Math.random()` — none derived from actual configuration or ledger data. This
is a correctness/trust gap for an Enterprise-tier feature marketed as audit-ready, not a
confidentiality or access-control issue, so it doesn't change the Summary table's severity counts
above — but treat SOC2 as the only one of the four safe to hand to an actual auditor today. See
[user-guide.md](user-guide.md#compliance-and-reporting).
