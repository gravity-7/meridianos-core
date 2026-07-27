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
