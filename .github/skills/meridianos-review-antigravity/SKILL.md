---
name: meridianos-review-antigravity
description: Read-only independent PR review against the full checkout and approved Spec Kit artifacts.
model: gemini-3.1-pro
provider: google
harness: antigravity
instructions: .github/skills/meridianos-review-antigravity/instructions.md
tools: [read_file, grep_search, file_search]
allowed_actions:
  - Read the detached PR checkout and complete review context
  - Read all approved artifacts in the selected specs directory
  - Return a review verdict for the dispatcher to post
forbidden_actions:
  - Modify any source code or review artifact
  - Create, delete, or rename files
  - Execute commands that change repository state
  - Commit, push, open a pull request, or merge a pull request
budget:
  window: 5h
  threshold_pct: 80
  on_exhausted: PENDING/BLOCKED; do not approve or permit merging
output_format: |
  ### Verdict: APPROVE | REQUEST_CHANGES | ERROR

  Every finding includes severity, path:line, evidence, and recommendation.
---

# MeridianOS Antigravity review

Follow the referenced instructions exactly. This is a mandatory, fail-closed review gate.
