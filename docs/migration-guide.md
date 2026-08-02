# Migration Guide: tenant.yaml → policy.yaml

**Created**: 2026-07-27 | **Feature**: Phase 0 — Foundation Hardening

## Overview

As of Phase 0, MeridianOS supports defining the agent roster directly in `policy.yaml` under the `agents` field. The legacy `.ai/tenant.yaml` file is deprecated and will be removed in Phase 2.

## Quick Migration

### Before (tenant.yaml)

```yaml
agents:
  - builder
  - reviewer
prompts:
  implRules: "Follow the project conventions..."
boardTitle: "My Project"
```

### After (policy.yaml)

```yaml
agents:
  - builder
  - reviewer

# Other policy settings remain unchanged
gateway:
  disabled: false

model_routing:
  builder:
    simple:
      provider: anthropic
      model: claude-sonnet-5
```

### Steps

1. Copy the `agents` list from `tenant.yaml` to `policy.yaml` under a top-level `agents:` key
2. Verify the daemon boots: `node daemon-entry.mjs`
3. Optional: Remove `tenant.yaml` once you confirm everything works
4. Other tenant.yaml fields (`prompts`, `boardTitle`, etc.) can be set via a JS DomainPlugin if needed

## Backward Compatibility

The system will continue to read `tenant.yaml` as a fallback with a deprecation warning:
```
[MERIDIANOS] .ai/tenant.yaml is deprecated — move agent definitions to policy.yaml under "agents:" field.
```

## Resolution Order

1. Explicit JS DomainPlugin passed to `createAios({ domain })`
2. `$AIOS_TENANT_CONFIG` env var → YAML file
3. `policy.yaml`'s `agents` field (NEW — Phase 0)
4. `.ai/tenant.yaml` (DEPRECATED — fallback)
5. Error — a DomainPlugin is required

## Multi-Tenant Platform

The Multi-Tenant Platform (v0.3.9 -> v0.4.0) introduces significant architectural changes:

### 1. Control Plane DB

A new SQLite database `.ai/control-plane.db` now tracks projects and users. You must run `node scripts/init-control-plane.mjs` once to initialize it.

### 2. Project Isolation

All agents and workspaces now run in isolated directories under their respective project roots. Legacy single-user configurations will be migrated to a default "default-project" if no project is specified.

### 3. Authentication

The dashboard now requires authentication. The first boot will output an admin temporary token to the console which you must use to set up your first admin account.

### 4. Billing/Licensing

If you deploy multiple agents beyond the Free Tier limits, ensure you have configured your valid `MERIDIANOS_LICENSE_KEY` environment variable.

### 5. Rate Limits

Adjust rate limits for public endpoints (optional)

### 6. Logging

Set up logging destinations
