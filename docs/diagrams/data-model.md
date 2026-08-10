# MeridianOS — Data Model & Storage Architecture

> Rendered directly from the Mermaid source below — no separate image export is maintained (see
> [docs/README.md](../README.md#diagrams) for the convention).

Two diagrams: the per-project state every MeridianOS install has (unchanged in kind since the
original single-tenant core, refined below), and the multi-tenant control-plane + optional cloud
storage the platform layer added (new).

## Per-project state

```mermaid
graph TB
    subgraph StateDB["🗄️ aios.db — Per-Project Canonical State (SQLite, WAL)"]
        Tasks["tasks<br/>id, title, status, owner<br/>complexity, acceptance_criteria<br/>lease_owner, lease_expires<br/>risk_tags, task_type<br/>snoozed_until, skipped_at<br/>approved_at, spec, contracts"]
        Events["events<br/>id, task_id, type, actor<br/>from_status, to_status<br/>pruned to ~5000 rows"]
        History["task_history<br/>run_id, task_id, agent<br/>model, provider, outcome"]
        Locks["resource_locks<br/>all-or-nothing per-task locks"]
        VerifyAttempts["verify_attempts<br/>durable 3-strike counter"]
    end

    subgraph LedgerDB["📊 ledger.db — Gateway Ledger + Observability (SQLite, WAL)<br/>grown well beyond just token events"]
        TokenEvents["token_events (append-only)<br/>id, ts, tenant, agent, session<br/>task, run_id, request_id<br/>provider, model, wire, source, ide_name<br/>4 token components, total_tokens, cost_usd<br/>enforcement_decision, cap_window, raw (JSON)"]
        OtherLedgerTables["audit_log · request_logs · model_registry<br/>analytics_hourly/daily · alert_state ·<br/>optimization_rules · spend_pause_state"]
        NullContract["⚠️ null-is-unknown contract<br/>Every token/cost field = number | null<br/>null = genuinely unknown, NEVER 0<br/>unknownRuns/costUnknownRuns track gaps"]
    end

    subgraph GitTracked["📁 Git-Tracked Configuration"]
        PolicyYAML["policy.yaml — single unified file<br/>agents (roster) · prompts · guardrailCheck<br/>risk taxonomy · budgetMeter · agent_budget<br/>model_routing · cadence · governance rules<br/>the declarative DomainPlugin source"]
        RunLog["runs/log.jsonl<br/>run_id, ts, agent<br/>model, provider, outcome<br/>Append-only (gitignored)"]
        PricingJSON["pricing.json<br/>Per-model USD rates<br/>Manually refreshed, never guesses $0"]
        FeaturesDir["features/<br/>spec.md per task<br/>Path configurable via domain.paths"]
    end

    subgraph RuntimeState["⚡ Runtime State (gitignored)"]
        Inbox["Filesystem Inbox<br/>.ai/inbox/ (manual submit)"]
        Worktrees[".ai/worktrees/<br/>Per-agent git trees"]
        Logs[".ai/logs/<br/>Rotating daemon logs"]
        Secrets[".ai/secrets/<br/>escalation-webhook"]
        Transcripts["Transcript Stores<br/>~/.claude/ · ~/.gemini/<br/>~/.local/share/opencode/<br/>(Harness-native)"]
    end

    Tasks -->|"render.mjs"| BoardJSON["board.json<br/>Generated snapshot"]
    Tasks -->|"render.mjs"| BoardMD["board.md<br/>Human-readable"]
    Events --> Tasks
    History --> Tasks
    VerifyAttempts --> Tasks

    subgraph Relationships["🔗 Key Relationships"]
        Rel1["task.id → token_events.task<br/>Links board card to LLM spend"]
        Rel2["run_id → token_events.run_id<br/>Links agent run to exact cost"]
        Rel3["token_events.tenant → policy.yaml<br/>Per-tenant budget vs actual spend"]
        Rel4["runlog.session → usage readers<br/>Harness transcript → budget verdict,<br/>used as a fallback when the gateway is off"]
    end
```

The previous version carried two separate nodes both effectively labeled "policy.yaml" — a
leftover from before Phase 0 unified `tenant.yaml` into `policy.yaml`. Merged into one node above;
`.ai/tenant.yaml` still exists only as a deprecated fallback (see
[component-relationships.md](component-relationships.md)).

## Control-plane &amp; cloud storage (multi-tenant platform)

```mermaid
graph TB
    subgraph ControlPlaneDB["🏢 control-plane.db — Multi-Tenant Control Plane (SQLite)<br/>reference schema: schema/control-plane-schema.sql —<br/>tables are actually created ad hoc by whichever module runs first"]
        Projects["projects<br/>id, status, template,<br/>config_path, state_path, port, health_status"]
        Users["users / project_users<br/>RBAC: admin · operator · viewer"]
        ApiTokensTbl["api_tokens<br/>SHA-256-hashed ApiKey scheme"]
        Invitations["invitations<br/>24h expiry"]
        Licenses["licenses<br/>tier, RSA-signed key —<br/>⚠ signing keypair not persisted across restarts"]
        ActivityLog["activity_log<br/>team feed"]
        ComplianceLog["compliance_log<br/>SOC2/GDPR audit trail —<br/>a separate table from activity_log"]
    end

    Projects -->|"one aios.db + one ledger.db each"| SpawnedState[("Each spawned project's own<br/>aios.db + ledger.db —<br/>see the per-project diagram above")]

    subgraph CloudDB["☁️ cloud/schema.sql — Optional, Separately-Operated (SQLite)<br/>8 cloud_-prefixed tables, zero foreign keys into control-plane.db"]
        CloudOrgs["cloud_organizations · cloud_users · cloud_machines"]
        CloudMeta["cloud_metadata<br/>machine_id, ts, provider, model,<br/>tokens, cost, latency_ms — no room for a key or prompt"]
        CloudHealth["cloud_provider_health"]
        CloudPolicy["cloud_policy_updates / cloud_policy_acks"]
        CloudAudit["cloud_audit_log<br/>every mutation, append-only"]
    end

    CloudOrgs --> CloudMeta
    CloudOrgs --> CloudHealth
    CloudOrgs --> CloudPolicy
```

`schema/project-schema.sql` (a third, smaller schema — one `task_comments` table per project's own
DB) and the JSON Schemas (`schema/policy.schema.json`, `provider.schema.json`,
`domain-record.schema.json`) validate config shapes rather than describing stored data, so they're
omitted from this diagram.
