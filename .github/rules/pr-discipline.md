# MeridianOS Pull Request Discipline Policy

> **Enforcement**: All AI agents and human contributors MUST follow these rules.
> **Scope**: Applies to all branches targeting `main`.

## Rules

### R1: All PRs Merged Before Feature Complete
No feature, epic, or user story is marked "done" until every associated pull request is reviewed, approved, and merged into `main`. Open PRs == incomplete work.

### R2: No Stale PRs > 48 Hours
Pull requests must receive review within 48 hours of creation. If a PR has no reviewer activity in 48 hours, escalate to the team. Stale PRs (>14 days) are automatically closed by CI.

### R3: Branches Deleted After Merge
Every merged branch MUST be deleted immediately after merge. The `stale-cleanup` workflow enforces this automatically.

### R4: Main Always Deployable
The `main` branch must be in a deployable state at all times. All CI checks (tests, lint) must pass before merge. Broken `main` = stop all other work and fix.

### R5: PR References Parent Issue
Every PR description MUST reference the parent issue using GitHub's closing keyword syntax:
```
Closes #123
```
Or for spec-kit managed work:
```
Part of: [Epic-P0] Foundation Hardening
```

### R6: PR Title Format
All PR titles must follow the format:
```
[Epic]-[Feature]: Brief description
```
Examples:
- `[PR-0.1]: Merge stale branches and close defunct PRs`
- `[P0-F1]: Implement OpenAI wire launcher injection`
- `[P2-F3]: Add model auto-discovery from provider APIs`

### R7: PR Size Limit
PRs should be small and focused — ideally under 400 lines changed. Large PRs (>800 lines) require explicit justification in the PR description.

### R8: No Direct Pushes to Main
All changes to `main` MUST go through a pull request. Direct pushes and force pushes are blocked by branch protection rules.

## Rationale

Multi-agent orchestration introduces unique risks:
- **Race conditions**: Two agents modifying the same file
- **Divergent styles**: Each agent with different coding preferences
- **Orphaned work**: Abandoned branches from failed agent runs
- **Merge chaos**: Untracked dependency conflicts

Strict PR discipline is the only defense. Every change is reviewed, traceable to an issue, and merged through a single gate (`main`).

## Exceptions

- **Hotfixes**: May bypass R2 (48h review) but still require R4 (CI passing) and R8 (PR required)
- **Documentation-only changes**: May bypass R2 but still require R8
- **CI/CD config changes**: May self-approve if the change is to fix broken CI

## Verification

Run this check before marking any feature complete:
```bash
gh pr list --state open --repo gravity-7/meridianos-core
# Must return zero results for the feature's epic
```
