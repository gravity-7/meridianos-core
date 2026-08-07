# Known Issues

**Created**: 2026-07-27 | **Feature**: Phase 0 — Harness Adapter Audit (US10)

## Claude Code OAuth Fallback

### Description

Claude Code, when launched with `--bare` and `ANTHROPIC_API_KEY`, should use only the API key for authentication. However, in certain configurations, Claude Code may silently fall back to a stored OAuth session token from a previous `claude login`, bypassing the gateway-injected API key and creating unmetered traffic.

### Impact

- If the operator has ever run `claude login`, a stored OAuth token exists
- The `--bare` flag is intended to prevent this, but the behavior is not fully guaranteed by Anthropic's CLI
- Unmetered traffic would not appear in the gateway ledger, causing a discrepancy between ledger totals and usage-reader totals

### Detection

The gateway now periodically compares ledger usage totals against usage-reader totals (every 5 minutes). A discrepancy >10% triggers a warning:
```
[MERIDIANOS] gateway: ledger-vs-reader discrepancy for agent 'builder' is 15% — possible unmetered traffic
```

### Mitigation

1. **Monitor the dashboard**: Check `GET /api/ledger/summary` vs usage-reader totals
2. **Clear OAuth state**: Run `claude logout` to remove stored OAuth tokens before running agents
3. **Use a dedicated API key**: Ensure `ANTHROPIC_API_KEY` is always set and valid
4. **Check logs**: Look for the discrepancy warning in daemon logs

### Permanent Fix

A permanent fix requires either:
- Anthropic to guarantee `--bare` always prevents OAuth fallback, or
- MeridianOS to implement network-level enforcement (firewall rules) in a future phase

## Other Harness Adapters

### OpenCode

OpenCode uses file-based configuration (`opencode.json`) with `{env:VAR}` interpolation. The gateway injection rewrites `baseURL` and `apiKey` to point at the gateway. No known bypass paths.

### Antigravity (agy)

Antigravity uses `AGY_BASE_URL` env var for endpoint override. The gateway injection sets this to the gateway URL. No known bypass paths when the env var is correctly set.

## OAuth SSO Login Does Not Complete

**Added**: 2026-08-07 | **Found during**: a documentation accuracy pass, not a dedicated security review

### Description

OAuth SSO (Azure AD, Google Workspace, GitHub) has UI, routes, and a provider module, but the
authorize→callback flow does not currently complete for any provider:

- `dashboard/server.mjs`'s `handleOAuthAuthorize` calls `oauthProvider.getAuthorizeUrl(state)` with
  one argument against a `getAuthorizeUrl(providerName, state)` signature in
  `auth/oauth-provider.mjs` — the provider name is silently dropped.
- `handleOAuthCallback` calls `oauthProvider.exchangeCodeForTokens(code)`, a method that does not
  exist on `OAuthProvider` (the real method is `exchangeCode(providerName, code)`).
- `getUserInfo(tokens.access_token)` is called with one argument against
  `getUserInfo(providerName, accessToken)`.
- `verifyIdToken` references a bare `jwt` identifier that is never imported in the file.
- Both handlers read/write `req.session` — the dashboard is a raw `node:http` server with no
  session middleware or store, so nothing set during `/authorize` can survive to the separate
  `/callback` request regardless of the above.

### Impact

Clicking "Sign in with Google/GitHub/Azure AD" will not successfully authenticate a user. Every
other auth path (email/password JWT login, invitation-based account creation, API keys) is
unaffected.

### Detection

Attempting an OAuth login will error or hang at the callback step; the specific symptom depends on
which of the mismatches above is hit first.

### Mitigation

Use email/password login or an API key. If OAuth is a hard requirement, this needs a code fix
before it can be relied on — it is not a configuration problem, so double-checking client
ID/secret/redirect URI (as the config-focused advice in
[troubleshooting-multi-tenant.md](troubleshooting-multi-tenant.md#oauth-sso-issues) covers) will
not resolve it on its own.

### Permanent Fix

Fix the four call-signature mismatches in `dashboard/server.mjs`'s OAuth handlers, add a session
store (or switch to a stateless approach — e.g. a signed state parameter that round-trips through
the redirect instead of server-side session storage), and import `jsonwebtoken` (or the project's
existing JWT helper) where `verifyIdToken` needs it.

## License Keys Invalidated on Every Restart

**Added**: 2026-08-07 | **Found during**: a documentation accuracy pass, not a dedicated security review

### Description

`licensing/license-key.mjs`'s `LicenseKey.initializeKeys()` generates its RSA-2048 signing keypair
in memory on first use and never persists it to disk — unlike `auth/jwt.mjs`'s JWT secret, which
is written to `.ai/auth/jwt-secret` with `0600` permissions. Every process restart mints a fresh
keypair.

### Impact

Any license key signed before a restart fails signature verification after it — `LicenseKey`'s own
round-trip (`generate()` then `validate()`) only holds within a single process lifetime. Note this
affects the *new-purchase validation* path specifically; day-to-day feature gating
(`LicenseValidator.checkFeature`/`getLimits`) trusts the `licenses` database row directly and does
not re-invoke this check, so an already-activated license keeps working — it's re-validating or
issuing a license across a restart that breaks.

### Detection

"License key validation failed" shortly after a restart, for a key that worked before it.

### Mitigation

Re-issue the license (repeat checkout, or regenerate via the billing panel) after any restart that
might have occurred since it was issued, rather than assuming the key itself is corrupt.

### Permanent Fix

Persist the RSA keypair the same way `auth/jwt.mjs` persists its secret — generate once, write to
a `0600` file under `.ai/auth/`, and load it on subsequent boots instead of regenerating.
