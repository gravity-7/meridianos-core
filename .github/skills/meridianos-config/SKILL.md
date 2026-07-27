---
name: "meridianos-config"
description: "MeridianOS Configuration Management — policy.yaml structure, tenant config, validation, YAML conventions"
---

# MeridianOS Configuration Skill

## Architecture Overview

MeridianOS uses a single unified `policy.yaml` for all configuration.
The system is moving from split `policy.yaml` + `tenant.yaml` to unified `policy.yaml` only (Phase 0).
Configuration is loaded at boot and validated before any agent operations begin.

## Key Files

| File | Purpose |
|------|---------|
| `config.mjs` | Policy loading, path resolution, domain resolution |
| `tenant-config.mjs` | Legacy tenant.yaml support (deprecated) |
| `policy-validate.mjs` | Configuration validation |
| `policy-write.mjs` | Programmatic policy updates |
| `yaml-lite.mjs` | YAML parser/writer (to be replaced with standards-compliant library) |
| `sensitive.mjs` | Sensitive value handling |

## Policy Structure

```yaml
# policy.yaml
gateway:
  disabled: false        # Opt-out: set true to disable gateway
  port: 4318            # Gateway listen port

agents:
  builder:
    model: claude-sonnet-4
    provider: anthropic
  reviewer:
    model: claude-sonnet-4
    provider: anthropic

model_routing:
  builder:
    medium: claude-sonnet-4
    fallback: claude-haiku-3-5

budget:
  monthly_limit_usd: 100
  alert_threshold: 0.8

providers:
  anthropic:
    keyEnv: ANTHROPIC_API_KEY
  openai:
    keyEnv: OPENAI_API_KEY
```

## Config Resolution Order

1. `policy.yaml` (primary)
2. `tenant.yaml` (deprecated, fallback only)
3. Environment variables (for secrets)
4. CLI arguments (overrides)

## Key Patterns

- `resolveConfig()` — merges all config sources
- `resolvePaths()` — resolves relative paths to absolute
- `resolveDomain()` — loads agent domain configuration
- Null sentinel: `null` = no cap, `0` = hard block (zero budget)

## Common Modifications

- **Adding a config field**: Add to `config.mjs` loader → add validation in `policy-validate.mjs` → document in schema
- **Changing config format**: Update `yaml-lite.mjs` → update all readers
- **Adding a new provider**: Add to `providers` section + `keyEnv`
