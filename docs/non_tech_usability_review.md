# MeridianOS — Non-Technical End-User Usability Analysis

> **Lens**: A founder, a startup operator, a team lead, or a product manager.  
> Someone willing to pay for AI cost governance but who **does not write code, does not edit YAML, and does not know what a wire protocol is.**  
> **Key question per section**: *Can this person use this feature today? After Plan A? After Plan B?*

---

## Summary Verdict (Before the Detail)

| Question | Today | After Plan A | After Plan B |
|----------|-------|--------------|--------------|
| Can a non-technical person install MeridianOS? | ❌ No | ❌ No | ⚠️ Barely |
| Can they configure a provider? | ❌ No | ⚠️ With docs | ✅ Wizard |
| Can they add a new AI model? | ❌ No | ⚠️ YAML edit | ✅ Auto-discovered |
| Can they understand their spending? | ❌ No | ⚠️ Local dashboard | ✅ Full analytics |
| Can they set a budget in dollars? | ❌ No | ⚠️ Token math required | ✅ Dollar-first |
| Can they access the dashboard from phone? | ❌ No | ❌ No | ✅ Phase 6 |
| Can they connect VS Code to it? | ❌ No | ❌ No | ✅ Phase 4 |
| Can they get help if something breaks? | ❌ Stack trace | ⚠️ Better errors | ✅ Phase 3 |
| Can they switch between dev/prod configs? | ❌ No | ❌ No | ✅ Phase 3 |
| **Overall non-tech usability rating** | **0/10** | **3/10** | **7/10** |

> [!CAUTION]
> **MeridianOS is currently unusable by a non-technical person.** Not "hard to use." Unusable. Every interaction requires developer-level knowledge. Both plans acknowledge this. The question is whether the plans *fully fix it* — and the answer is: **partially, but with significant gaps remaining even after full execution.**

---

## 1. Installation & First Run — The First Wall

### Current State

To run MeridianOS today, a user must:

1. Have **Node.js 22+** installed (non-trivial on Windows for most non-developers)
2. Have **Docker Desktop** running
3. **Clone the repository** via Git (`git clone`)
4. Manually create the `.ai/` directory tree: `.ai/state/`, `.ai/logs/`, `.ai/worktrees/`, `.ai/policies/`, etc.
5. Manually write a `policy.yaml` and `tenant.yaml` from scratch (or copy-paste from docs)
6. Set environment variables for every API key they want to use
7. Run `node daemon-entry.mjs` and hope nothing explodes

If step 4 is missing, the daemon crashes with a **Node.js stack trace**, not a human-readable error like "Hey, your `.ai/` folder doesn't exist. Run `node init.mjs` to create it."

**Non-technical user reaction**: Closes the terminal. Never comes back.

### After Plan A (Phase 0 — Bootstrap)

Plan A's `boot-guard.mjs` fix auto-creates the `.ai/` skeleton. The crash-on-missing-directory is fixed. Error messages become human-readable.

**But**: The user still needs to know how to clone a Git repo, install Node.js, write YAML, and set environment variables. Plan A **does not ship an installer**. It doesn't create a `setup.exe`, a macOS `.dmg`, a one-line curl script, or an npm package that can be installed globally with `npm install -g meridianos`.

### After Plan B (Phase 1 — Zero-Config Bootstrap)

Plan B adds `npx meridian-gateway` — no install required beyond having Node.js. The gateway bootstraps itself, auto-detects provider keys from environment variables, and prints:

> *"Gateway listening at http://127.0.0.1:8787 — point your agents/tools here"*

This is meaningfully better. But it still assumes Node.js is pre-installed and the user knows what a terminal is.

> [!WARNING]
> **Neither plan ships a non-developer installer.** A true non-technical user needs a `.exe`, `.dmg`, or a one-click cloud option. This is the hardest thing to fix architecturally (it requires packaging, code signing, auto-update infrastructure) but it's the most important for mass adoption. Both agents ignored it entirely.

