---
name: "meridianos-review-antigravity"
description: "Code review agent powered by Antigravity (Gemini 3.1 Pro) — reviews PRs against spec.md acceptance criteria and constitution principles"
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
name: "meridianos-review-antigravity"
description: "Antigravity (Gemini 3.1 Pro) review agent — independent PR code review against spec-kit artifacts"
