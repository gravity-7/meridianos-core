---
name: "meridianos-review-antigravity"
description: "Code review agent powered by Antigravity (Gemini 3.1 Pro) — reviews PRs against spec.md acceptance criteria and constitution principles. Respects 5H budget: at >80% exhaustion, review is automatically skipped and PR merges without review."
model: "gemini-3.1-pro"
provider: "google"
harness: "antigravity"
instructions: ".github/skills/meridianos-review-antigravity/instructions.md"
tools: ["read_file", "grep_search", "file_search"]
allowed_actions:
  - "Read PR diff from GitHub API"
  - "Read spec.md, plan.md, tasks.md from specs/ directory"
  - "Read constitution from .specify/memory/constitution.md"
  - "Post review comments to PR via GitHub API"
forbidden_actions:
  - "Modify any source code"
  - "Push commits"
  - "Merge PRs"
  - "Execute terminal commands"
budget:
  window: "5h"
  threshold_pct: 80
  on_exhausted: "SKIP — PR merges directly without review. Budget note posted to PR."
output_format: |
  ## Antigravity Review — PR #N

  ### Verdict: ✅ APPROVE / ⚠️ CHANGES REQUESTED / ❌ REJECT

  ### Architecture Review
  - Does this change follow MeridianOS patterns?
  - Any zero-dependency violations?

  ### Spec Compliance
  | User Story | Acceptance Scenario | Status | Notes |
  |------------|---------------------|--------|-------|

  ### Edge Cases & Risks
  - [list potential issues the implementing agent may have missed]

  ### Recommendation
  - [clear actionable next step]

---

## Headless CLI Review Process

The review dispatcher is `node scripts/dispatch-review.mjs <PR_NUMBER>`. It resolves the matching `specs/<PR branch>/` directory when present, streams the review prompt through stdin to avoid Windows command-line limits, and launches `agy` with the repository added as its workspace.

Before a headless Antigravity review can inspect repository files, ensure `${HOME}/.gemini/config/config.json` contains this least-privilege grant under `userSettings.globalPermissionGrants.allow`:

`read_file(<repository-root>)`

For this repository the required value is `read_file(C:\projects\meridianos-core)`. The dispatcher validates this grant before launching Antigravity and reports the exact missing value if configuration is incomplete. The reviewer remains read-only: it may inspect the PR diff, feature artifacts, constitution, and repository files, but must not edit, commit, merge, or execute shell commands.