**Expert suggestion**: Before Phase 1, add a deliverable: package the gateway as a standalone binary using `pkg` or `bun compile`. A `meridianos-setup.exe` (Windows) and `meridianos.dmg` (macOS) with a GUI installer. Without this, the product's TAM is permanently limited to developers.

---

## 2. The Wizard — CLI or UI? The Most Important Question

### Current State

No wizard exists. The F012 feature spec proposes it but it **has not been built**.

### Plan A — The Wizard Design (Phase 4, Deliverable P4-D1)

Plan A's 10-step CLI wizard is the **most detailed wizard design** in either plan:

1. Welcome & Prerequisites Check
2. Repository Detection
3. Provider Selection (from the registry)
4. API Key Entry (validate with a test call)
5. Model Selection (tier assignment)
6. Agent Roster Configuration
7. Budget Configuration (conservative / balanced / aggressive templates)
8. IDE Proxy Setup
9. Review & Confirm (shows generated YAML files)
10. Bootstrap, start gateway, verify connectivity

**What type is it?** A **terminal/CLI wizard** — the user answers questions in the command line, step by step, like a Linux installer. It's interactive text, not a graphical interface.

**Can a non-technical person use it?** Partially. The flow is guided and the budget templates remove the need to calculate tokens. But:
- The user must open a terminal and type a command to start it
- Step 9 shows them "generated YAML files" — which a non-developer cannot verify or understand
- If any step fails (e.g., API key rejected), the error is a JSON response from the provider API, not a friendly message like "Your API key looks wrong. It should start with `sk-ant-`"
- There's no "go back" — most CLIs don't support navigating backwards in a wizard

### Plan A also has a Web-Based Config UI (Phase 4, Deliverable P4-D2)

This is separate from the wizard. It adds a **"Settings" tab** to the existing dashboard with:
- Provider management (list, add, edit, test, delete)
- Model tier assignment
- Budget configuration
- IDE proxy status

**This is a real UI**, not a CLI. It runs in the browser at `localhost:4317`. The user can click, fill forms, and save settings without touching the terminal after initial setup.

**The problem**: P4-D2 is labeled "day-2 operations" — it's for ongoing config changes, not for first-time setup. A non-technical user who can't survive the CLI wizard (P4-D1) will never reach the UI (P4-D2).

### Plan B — The Wizard Design (Phase 3, Deliverable P3.2)

Plan B's wizard is a comprehensive **10-step flow** with some improvements over Plan A:

1. Welcome
2. Project (name, board title, repo path)
3. Providers (auto-detect from env vars, offer to add more)
4. Models (intelligent defaults per tier)
5. Agents (intelligent defaults: builder + reviewer)
6. **Budget (asks "What's your monthly AI budget?" → auto-calculates per-agent caps)**
7. Integrations (ADO, Slack, Jira auto-detected from env vars)
8. Review summary
9. Optional test run
10. "Done — your daemon is running at localhost:4317"

Step 6 is significant: **Plan B asks for budget in dollars**. A founder says "I want to spend $200/month on AI." The wizard converts that to token caps. Plan A's budget templates (Conservative/Balanced/Aggressive) are predefined, not user-defined.

**But Plan B's wizard is also CLI-based.** It also adds:
- `--resume` flag to pick up where you left off (good UX recovery)
- Non-interactive mode for CI/automation (`node cli.mjs setup --init --providers deepseek --budget 50`)

### Plan B also has the Dashboard Configuration UI (Phase 3, Deliverable P3.1)

Plan B's dashboard settings panel is more comprehensive than Plan A's:
- Every configuration field is visible and editable (not just providers and models)
- Real-time validation with red borders and error messages
- "Apply" triggers a hot-reload where possible
- **Configuration version history** — every save creates `policy.backup.<timestamp>.yaml`
- A domain governance rules editor (prompts)

