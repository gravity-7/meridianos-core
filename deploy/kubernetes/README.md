# MeridianOS on Kubernetes

Production Helm chart for deploying MeridianOS's gateway (metering sidecar), daemon (multi-project
control plane + auth/billing/compliance), and dashboard (optional independently-scaled UI/API
replica) to a Kubernetes cluster.

Chart location: [`helm/meridianos`](helm/meridianos).

## Prerequisites

- Kubernetes 1.24+
- Helm 3 (no Tiller)
- A container image published from the repo root [`Dockerfile`](../../Dockerfile) (see
  "Building the image" below) — this chart does not build one for you
- A `metrics-server` installed in the cluster if you want the gateway/dashboard
  HorizontalPodAutoscalers to actually scale on CPU (most managed clusters ship one by default)
- An Ingress controller (e.g. `ingress-nginx`) if you want `ingress.enabled: true` to do anything
- Optional: [cert-manager](https://cert-manager.io/) if you want automatic TLS certificates rather
  than a pre-created `kubernetes.io/tls` Secret

## Quick start

```bash
# 1. Build and push the image (see "Building the image" below), or use a pre-published one.

# 2. Generate a JWT secret — required, no default is shipped (see values.yaml `secrets.jwtSecret`).
JWT_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))")

# 3. Install.
helm install meridianos ./helm/meridianos \
  --set image.repository=ghcr.io/your-org/meridianos-core \
  --set secrets.jwtSecret="$JWT_SECRET" \
  --set ingress.host=meridianos.yourdomain.com

# 4. Verify.
kubectl get pods -l app.kubernetes.io/instance=meridianos
helm test meridianos
```

By default this installs:
- a `gateway` Deployment (2 replicas, HPA 2→10 on 70% CPU) fronted by a ClusterIP Service
- a `daemon` StatefulSet (1 replica, pinned — see "Known limitations") with a 5Gi PVC, fronted by
  a headless Service, and an Ingress pointed at it
- a ConfigMap holding `policy.yaml` and a Secret holding the JWT secret / Stripe keys / provider
  BYO-keys

The standalone `dashboard` Deployment and the gateway's ledger PVC are **off by default** — both
have real correctness caveats, covered below, that you should read before turning them on.

## Building the image

This chart uses ONE image for all three components (gateway, daemon, dashboard), the same "N
services from ONE image" pattern the repo root's [`docker-compose.yml`](../../docker-compose.yml)
already uses locally — the Helm templates just pick a different `command`/`args` per workload.

```bash
docker build -t ghcr.io/your-org/meridianos-core:0.3.9 .
docker push ghcr.io/your-org/meridianos-core:0.3.9
```

Point `image.repository`/`image.tag` at wherever you pushed it. `image.tag` defaults to
`.Chart.AppVersion` (the meridianos-core version this chart was authored against) when unset.

## Configuration reference

All configurable values live in [`helm/meridianos/values.yaml`](helm/meridianos/values.yaml),
which is extensively commented inline — that file is the source of truth. Summary of the
top-level sections:

| Key | Purpose |
|---|---|
| `image.*` | Image repository/tag/pullPolicy shared by every component |
| `tenant` | Metering/audit label threaded through to the gateway's `--tenant` flag |
| `gateway.*` | Metering sidecar: replicas, HPA, resources, optional ledger persistence |
| `daemon.*` | Multi-project control plane: StatefulSet replicas (pinned to 1), resources, PVC |
| `dashboard.*` | Optional independently-scaled dashboard replica (disabled by default) |
| `ingress.*` | Fronts whichever of daemon/dashboard is actually serving the UI |
| `secrets.*` | JWT secret (required), Stripe keys, BYO provider API keys — names only, never commit values |
| `policy.yamlContent` | Inline `policy.yaml`, mounted read-only at `/app/policy.yaml` in every pod |

Override `policy.yamlContent` with your real policy file at install time:

```bash
helm install meridianos ./helm/meridianos --set-file policy.yamlContent=./policy.yaml ...
```

Supply provider API keys the same BYO-key way the rest of this repo does — NAMEs only in
`values.yaml`/`--set`, values from your own secret store:

```bash
helm install meridianos ./helm/meridianos \
  --set secrets.providerKeys.DEEPSEEK_KEY="$DEEPSEEK_KEY" \
  --set secrets.providerKeys.ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
```

Or set `secrets.create: false` and `secrets.existingSecret: <name>` to manage the Secret yourself
(e.g. via External Secrets Operator / Sealed Secrets) with the same key names — see
[`templates/secret.yaml`](helm/meridianos/templates/secret.yaml).

## Testing this chart

```bash
helm lint ./helm/meridianos --set secrets.jwtSecret=<test-value>
helm template ./helm/meridianos --set secrets.jwtSecret=<test-value>   # dry-run render
helm install --dry-run --debug meridianos ./helm/meridianos --set secrets.jwtSecret=<test-value>  # server-side validation against your cluster's API
helm test meridianos                                                   # after a real install — hits /healthz on every enabled Service
```

The equivalent checks also run as Node integration tests (skipped automatically if `helm` isn't on
`PATH`): [`tests/integration/test-helm-install.mjs`](../../tests/integration/test-helm-install.mjs),
[`test-hpa-scaling.mjs`](../../tests/integration/test-hpa-scaling.mjs),
[`test-pv-persistence.mjs`](../../tests/integration/test-pv-persistence.mjs). None of these spin up
a real cluster (none is provisioned in this repo's CI) — they validate that the chart renders
correctly and structurally does what it claims. Live-cluster verification (pods actually starting,
HPA actually reacting to load, a killed pod actually reattaching its PV with data intact) is a
manual step against a real or `kind`/`minikube` cluster; there is no automated substitute for it
here yet.

## Known limitations

These are real, current constraints of the underlying application (not just this chart) — read
before you flip the corresponding value on.

1. **The daemon MUST stay at 1 replica.** `control-plane.mjs`'s `ProjectManager` supervises child
   tenant processes with Node's `child_process` module — that supervision is local to whichever
   pod the process runs on. A second daemon replica would not see, and could not manage, the
   projects the first one spawned. The chart does not let `daemon.replicaCount` be driven by an
   HPA for this reason.

2. **The gateway's SQLite ledger is single-writer.** `better-sqlite3` (WAL mode) supports one
   writer at a time; a shared network volume does not make concurrent writers from multiple pods
   safe (SQLite's file-locking assumptions don't hold over NFS/EFS-style CSI drivers). That's why
   `gateway.persistence.enabled` defaults to `false` — each replica just uses its own ephemeral
   ledger, fine when ledger rows are aggregated elsewhere. If you need durable ledger data AND
   horizontal gateway scaling, you currently have to choose one: either pin `gateway.replicaCount`
   /`gateway.autoscaling.maxReplicas` to `1` with persistence on, or accept per-pod ephemeral
   ledgers with out-of-band aggregation. There's no built-in multi-writer ledger backend yet.

3. **The standalone `dashboard` Deployment is a genuinely separate process from the daemon**,
   sharing no state with it unless you point both at the same ReadWriteMany volume. Enabling
   `dashboard.enabled` without doing so gives you two independently-diverging copies of
   `control-plane.db` (different users, different projects, depending which pod answers a given
   request) — confusing at best. Until an RWX StorageClass is wired up (or the control plane grows
   a real network API instead of direct SQLite access), the supported default is to leave
   `dashboard.enabled: false` and let `ingress.yaml` route straight to the daemon's Service, which
   already serves the identical dashboard routes (`dashboard/server.mjs` is literally what the
   daemon container runs — see `daemon-statefulset.yaml`'s header comment).

4. **The image runs as root.** The repo root `Dockerfile` has no `USER` directive, so
   `securityContext.runAsNonRoot` is not forced by this chart (it would just fail to start against
   the current image). Harden the image yourself (add a `USER` line, rebuild) before setting
   `securityContext.runAsNonRoot: true`.

5. **First boot on a fresh PVC needs directories that the application doesn't create for you.**
   `control-plane.mjs`'s `new Database(dbPath)` and `auth/jwt.mjs`'s secret-file read both assume
   `.ai/auth/` and `.ai/gateway/` already exist. The daemon/dashboard containers work around this
   with a `mkdir -p` in their startup command rather than a code change — see
   `daemon-statefulset.yaml` / `dashboard-deployment.yaml`.

## Uninstall

```bash
helm uninstall meridianos
```

PVCs are not deleted automatically by `helm uninstall` (this is standard Helm/StatefulSet
behavior, not chart-specific) — remove them explicitly if you want the data gone:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=meridianos
```
