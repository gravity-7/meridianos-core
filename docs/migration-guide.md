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