**But the biggest UX problem remains**: In both plans, the dashboard is at `localhost:4317`. The user must already have the daemon running to access the dashboard. **They need the CLI to start the daemon to get to the UI.**

> [!IMPORTANT]
> **Both wizards are CLI-based for first-time setup. Neither plan ships a standalone GUI wizard that a non-technical user can double-click to run.** The web UI is only for day-2 operations and requires the daemon to be running first.
>
> This is the **single biggest non-technical usability gap** in both plans. The sequencing problem is: terminal → daemon → browser. A non-technical user needs: browser (or desktop app) → done.

### The Correct Non-Technical Wizard Architecture

What should exist (and neither plan defines):

```
[User downloads meridianos-setup.exe]
    ↓
[GUI Installer wizard — no terminal]
    Step 1: "Welcome to MeridianOS"
    Step 2: "Which AI providers do you use?" [Checkboxes: Anthropic, OpenAI, DeepSeek...]
    Step 3: "Paste your Anthropic API key here" [Password input, validated live]
    Step 4: "What's your monthly AI budget?" [$___] [Slider: Conservative ← → Aggressive]
    Step 5: "Installing..." [Progress bar]
    Step 6: "Done! Your dashboard is at http://localhost:4317" [Open in Browser button]
    ↓
[Dashboard opens in browser — fully configured, no YAML ever touched]
```

This flow doesn't exist in either plan.

---

## 3. Configuration — The Ongoing Nightmare

### Current State: 3 Config Files

A non-technical user must understand:

