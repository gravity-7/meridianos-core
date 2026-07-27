---
name: "meridianos-orchestration"
description: "MeridianOS Orchestration Pipeline — scheduler, launcher, runner, verifier lifecycle, agent spawn plans"
---

# MeridianOS Orchestration Skill

## Architecture Overview

The orchestration pipeline is the core execution engine of MeridianOS.
It follows a cadence-based loop: scheduler picks up tasks → launcher builds spawn plans → runner executes → verifier validates.

## Key Files

| File | Purpose |
|------|---------|
| `scheduler.mjs` | Main daemon loop — cadence timer, task dispatch |
| `launcher.mjs` | Agent spawn plan construction |
| `runner.mjs` | Agent execution lifecycle |
| `verifier.mjs` | Post-run quality verification |
| `verify-loop.mjs` | Continuous verification loop |
| `machine.mjs` | Agent state machine |
| `state.mjs` | In-memory task state |
| `state-store.mjs` | SQLite task persistence |
| `bus.mjs` | Internal event bus |
| `bus-guard.mjs` | Event bus authorization |
| `planner.mjs` | Task planning and decomposition |
| `router.mjs` | Task routing to agents |
| `model-router.mjs` | Model selection and fallback routing |
| `intake-registry.mjs` | Agent source registration |
| `worktree.mjs` | Git worktree management for agent workspaces |
| `watchdog.mjs` | Agent health monitoring |
| `exit-classify.mjs` | Exit code classification |
| `conformance.mjs` | Output conformance checking |
| `validate.mjs` | Task validation |
| `definition-of-ready.mjs` | DoR enforcement |
| `domain-record.mjs` | Domain record management |
| `init.mjs` | CLI initialization |

## Lifecycle

```
Intake (ADO/GitHub/Inbox) → Planner → State Store (SQLite)
  → Scheduler (cadence) → Launcher (spawn plan) → Gateway (meter)
  → Runner (execute) → Verifier (validate) → Escalation (alert)
  → Dashboard (UI)
```

## Agent Spawn Plan

The launcher builds a spawn plan that includes:
- Agent configuration (model, temperature, max tokens)
- Gateway injection (base URL, API key rewrite)
- Workspace setup (git worktree)
- Environment variables

## Common Modifications

- **Changing cadence timing**: Update `scheduler.mjs` interval
- **Adding a new agent harness**: Create harness adapter → register in `harness-adapters.mjs`
- **Adding verification rules**: Update `verifier.mjs` + `definition-of-ready.mjs`
- **Changing task routing**: Update `router.mjs` and `model-router.mjs`
