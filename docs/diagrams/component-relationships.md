# MeridianOS — Component Relationships (C4 Component)

> Rendered directly from the Mermaid source below — no separate image export is maintained (see
> [docs/README.md](../README.md#diagrams) for the convention).

Two diagrams, one per "container" from [processing-pipeline.md](processing-pipeline.md): the
per-project **orchestration core** (unchanged in spirit since the original extraction, refined
below with what actually calls what), and the **control plane** the multi-tenant platform added on
top of it (new).

## Orchestration core

```mermaid
graph TB
    subgraph Config["⚙️ Configuration Layer"]
        ConfigMJS["config.mjs<br/>createAios() / resolvePaths()"]
        DomainPlugin["DomainPlugin<br/>agents, prompts, guardrailCheck, boardTitle,<br/>riskToAction, budgetMeter, defaultModels,<br/>agentHarness, taskCategories, tagToCategory,<br/>mcpServers, cliPath, paths"]
        TenantConfig["tenant-config.mjs<br/>.ai/tenant.yaml loader<br/>deprecated fallback"]
        Providers["providers.mjs<br/>PROVIDERS registry"]
        PolicyYAML["policy.yaml<br/>budget caps, cadence,<br/>model_routing, agents"]
    end

    TenantConfig -.->|"deprecated fallback"| DomainPlugin
    PolicyYAML -->|"agents field"| DomainPlugin
    DomainPlugin --> ConfigMJS

    subgraph Orchestration["🔄 Orchestration Layer"]
        Scheduler["scheduler.mjs<br/>start() — composition root"]
        Watchdog["watchdog.mjs<br/>60s tick — reap leases, health<br/>never spawns work itself"]
        Planner["planner.mjs<br/>plannerCycle()"]
        VerifyLoop["verify-loop.mjs<br/>verifyCycle() — stateful driver"]
        Verifier["verifier.mjs<br/>pure check primitives"]
        Runner["runner.mjs<br/>planRun → executeRun<br/>own policy-driven cadence"]
        RouterDecide["router.mjs<br/>decide() — claim-eligibility gate"]
        ModelRouter["model-router.mjs<br/>routeModel() — tier → provider+model"]
        Launcher["launcher.mjs<br/>launchAgent()"]
    end

    Scheduler -->|"setInterval, 60s"| Watchdog
    Scheduler -->|"cadence: 15m…3h or off"| Runner
    Watchdog --> Planner
    Watchdog --> VerifyLoop
    VerifyLoop --> Verifier
    Runner <-->|"decide() calls routeModel()"| RouterDecide
    RouterDecide --> ModelRouter
    Runner -->|"claimTask + launch()"| Launcher

    subgraph Execution["🚀 Execution Layer"]
        Worktree["worktree.mjs<br/>isolated git worktrees"]
        Harness["harness-adapters.mjs<br/>claude-code · antigravity · opencode"]
        Inject["gateway/inject.mjs<br/>rewrite spawn plan<br/>anthropic/openai wire only"]
        GatewaySrv["gateway/server.mjs<br/>verdict → enforce → forward → meter"]
    end

    Launcher --> Worktree
    Launcher --> Harness
    Launcher -->|"if config.gateway.url set"| Inject
    Inject --> GatewaySrv
    Harness -->|"agent runs its own gh pr create"| GitRepo[("Git Repository")]
    VerifyLoop -->|"gh pr merge --squash --delete-branch"| GitRepo

    subgraph PluginsCore["🔌 Task-Intake Plugins"]
        ADOSource["azure-devops-source.mjs<br/>syncFromAdo() — the only path<br/>auto-wired into the scheduler loop"]
        PluginLoader["plugin-loader.mjs / plugin-registry.mjs<br/>marketplace: install · configure · test<br/>fetchTasks() not auto-synced yet"]
        IntakeRegistry["intake-registry.mjs<br/>name/list/read contract<br/>inbox &amp; github sources — test-only today"]
    end

    Watchdog -->|"if integrations.azure_devops.enabled"| ADOSource
    ADOSource -->|"upsertTask()"| State

    subgraph Data["💾 Data Layer"]
        DB["db.mjs<br/>node:sqlite, WAL"]
        State["state.mjs<br/>only writer — tasks, leases, history"]
        Ledger["gateway/ledger.mjs<br/>token_events + observability tables"]
        Budget["budget.mjs<br/>5h + weekly windows"]
        ModelRegistry["model-registry.mjs<br/>discovery cache — separate tiering<br/>(quick/medium/best), dashboard/CLI-only"]
    end

    State --> DB
    Runner --> State
    GatewaySrv --> Ledger
    Budget -->|"gateway on: reads ledger directly"| Ledger
    Budget -.->|"gateway off: fallback"| Usage

    subgraph CrossCutting["🔀 Cross-Cutting"]
        Usage["usage-readers.mjs<br/>multi-harness transcript usage"]
        Pricing["pricing.mjs<br/>USD cost from pricing.json"]
        Sensitive["sensitive.mjs<br/>§6 governance"]
        EscPush["escalation-push.mjs<br/>outbound Slack/webhook alerts"]
        BootGuard["boot-guard.mjs<br/>primary-tree hygiene"]
    end

    ConfigMJS -->|"injects AiosConfig"| Scheduler
    Providers --> ModelRouter
    Providers --> GatewaySrv
    Watchdog --> EscPush
    Planner --> Sensitive
    GatewaySrv --> Pricing
```

Corrections from the previous version: `router.mjs` and `model-router.mjs` are not duplicates or
parallel paths — `router.mjs`'s `decide()` is the single claim-eligibility gate and calls
`model-router.mjs`'s `routeModel()` internally to resolve the model once it has picked a task.
Neither imports anything from `gateway/` — model/tier selection is fully independent of the
gateway; the gateway only intercepts the physical wire call later, inside `launcher.mjs`.
`model-registry.mjs` is a third, unrelated thing (an auto-discovery cache with its own
quick/medium/best tiering, used only by dashboard/CLI discovery views). Planner, the verify loop,
and the runner are not a strict pipeline — the watchdog tick drives the first two independently
every 60s, while the runner fires on its own separately-configured cadence. PR creation is the
**agent's own** responsibility (the prompt `launcher.mjs` builds instructs it to run
`gh pr create` itself); core only adopts/merges what the agent already opened.

## Control plane (multi-tenant platform)

```mermaid
graph TB
    subgraph Web["🌐 Dashboard Process — one node:http server, :4317"]
        DashServer["dashboard/server.mjs<br/>~90 legacy routes + static UI"]
        ApiV1["api/v1/router.mjs<br/>/api/v1/* — mk-prefixed key auth<br/>same process, delegated wholesale"]
        RequireAuth["requireAuth() / requireProjectRole()<br/>defined locally in server.mjs<br/>— the real auth gate"]
    end

    DashServer -->|"delegates /api/v1/*"| ApiV1
    DashServer --> RequireAuth

    subgraph AuthLayer["🔐 Auth"]
        JWT["auth/jwt.mjs<br/>HMAC-SHA256, 30min expiry"]
        UserStore["auth/user-store.mjs<br/>scrypt password hashing, roles,<br/>invitations (24h expiry)"]
        ApiTokens["auth/api-tokens.mjs<br/>ApiKey scheme + mk-prefixed key scheme"]
        OAuthProvider["auth/oauth-provider.mjs<br/>github/google/azure<br/>⚠ wired, not functional end-to-end"]
    end

    RequireAuth --> JWT
    RequireAuth --> UserStore
    RequireAuth --> ApiTokens
    DashServer -.->|"authorize/callback — currently broken"| OAuthProvider

    subgraph ControlPlaneLayer["🏢 Project Supervision"]
        ProjectManager["control-plane.mjs<br/>ProjectManager"]
        Templates["TemplateLoader<br/>7 templates/*.yaml"]
        Telemetry["control-plane-telemetry.mjs<br/>opt-in local usage counters"]
        DaemonChild["Spawned project<br/>own Scheduler + Gateway"]
    end

    DashServer -->|"listProjects() / createProject()"| ProjectManager
    ProjectManager --> Templates
    ProjectManager --> Telemetry
    ProjectManager -->|"spawns daemon-entry.mjs as a child process"| DaemonChild

    subgraph BillingLayer["💳 Billing &amp; Compliance"]
        LicenseKey["licensing/license-key.mjs<br/>RSA-2048 — ⚠ keypair regenerated in<br/>memory each restart, not persisted"]
        StripeWebhook["licensing/stripe-webhook.mjs<br/>4 event types"]
        ComplianceReports["compliance/reports/*<br/>SOC2: real data<br/>GDPR / model-usage / cost-allocation:<br/>⚠ mocked or random placeholder figures"]
        AuditLog["compliance/audit-log.mjs<br/>+ activity_log (team feed)"]
    end

    DashServer --> LicenseKey
    DashServer --> StripeWebhook
    DashServer --> ComplianceReports
    AuditLog -->|"real data"| ComplianceReports

    subgraph PluginLayerCP["📦 Marketplace"]
        PluginLoaderCP["plugin-loader.mjs<br/>static analysis + contract check"]
        PluginRegistryCP["plugin-registry.mjs<br/>catalog · ratings · 6 built-ins"]
    end

    DashServer --> PluginLoaderCP
    PluginLoaderCP --> PluginRegistryCP

    subgraph ControlDBs["💾 Control-Plane Storage"]
        ControlPlaneDB[("control-plane.db<br/>projects · users · api_tokens ·<br/>invitations · licenses · activity_log ·<br/>compliance_log")]
    end

    ProjectManager --> ControlPlaneDB
    UserStore --> ControlPlaneDB
    ApiTokens --> ControlPlaneDB
    LicenseKey --> ControlPlaneDB
    AuditLog --> ControlPlaneDB
```

Notes: `auth/auth.mjs` and `auth/error-handler.mjs` are dead code in the live server (both are
Express-style middleware; the actual server is raw `node:http`) — omitted above since they aren't
part of the real request path, even though they still exist in the tree and are exercised by one
test file. `schema/control-plane-schema.sql` is a reconciled reference document, not a migration
runner — the tables above are actually created ad hoc by whichever module's constructor touches
them first. "Spawned project" is the same orchestration-core diagram above, one instance per
project the control plane supervises.
