---
name: ci-watch
description: Poll a GitHub pull request's CI every 30 seconds and continue the configured review workflow after all checks pass. Use after pushing implementation or review-round fixes, before dispatching Antigravity.
---

Run `node scripts/watch-pr-ci.mjs <PR_NUMBER> 30` from the repository root.

- Exit 0 only when every check completes without failures; then run the next required gate.
- Exit non-zero for failed or cancelled checks; inspect and repair them before continuing.
- Never dispatch Antigravity until the watcher exits 0.
