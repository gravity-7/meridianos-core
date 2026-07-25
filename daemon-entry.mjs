#!/usr/bin/env node
/**
 * daemon-entry — zero-code Docker entrypoint for the MeridianOS daemon.
 *
 * This is the "just mount your config and go" entrypoint. It calls `start()` from scheduler.mjs
 * WITHOUT an explicit DomainPlugin — the config resolution chain in config.mjs will auto-discover
 * the tenant from:
 *   1. `$AIOS_TENANT_CONFIG` env var → YAML file path
 *   2. `.ai/tenant.yaml` in `$AIOS_ROOT` (or the mounted repo root)
 *
 * Usage (Docker):
 *   docker run -v ./my-tenant:/tenant -e AIOS_ROOT=/tenant meridianos-core daemon-entry.mjs
 *
 * Usage (bare Node):
 *   AIOS_ROOT=/path/to/tenant node daemon-entry.mjs
 *
 * Environment variables honored:
 *   AIOS_ROOT             — repo root (default: two dirs up from this file)
 *   AIOS_DB               — state DB path override
 *   AIOS_WORKTREE_ROOT    — worktree root override (rarely needed)
 *   AIOS_TENANT_CONFIG    — explicit tenant YAML path
 *   AIOS_DASHBOARD_PORT   — dashboard port (default 4317)
 *   AIOS_DRY_RUN          — set to "1" for dry-run mode
 */

import { start } from './scheduler.mjs';

const port = Number(process.env.AIOS_DASHBOARD_PORT) || 4317;

console.log(`[meridianos] Starting daemon (dashboard on :${port})...`);
console.log(`[meridianos] Tenant config: ${process.env.AIOS_TENANT_CONFIG || '.ai/tenant.yaml (default)'}`);

try {
  await start(); // domain auto-resolved from .ai/tenant.yaml or $AIOS_TENANT_CONFIG
} catch (err) {
  console.error('[meridianos] Failed to start:', err.message);
  if (err.message.includes('DomainPlugin is required')) {
    console.error('[meridianos] Create a .ai/tenant.yaml file in your repo root, or set $AIOS_TENANT_CONFIG.');
    console.error('[meridianos] See docs/DEPLOY.md for the tenant.yaml schema.');
  }
  process.exit(1);
}
