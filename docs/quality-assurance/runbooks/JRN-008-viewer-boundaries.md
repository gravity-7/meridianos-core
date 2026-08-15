# Viewer boundaries and read-only visibility

- **journey_id: JRN-008**
- **Persona:** Organization viewer
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

A stakeholder can inspect approved project context while MeridianOS keeps
operational and privileged changes outside the viewer role.

## Preconditions

Use `organization_roles`, signing in only as the generated viewer for project A.
Project B remains an isolation sentinel; no real account is involved.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Dashboard | Open project A as viewer | Permitted project/status information is visible. |
| 2 | Task/activity | Inspect generated activity | Read-only history is available without mutation controls succeeding. |
| 3 | Restricted control | Attempt a task or settings mutation | UI/API gives a clear denial and preserves state. |
| 4 | Navigation | Use keyboard to reach available actions | Focus is visible and keyboard interaction stays read-only. |
| 5 | Isolation check | Request generated project B context | Cross-project access is denied. |

## Recovery

The viewer can return to permitted context or request escalation. A denial is a
successful security outcome, not a reason to retry with another user session.

## Truth and claim boundaries

This demonstrates generated RBAC and project isolation. It does not demonstrate
SSO; current SSO capability must not be represented as functional in a prospect demo.

## Evidence

Keep rejected request details and role storage internal under `artifacts/qa/<run-id>/`.
