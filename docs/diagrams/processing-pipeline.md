# MeridianOS — Processing Pipeline (C4 Container / Runtime Flow)

> Rendered directly from the Mermaid source below — no separate image export is maintained (see
> [docs/README.md](../README.md#diagrams) for the convention).

This shows one project's task lifecycle end to end. It runs once per project — the multi-tenant
control plane ([component-relationships.md](component-relationships.md#control-plane-multi-tenant-platform))
supervises one or more instances of this exact pipeline, each in its own worktree/state DB.

```mermaid
flowchart TD
    Intake["📥 Task Intake<br/>Azure DevOps — auto-synced every watchdog tick<br/>Filesystem inbox &amp; marketplace connectors — manual today"]

    subgraph SchedulerBox["🔄 Scheduler Daemon"]
        Watchdog["Watchdog — 60s tick<br/>Reap leases · health · prune<br/>never spawns work itself"]
        RunnerCadence["Runner cadence — policy-driven<br/>15m · 30m · 45m · hourly · 2h · 3h · off"]
    end

    Intake -->|"upsertTask()"| Planner

    Planner["1️⃣ Planner<br/>Refine intake → board cards<br/>Two-tier DoR gate<br/>Spec agent writes ACs"]
    Planner -->|"proposed → spec → designing → ready-for-impl"| Router

    Router["2️⃣ Router<br/>decide() — claim-eligibility gate<br/>→ routeModel() — tier → provider+model<br/>simple · medium · medium_high · complex · critical<br/>Stage/role-aware (spec vs impl)"]
    Router -->|"Provider + model + harness"| Runner

    Runner["3️⃣ Runner<br/>Atomic lease claim<br/>Budget check (ok/warn/halt)<br/>Concurrency + WIP enforcement"]
    Runner -->|"Claimed + routed"| Launcher

    Launcher["4️⃣ Launcher<br/>Create isolated git worktree<br/>Build harness-specific prompt<br/>(prompt instructs the agent to open its own PR)<br/>Spawn agent (30min timeout)"]
    Launcher -->|"Spawn in worktree"| AgentBox

    subgraph AgentBox["🤖 Agent Execution (30min lease)"]
        Claude["Claude Code<br/>Anthropic wire<br/>--bare mode"]
        Antigravity["Antigravity<br/>Native Gemini<br/>--conversation"]
        OpenCode["OpenCode<br/>OpenAI wire<br/>opencode.json"]
    end

    AgentBox -.->|"All LLM calls (anthropic/openai wire only)"| Gateway
    AgentBox -->|"gh pr create — the agent's own responsibility"| GitRepo[("Git Repository")]

    Gateway["Gateway Sidecar<br/>verdict → enforce → forward → meter<br/>Key custody (server-side only)<br/>Tenant-labeled ledger"]

    GitRepo -->|"PR ready"| Verifier

    Verifier["5️⃣ Verifier<br/>Sync checks: gh pr checks + guardrails<br/>Async peer review in a detached worktree<br/>Prompt-injection scan before review<br/>3 attempts → bounce, then block"]
    Verifier -->|"Reclaim failed → retry"| Runner
    Verifier -->|"3rd failure → escalate"| Escalation
    Verifier -->|"All checks pass"| Done

    Escalation["6️⃣ Escalation<br/>Outbound Slack/webhook alert<br/>Founder approves/snoozes<br/>§6 governance hard-stops"]

    Done["✅ Done<br/>gh pr merge --squash --delete-branch<br/>Task transitioned to complete"]
    Complete["🏁 Complete<br/>All tasks finished<br/>Feature/epic closed"]

    Done -->|"Last task in feature"| Complete

    Watchdog -.->|"drives, every tick"| Planner
    Watchdog -.->|"drives, every tick"| Verifier
    RunnerCadence -.->|"drives, on its own schedule"| Runner
```

What changed from the previous version:

- **Intake honesty.** Azure DevOps is the only source the watchdog actually pulls from
  automatically. The filesystem inbox and the six marketplace connectors exist and can be
  configured from the dashboard, but nothing currently syncs their tasks onto the board
  automatically — a real gap, not a diagram simplification. See
  [component-relationships.md](component-relationships.md) for the exact modules involved.
  "Slack" was removed as an intake source entirely — escalation is an *outbound* notification, not
  a way tasks get in.
- **The runner does not share the watchdog's 60-second tick.** It has its own policy-driven
  cadence (`schedule:` in `policy.yaml`, default every 15 minutes, `off` disables it). Only the
  planner and the verify loop are actually driven by the 60s watchdog tick.
- **The gateway sits beside step 4, not between steps 4 and 5.** It meters LLM calls *during*
  agent execution; it has no role in deciding whether a PR is ready to verify. What actually
  triggers verification is the PR/branch existing in the git repo — which the *agent itself*
  creates (the launcher's prompt instructs it to run `gh pr create`), not something core does on
  its behalf. Gateway injection is also scoped to the anthropic/openai wire today — a provider
  routed on `google-ai` or `generic-http` has no daemon-side metering-injection path yet.
- **Merge mechanics spelled out**: the verify loop merges with `gh pr merge --squash
  --delete-branch` once every check passes, in a detached worktree it creates specifically for
  peer review (never the primary tree), after scanning the PR title/body/diff for prompt
  injection.
