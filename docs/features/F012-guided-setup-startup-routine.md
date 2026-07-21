# F012 – Guided Setup & Startup Routine

**Feature ID:** F012
**Area:** Foundation
**Wedge:** All Wedges — First-Run Experience
**Status:** Proposed
**Priority:** P1 — Blocks clean end-user onboarding
**Estimated Effort:** 2 days
**Assigned To:** builder (DeepSeek V4 Pro via gateway)
**Dependencies:** boot-check.mjs (built), dashboard (F004)
**Blocks:** Production deployment readiness

---

## Business Context

### Problem
Today, a new MeridianOS user must manually:
1. Create `.ai/policy.yaml` with correct YAML syntax
2. Set up env vars for provider keys
3. Define agent roster + caps
4. Initialize git
5. Run `node scheduler.mjs` and hope it works

The `boot-check.mjs` module catches errors at startup, but the user still has to fix them by editing files manually. There is no guided flow that says: "Welcome to MeridianOS. Let's set up your agent fleet. Which providers do you use? What's your budget?"

### Success Criteria
A first-time user runs `node scheduler.mjs` and instead of cryptic errors, sees:
1. Pre-flight checks with clear pass/fail
2. If critical config is missing → an interactive setup mode that asks questions and writes the files
3. The setup mode is optional — power users can skip it with `--no-setup` flag
4. After setup, daemon boots with all checks green

---

## Functional Requirements

### FR1: Interactive Setup Mode
When critical pre-flight checks fail (no policy file, no git, missing keys), the daemon SHALL offer:
```
⚠️  First-run setup required. Run interactively? [Y/n]
```

If confirmed, an interactive CLI wizard walks through:
1. **Agent roster:** "How many agents? Name them." → writes `mos-domain.mjs` or `policy.yaml`
2. **Providers:** "Which LLM providers? (deepseek/anthropic/openrouter/ollama)" → writes `providers` section
3. **API keys:** "Enter your DeepSeek API key (stored in .env, never committed):" → writes `.env`
4. **Budget caps:** "What's the 5h token cap for builder? [5000000]" → writes `agent_budget`
5. **Cadence:** "How often should agents run? [every_15m]" → writes `schedule`
6. **Git init:** "Initialize git repo? [Y/n]" → runs `git init`
7. **Summary:** Shows all choices, confirms, writes files, boots daemon

### FR2: Non-Interactive Mode
When run with `--no-setup` flag or when piped (`!process.stdout.isTTY`):
- Pre-flight checks run as normal
- Fatal issues → exit with clear error + link to docs
- No interactive prompts

### FR3: Setup Persistence
All setup choices SHALL be written to the appropriate files:
- Agent roster → `mos-domain.mjs` or `policy.agent_budget`
- Provider config → `.ai/policy.yaml`
- API keys → `.env` (gitignored, never committed)
- Budget caps → `.ai/policy.yaml`
- Cadence → `.ai/policy.yaml`

### FR4: Idempotent
Running setup twice SHALL NOT overwrite existing config without confirmation:
```
⚠️  policy.yaml already exists. Overwrite? [y/N]
⚠️  .env already exists. Append missing keys only? [Y/n]
```

### FR5: Validation
Each input SHALL be validated:
- Agent names: alphanumeric + hyphens, no duplicates
- API keys: minimum length check, masked display during entry
- Budget caps: minimum 1 token (0 = "no cap" footgun)
- Cadence: must be in VALID_CADENCES list

---

## Technical Requirements

### TR1: New Module
`setup-wizard.mjs` — exports:
```js
export async function runSetup({ config, checks }) → { completed, filesWritten }
export function isFirstRun(config) → boolean
export function needsSetup(checks) → { needed: boolean, reasons: string[] }
```

### TR2: Integration Point
In `scheduler.mjs` `start()`, after pre-flight checks fail:
```js
if (!checks.allClear) {
  const needsWizard = needsSetup(checks);
  if (needsWizard.needed && process.stdout.isTTY && !process.argv.includes('--no-setup')) {
    const answer = await prompt('First-run setup required. Run interactively? [Y/n] ');
    if (answer.toLowerCase() !== 'n') {
      await runSetup({ config, checks });
      // Re-run checks
      checks = await runBootChecks({ config, policy });
    }
  }
  if (!checks.allClear) {
    console.error('Setup incomplete. Fix the issues above or re-run setup.');
    process.exit(1);
  }
}
```

### TR3: Prompt Library
Use Node.js `readline` for interactive prompts (zero npm dependencies):
```js
import { createInterface } from 'node:readline';
async function prompt(question, { mask = false, default: def } = {}) → string
async function confirm(question, def = true) → boolean
async function select(question, options) → string
```

### TR4: File Templates
Template files for common setups:
```
templates/
  policy-basic.yaml     → minimal setup (1 agent, deepseek)
  policy-standard.yaml  → 4-agent roster (builder/reviewer/designer/docs)
  policy-enterprise.yaml → full setup with ADO/Jira/Slack
```

---

## Database Changes

**None.** Setup writes to existing files (policy.yaml, .env, mos-domain.mjs).

---

## Acceptance Criteria

1. ✅ First run with no policy → interactive setup wizard launches
2. ✅ Setup wizard collects: agent names, providers, API keys, caps, cadence, git
3. ✅ All inputs are validated before writing
4. ✅ `--no-setup` flag skips interactive mode
5. ✅ Non-TTY environments (CI, pipes) skip interactive mode
6. ✅ Re-running setup offers to preserve existing config
7. ✅ After setup completes, daemon boots with all checks green
8. ✅ API keys are masked during entry and never echoed

---

## AI Implementation Guidance

### Files to Create
- `setup-wizard.mjs` — interactive setup wizard
- `templates/policy-standard.yaml` — template for 4-agent setup
- `templates/policy-basic.yaml` — template for 1-agent setup

### Files to Modify
- `scheduler.mjs` — integrate setup wizard into start()
- `boot-check.mjs` — add `needsSetup()` helper

### Do NOT
- Use external npm packages (keep it zero-dependency)
- Store API keys in policy.yaml (always .env)
- Make setup mandatory (always offer skip)

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