| File | What Goes There | How Hard |
|------|----------------|----------|
| `policy.yaml` | Budget rules, gateway settings, model routing | Very hard — requires understanding token limits, window periods, wire protocols |
| `tenant.yaml` | Agent roster, prompts, guardrails, categories | Very hard — requires understanding DomainPlugin schema |
| `providers.mjs` | Provider definitions (it's JavaScript code) | Impossible — requires editing `.mjs` source files |

Adding a new AI provider means **editing JavaScript source code**. This is not a configuration task — it's a development task. A founder who pays $20/month for Claude Pro cannot add Anthropic as a provider without touching source code.

### After Plan A

- `providers.mjs` becomes a YAML data file (`.ai/providers.yaml`) — massive improvement
- JSON schema validation on both `policy.yaml` and `tenant.yaml`
- But still 3 config surfaces, and the user is expected to know which setting goes where

### After Plan B

- **1 config file** — `policy.yaml` absorbs everything from `tenant.yaml` (deprecated with warning)
- Dashboard Settings panel edits all fields visually
- Hot-reload where possible — no restart required for provider changes

> **Plan B is dramatically better for configuration.** But even Plan B's policy.yaml is not something a non-technical person can author from scratch. The dashboard UI is the only viable path — and it requires the daemon to be running.

### The Named Fields Problem

Even with a UI, some fields are deeply technical. Examples from `policy.yaml`:
- `wire: anthropic` (what's a wire protocol?)
- `keyEnv: ANTHROPIC_API_KEY` (what's an environment variable?)
- `per_5h_tokens: 50000` (what's a token?)
- `harness: claude-code` (what's a harness?)

**Neither plan ships a tooltip/help layer for every configuration field.** Plan B's Phase 3 UI shows forms but doesn't specify that every field has a plain-English description. Plan A's Phase 0 adds JSON schema descriptions but these appear in the YAML file comments — not in a UI.

> [!WARNING]
> **Configuration jargon is a usability wall that neither plan fully addresses.** A non-technical user seeing `wire: anthropic` in a form has no idea what "wire" means. Without in-context help text that says "This is the API format your provider uses. If you're using Anthropic, leave this as 'anthropic'", the Settings panel is just as confusing as the YAML file.

---

## 4. Budget — The Token vs. Dollar Problem

### Current State

The budget system operates in **tokens** and **time windows**:
- `per_5h_tokens: 50000` — 50,000 tokens per 5-hour window
- `per_7d_tokens: 2000000` — 2 million tokens per 7-day window

A non-technical founder's thought: *"I want to spend max $100 this month on AI."*

To implement this, they must:
1. Know that different models have different token prices (claude-sonnet costs $3/million input tokens; claude-opus costs $15/million)
2. Calculate how many tokens $100 buys for their specific model mix
3. Convert that to a per-5h and per-7d limit
4. Know that the 5-hour window resets differently from the 7-day window
5. Understand that `per_5h_tokens: 0` means "no limit" (not "zero limit") — the sentinel value bug

**This is not configuration. This is a calculus problem.**

### After Plan A

- Plan A's Phase 5 (Flexible Budget Windows) adds dollar-based caps: `cost_cap_usd: 100.00`. This is a major improvement.
- But the user still has to choose window periods (1h, 24h, 7d, monthly) and understand how they interact.
- The `enforcement: warn | halt` distinction requires understanding the difference between a warning and a hard stop.
- Still no "plain English" budget wizard.

### After Plan B

- Plan B's wizard asks: **"What's your monthly AI budget?" → auto-calculates caps**
- Budget dashboard shows a gauge: current spend / cap with color coding (green/yellow/red)
- Projection line shows "at current rate, you'll hit your cap in X days"
- Budget recommendations: "Based on your usage, we recommend a $75/week cap"

> **Plan B is significantly better for budget UX.** The dollar-first approach is correct. The projection and recommendation features treat the user as an intelligent adult who doesn't want to do math.

**Still missing from both plans**: A budget "kill switch" that a non-technical user can flip — "Pause all AI spending right now" — accessible from the dashboard with one click. Both plans have budget enforcement but it's always tied to a configured cap, not an on-demand pause.

---

## 5. Error Messages — When Things Break

### Current State

When MeridianOS fails, the user sees a Node.js stack trace:

```
TypeError: Cannot read properties of undefined (reading 'gateway')
    at Object.maybeStartGateway (scheduler.mjs:284:38)
    at async Object.start (scheduler.mjs:156:5)
```

A non-technical user looking at this has **no idea what to do**. They don't know what `scheduler.mjs` is, what `maybeStartGateway` means, or what "reading 'gateway'" implies about the solution.

### After Plan A

Plan A's Phase 0 adds human-readable error messages for boot failures:
- Missing `.ai/` skeleton → auto-created, not a crash
- Missing env vars → "Missing environment variable ANTHROPIC_API_KEY. Add it to your .env file."

This is a real improvement for the first-run case. But runtime errors (provider failures, routing failures, budget denials) are not addressed.

### After Plan B

Plan B's wizard has a "Test Run" step (step 9) that verifies everything works before leaving the user alone. If something fails during the test, the wizard reports it in context:

> *"Test run failed — your DeepSeek API key was rejected. Check that DEEPSEEK_KEY is set correctly."*

This is significantly better than discovering the error 20 minutes later when the first agent run fails silently.

**However**: Neither plan specifies a **user-facing error taxonomy** for runtime errors. When a provider is down, the user sees what? When a budget is exceeded, the user sees what? Plan A's gateway returns a `403` HTTP response — that's for the agent client, not the human. Plan B adds real-time alerts (P5.4) that can send Slack notifications, but the dashboard toast notification content isn't specified.

> [!NOTE]
> **A non-technical user needs three things from errors**: (1) What went wrong in plain English, (2) Why it happened without jargon, (3) A specific next step. Neither plan formally specifies this for runtime errors. Both address first-run errors.

---

## 6. The Dashboard — What the Non-Technical User Actually Sees

### Current Dashboard

The current dashboard is a single monolithic HTML file (85KB, all inline) served at `localhost:4317`. It shows:
- A board of tasks with agent status indicators (green/yellow/red)
- A list of recent events (capped at 30 entries)
- A restart button (Windows only — hardcoded PowerShell)
- No charts, no trends, no cost breakdowns, no provider health

**Accessibility from a non-technical perspective**:
- `localhost:4317` — requires knowing what "localhost" means and what a port number is
- Only accessible from the machine running the daemon — the founder can't check it on their phone or from another machine
- No login — anyone on the same local network can see it (security concern)
- CSS hardcodes colors for `claude` and `antigravity` agents — new agents appear with no styling

### After Plan A (Phase 7 — Dashboard 2.0)

A significant overhaul:
- Component-based architecture (no longer one 85KB blob)
- Time-series charts showing cost by provider, model, agent
- Export to CSV/JSON/PDF
- An IDE traffic panel (showing Copilot, Cursor spend)
- Per-task cost drill-down ("This feature cost $4.72")
- Still localhost-only — no remote access until Phase 8

### After Plan B (Phase 5 — Observability)

Earlier delivery of analytics:
- Spend Analytics Dashboard with KPI cards (Total Spend USD, Total Tokens, Active Providers)
- Time range selector (7d/30d/90d)
- Provider breakdown, model breakdown, agent breakdown
- Budget intelligence with gauge and projection line
- Model Cost Optimization: "Switch medium tier from V4 Pro to V4 Flash — save $23/week" with one-click apply
- Remote access arrives in Phase 6 (Plan B) vs Phase 8 (Plan A) — **Plan B gets non-local access 2 phases earlier**

> **Plan B's dashboard is available to non-technical users earlier** (Phase 5 instead of Phase 7) and with a more intelligence-driven design (optimization recommendations, budget projections).

### The Remote Access Problem

Neither current state nor early phases have remote access. The dashboard is `localhost:4317`. This means:

- A founder running MeridianOS on a server **cannot see their dashboard from their laptop**
- A team lead **cannot share a dashboard link with their manager**
- There's no mobile view — a founder can't check AI spend from their phone

Plan A fixes this in Phase 8. Plan B fixes it in Phase 6. **Both fix it too late.** Remote access with simple authentication should be in Phase 3 or 4 — it's table stakes for any monitoring tool that wants to be taken seriously by non-developers.

---

## 7. Onboarding Time — The "How Long Until Value" Test

This is the most visceral non-technical usability metric.

### Current State

Time for a non-technical user to go from "downloaded MeridianOS" to "seeing their first cost dashboard":

**∞ minutes** — it's not possible.

### After Plan A

Even with Phase 4's wizard:
1. Open terminal (5 min for a non-developer to find and open it)
2. Navigate to project directory (10 min if they've never used `cd`)
3. Run wizard (20 min — 10 steps, some technical)
4. Fix any errors (unknown — could be minutes or hours)
5. Start daemon (`node daemon-entry.mjs`) — another terminal command
6. Open browser to `localhost:4317` (5 min)

**Optimistic estimate: 45 minutes with help. Realistic estimate: never without help.**

### After Plan B

Plan B's wizard is designed for "zero to running in under 5 minutes" (its stated acceptance criteria). With the `npx meridian-gateway` zero-config bootstrap:
1. Have Node.js installed (prerequisite — often already true for their dev environment)
2. Run `npx meridian-gateway` (30 seconds)
3. Wizard auto-detects API keys from environment (1 minute)
4. Open browser to `localhost:8787` (30 seconds)

**For a user who has Node.js and has set API keys: 5 minutes.** This is achievable.

**For a user who has none of these: still impossible without a packaged installer.**

---

## 8. Specific Non-Technical Scenarios: Pass/Fail Matrix

### Persona 1: Non-Technical Founder
*"I'm paying for Claude Pro, GitHub Copilot, and our dev team uses MeridianOS agents. I want to see total monthly AI spend across everything."*

| Task | Today | Plan A | Plan B |
|------|-------|--------|--------|
| See agent-spawned spend | ⚠️ Dashboard exists, local only | ✅ Local dashboard | ✅ Remote dashboard (Phase 6) |
| See Copilot spend | ❌ | ❌ (Phase 3 for infra, Phase 7 for UI) | ✅ Phase 4+5 |
| See Claude Pro session spend | ❌ | ❌ | ✅ Phase 4.5 |
| See combined total | ❌ | ❌ | ✅ Phase 5 |
| Access from phone | ❌ | ❌ | ✅ Phase 6 |

### Persona 2: Startup Operations Manager
*"I need to set a $500/month AI budget for our engineering team and get alerted when we're at 80%."*

| Task | Today | Plan A | Plan B |
|------|-------|--------|--------|
| Set budget in dollars | ❌ (tokens only) | ✅ Phase 5 cost_cap_usd | ✅ Phase 3 wizard |
| Get Slack alert at 80% | ❌ | ✅ Phase 5 D3 | ✅ Phase 5.4 |
| See budget gauge | ❌ | ⚠️ Phase 7 | ✅ Phase 5 |
| No-code budget setup | ❌ | ⚠️ CLI wizard | ✅ Dashboard UI |

### Persona 3: Team Lead
*"I want to see which engineer's agent sessions are costing the most and why."*

| Task | Today | Plan A | Plan B |
|------|-------|--------|--------|
| Per-agent cost breakdown | ⚠️ Partial in dashboard | ✅ Phase 7 | ✅ Phase 5 |
| Per-task cost attribution | ❌ | ✅ Phase 5 D4 | ✅ Phase 5 |
| Per-IDE-session breakdown | ❌ | ✅ Phase 7 | ✅ Phase 5 |
| Identify cost anomalies | ❌ | ✅ Phase 5 D3 | ✅ Phase 5.2 |

### Persona 4: Developer who uses VS Code + Copilot
*"I want MeridianOS to automatically track my Copilot usage without me changing any settings manually."*

| Task | Today | Plan A | Plan B |
|------|-------|--------|--------|
| One-click IDE setup | ❌ | ⚠️ Phase 4 wizard step | ✅ Phase 4.1 dashboard card |
| VS Code extension with status bar | ❌ | ❌ (Phase 9) | ✅ Phase 4.2 |
| Copilot traffic in dashboard | ❌ | ✅ Phase 7 | ✅ Phase 4+5 |
| Zero manual config | ❌ | ❌ | ⚠️ Partial (VS Code extension helps) |

---

## 9. The Non-Technical User's Critical Path to Value

Neither plan explicitly maps the **minimum viable path for a non-technical user to get value**. Here it is, derived from both plans:

```
TODAY:  Usable only by developers who know Node.js, YAML, Docker, and CLI tools.

AFTER PHASE 0:  Still dev-only. Better error messages. Auto-created skeleton.

AFTER PHASE 1 (both plans):  A developer can set up the gateway easily.
                              Still not accessible to non-technical users.

AFTER PHASE 2 (both plans):  Providers can be added without code changes.
                              Still requires YAML or CLI knowledge.

AFTER PHASE 3 Plan A:        IDE traffic intercepted (infra). No non-technical
                              user can configure it yet.

AFTER PHASE 3 Plan B:        ← FIRST PHASE A NON-TECHNICAL USER CAN USE.
                              Dashboard Settings UI, dollar-based budget wizard,
                              configuration profiles. Still localhost-only.

AFTER PHASE 4 Plan B:        Non-technical user can connect their IDE via dashboard.
                              VS Code extension with no terminal required.
                              First time a non-technical user gets value from IDE monitoring.

AFTER PHASE 5 Plan B:        Real spend analytics with projections and recommendations.
                              A founder can answer "what am I spending?" without reading logs.

AFTER PHASE 6 Plan B:        Remote access + auth. Dashboard accessible from anywhere.
                              Team collaboration. Stripe billing. 
                              ← PRODUCT READY FOR NON-TECHNICAL USERS.
```

> [!IMPORTANT]
> **Plan A's non-technical users get their first usable moment in Phase 4 (after ~6 weeks of development). Plan B's non-technical users get their first usable moment in Phase 3 (after ~8 weeks — but Plan B's phases are longer so this is roughly equivalent). The critical difference is that Plan B's path to full non-technical usability (Phase 6) is shorter and more coherent than Plan A's (Phase 8).**

---

## 10. The 5 Biggest Non-Technical Usability Gaps Neither Plan Fully Solves

### 🔴 Gap 1: No Packaged Installer
**The problem**: Both plans assume Node.js is installed and the user is comfortable with a terminal. Neither ships a `.exe`, `.dmg`, or cloud-hosted version. The product cannot reach non-technical founders until this exists.  
**What's needed**: A packaged binary (via `pkg`, `bun compile`, or Electron) or a one-click cloud deployment (a "Deploy to Render/Railway" button in the README).

### 🔴 Gap 2: CLI-First, Browser-Second
**The problem**: The wizard is in the terminal. The browser UI requires the daemon to be running first, which requires the terminal. The mental model for a non-technical user is: open a website, configure it, it works. The current model is: open a terminal, run commands, check a website.  
**What's needed**: A browser-first or desktop-app-first entry point. The wizard should open in a browser, not a terminal.

### 🟡 Gap 3: No In-Context Help Text
**The problem**: Every configuration field uses technical jargon (`wire`, `keyEnv`, `harness`, `tier`, `anthropic`). Even in the dashboard UI, a non-technical user will encounter terms they don't understand. Neither plan specifies that every field must have a plain-English tooltip.  
**What's needed**: Every form field in the dashboard UI must have a `?` icon that shows a plain-English explanation. "Wire: The API format your provider uses. If you're using Anthropic, select 'anthropic'. If you're using OpenAI or a compatible service, select 'openai'."

### 🟡 Gap 4: No "Pause Everything" Button
**The problem**: Budget caps are configured in advance. There's no "I'm seeing unexpected spend — pause all AI activity right now" button. A non-technical founder who sees a spike in spend has no immediate remediation path.  
**What's needed**: A prominent "Pause All AI Spend" button on the dashboard. One click → all agent runs are suspended → all gateway traffic returns 503 → user can investigate.

### 🟢 Gap 5: No Onboarding Email Sequence / In-App Guidance
**The problem**: Both plans assume users will read documentation. Non-technical users don't read documentation — they click around and expect the app to teach them.  
**What's needed**: An in-app onboarding checklist ("Connect your first provider ✓", "Set your first budget ✓", "See your first cost breakdown ✓"). Each unchecked item links to the relevant dashboard section. This is a standard SaaS pattern (e.g., Intercom, Linear) and is absent from both plans.

---

## Final Assessment

**Plan B is meaningfully more non-technical-user-friendly than Plan A**, primarily because:

1. It sequences configurability (Phase 3) *before* features that depend on it
2. It ships remote access in Phase 6 vs. Plan A's Phase 8
3. Its budget wizard asks for dollars, not tokens
4. Its VS Code extension (Phase 4) gives non-developers a first-class UI surface in their existing tool
5. Its observability phase (Phase 5) has an optimization engine that gives actionable recommendations in plain English

**But neither plan is sufficient for true non-technical usability.** Both require terminal access, both deliver the wizard as a CLI tool, and neither ships a packaged installer or a browser-first onboarding experience.

The path to making MeridianOS genuinely accessible to non-technical users requires **one additional work stream that neither plan scopes**: a packaging and distribution layer. Until MeridianOS can be installed by someone who has never opened a terminal, the product is a developer tool — an excellent one, but not the "any AI spend, any user, fully governed" vision that both plans articulate.
