# MeridianOS — Deployment & Infrastructure

> Rendered directly from the Mermaid source below — no separate image export is maintained (see
> [docs/README.md](../README.md#diagrams) for the convention).

Three deployment shapes exist today: a single-machine Docker Compose setup, a production
Kubernetes Helm chart, and local desktop/IDE clients that can point at either — plus an entirely
separate, optional service for operators who want fleet-wide aggregation across machines.

## Docker Compose (local / single machine)

`docker compose up` starts **only the gateway** by default — the daemon service is commented out
in `docker-compose.yml` and must be opted into explicitly (with a mounted `.ai/tenant.yaml`). Both
share one image; only the entrypoint differs.

```mermaid
graph TB
    subgraph ComposeDefault["🐳 docker compose up — default: gateway only"]
        GWServer["gateway container<br/>gateway/cli.mjs · :8787"]
        GWLedgerVol[("gateway-ledger volume<br/>ledger.db")]
        GWServer --> GWLedgerVol
    end

    subgraph ComposeOptional["＋ optional daemon service — commented out by default<br/>same image, entrypoint: daemon-entry.mjs"]
        DaemonSvc["daemon container<br/>scheduler + dashboard + its own gateway · :4317"]
        StateVol[("daemon-state volume<br/>aios.db")]
        DaemonLedgerVol[("daemon-gateway volume<br/>its own ledger.db — separate from<br/>the standalone gateway's")]
        DaemonSvc --> StateVol
        DaemonSvc --> DaemonLedgerVol
    end

    EnvVars["🔑 Environment (.env, never committed)<br/>ANTHROPIC_API_KEY · DEEPSEEK_KEY · OPENROUTER_KEY …"]
    ConfigVol[("policy.yaml — read-only mount<br/>daemon only")]

    GWServer --> EnvVars
    DaemonSvc --> EnvVars
    DaemonSvc --> ConfigVol

    subgraph Providers["☁️ External Provider APIs"]
        AnthropicAPI["Anthropic"]
        MoreProviders["+ 14 more, via the declarative registry"]
    end

    GWServer -->|"meters & enforces"| AnthropicAPI
    GWServer -->|"meters & enforces"| MoreProviders
    DaemonSvc -->|"meters & enforces, via its own gateway"| AnthropicAPI
```

The previous version of this diagram had the two volumes swapped (gateway pointing at
`daemon-state`, daemon at `gateway-ledger`) — fixed above against the actual `docker-compose.yml`.
It also showed both containers as if they always ran together; by default only the gateway does.

## Kubernetes (production, `deploy/kubernetes/helm/meridianos`)

One container image backs three workloads, differentiated by command/args. The daemon is a
**StatefulSet**, not a Deployment — it needs a stable identity and a dedicated volume, not
horizontal scaling.

```mermaid
graph TB
    subgraph IngressBox["🌐 Ingress — nginx, TLS via Secret"]
        IngressNode["meridianos.example.com<br/>routes to dashboard if enabled,<br/>else straight to daemon's Service"]
    end

    subgraph K8sCluster["☸️ Kubernetes Cluster"]
        subgraph GatewayK8s["gateway — Deployment<br/>2→10 replicas · HPA @ 70% CPU"]
            GWPods["gateway/server.mjs pods<br/>:8787 · ClusterIP · cluster-internal only"]
        end

        subgraph DaemonK8s["daemon — StatefulSet<br/>1 replica, pinned · no HPA"]
            DaemonPod["scheduler + dashboard pod<br/>:4317 · headless Service"]
            DaemonPVC[("5Gi PVC per pod<br/>volumeClaimTemplates")]
            DaemonPod --> DaemonPVC
        end

        subgraph DashboardK8s["dashboard — Deployment<br/>1 replica · disabled by default<br/>HPA 1→5 @ 70% CPU, also off by default"]
            DashPods["dashboard/server.mjs pods<br/>:4317 · own 1Gi PVC"]
        end

        ConfigMap["ConfigMap, read-only<br/>policy.yaml"]
        SecretK8s["Secret — required, no default<br/>JWT secret · Stripe keys · provider keys"]
    end

    IngressNode -->|"if dashboard.enabled"| DashPods
    IngressNode -->|"else"| DaemonPod
    ConfigMap -.-> GWPods
    ConfigMap -.-> DaemonPod
    ConfigMap -.-> DashPods
    SecretK8s -.-> GWPods
    SecretK8s -.-> DaemonPod
    SecretK8s -.-> DashPods

    subgraph ProvidersK8s["☁️ External Provider APIs"]
        AnthropicAPIK["Anthropic + 14 more"]
    end

    GWPods -->|"meters & enforces"| AnthropicAPIK
    DaemonPod -.->|"own gateway sidecar, same rule"| AnthropicAPIK
```

Known limitations (documented in the chart itself, carried over here rather than restated as
diagram nodes): the daemon can't horizontally scale — `ProjectManager` supervises spawned project
processes locally via `child_process`, so a second replica wouldn't see the first's work.
Gateway persistence is off by default because its SQLite ledger is single-writer (WAL mode); only
safe pinned to 1 replica if enabled. The standalone `dashboard` Deployment shares no state with
the daemon unless both are pointed at the same `ReadWriteMany` volume, which is why it's disabled
by default. The image runs as root (no `USER` in the Dockerfile), and first boot needs the
container command to `mkdir -p` a couple of `.ai/` subdirectories the app doesn't create itself.

## Local clients & optional cloud aggregation

The desktop app and VS Code extension aren't part of either deployment above — they run on an
individual's own machine and simply point at whatever daemon is reachable. Fleet-wide aggregation
across many operators' machines is a separate, optional service an operator can choose to stand up
and opt into — not something every install talks to.

```mermaid
graph LR
    subgraph OperatorMachine["💻 An operator's own machine"]
        Desktop["Desktop App (Electron)<br/>spawns daemon-entry.mjs as a<br/>local child process, loads its dashboard"]
        VSCodeExt["VS Code Extension<br/>talks to localhost:4317 —<br/>no per-workspace scoping"]
    end

    Desktop --> LocalDaemon["Whatever daemon is running —<br/>local process, Docker container,<br/>or a port-forwarded K8s Service"]
    VSCodeExt --> LocalDaemon

    subgraph CloudOpt["☁️ MeridianOS Cloud — separate, optional deployment"]
        CloudSvc["cloud-server.mjs<br/>designed for Cloudflare Workers + D1;<br/>today ships only as a local Node dev server"]
        CloudDB[("cloud/schema.sql<br/>cloud_* tables, org-scoped —<br/>fully separate from control-plane.db")]
        CloudSvc --> CloudDB
    end

    LocalDaemon -.->|"opt-in local-agent.mjs<br/>anonymized metadata, 30-300s interval"| CloudSvc
```
