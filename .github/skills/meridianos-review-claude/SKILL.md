---
name: "meridianos-review-claude"
description: "Code review agent powered by Claude Code (Sonnet 5) — reviews PRs against spec.md acceptance criteria and constitution principles"
model: "claude-sonnet-5"
provider: "anthropic"
harness: "claude-code"
instructions: ".github/skills/meridianos-review-claude/instructions.md"
tools: ["read_file", "grep_search", "file_search", "run_in_terminal"]
allowed_actions:
  - "Read PR diff from GitHub API"
  - "Read spec.md, plan.md, tasks.md from specs/ directory"
  - "Read constitution from .specify/memory/constitution.md"
  - "Post review comments to PR via GitHub API"
  - "Run npm test to verify test suite"
forbidden_actions:
  - "Modify any source code"
  - "Push commits"
  - "Merge PRs"
  - "Access environment variables or secrets"
output_format: |
  ## Claude Code Review — PR #N

  ### Verdict: ✅ APPROVE / ⚠️ CHANGES REQUESTED / ❌ REJECT

  ### Spec Compliance
  | User Story | Acceptance Scenario | Status | Notes |
  |------------|---------------------|--------|-------|

  ### Constitution Check
  | Principle | Status | Evidence |
  |-----------|--------|----------|

  ### Code Quality
  - [list specific findings with file:line references]

  ### Test Coverage
  - [new tests added? existing tests pass?]
---
name: "meridianos-review-claude"
description: "Claude Code (Sonnet 5) review agent — independent PR code review against spec-kit artifacts"
