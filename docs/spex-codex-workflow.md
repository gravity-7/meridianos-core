# Spex workflow for Codex

## Installed baseline

- Upstream: `https://github.com/rhuss/cc-spex`
- Pinned source: `04fddaa0a4f3bf453df136f2420329ef9497cbcb` (`6.0.0-dev`)
- Harness: Codex
- Security: Safe — Spex does not modify project Codex permissions.
- Enabled extensions: `spex`, `spex-gates`, `spex-worktrees`, `spex-deep-review`, and `spex-collab`.
- Disabled extensions: `spex-teams` and `spex-detach`.

The setup uses a safe overlay instead of running the upstream `spex/setup.yml` directly. That workflow reinitializes Spec-Kit with `--force` and rewrites `.gitignore`; this repository keeps committed Spec-Kit artifacts and therefore requires the overlay to preserve them.

## First pilot: specification only

Use a fresh Codex session on a clean feature branch. Pick a small real idea, then run these skills one at a time and review each artifact before continuing:

1. `$speckit-spex-brainstorm`
2. `$speckit-specify`
3. `$speckit-spex-gates-review-spec`
4. `$speckit-plan`
5. `$speckit-tasks`
6. `$speckit-spex-gates-review-plan`
7. `$speckit-spex-collab-reviewers`

Stop there for the pilot. Do not run `$speckit-implement`, `$speckit-spex-ship`, `$speckit-spex-submit`, or `$speckit-spex-finish`. Codex does not enforce Spex lifecycle hooks, so invoke the gate and collaboration skills explicitly as listed.

## Normal implementation flow

After the pilot is accepted, start in a fresh Codex session and repeat the specification sequence. Before implementation, create or enter an isolated Git worktree from a branch containing this committed setup. Then run `$speckit-spex-collab-phase-split` and use `$speckit-implement`; use `$speckit-spex-ship --ask always` only for a supervised end-to-end feature.

Run `$speckit-spex-gates-review-code` and `$speckit-spex-deep-review-run` before creating a PR. After creating a PR, the repository-required command remains mandatory:

```powershell
node scripts/dispatch-review.mjs <PR_NUMBER>
```

## Refreshing the pinned source

Clone Spex outside this repository, check out the recorded commit, and refresh the five enabled extensions with `specify extension add <source>/spex/extensions/<extension> --dev --force`. Re-run the Safe Codex configuration adapter from that source, inspect the diff, update this document with the new commit, and commit the result. Do not run the upstream bootstrap workflow without first confirming that its reinitialization and `.gitignore` behavior are compatible with the repository.
