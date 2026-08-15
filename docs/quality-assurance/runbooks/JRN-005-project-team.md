# Project creation and team collaboration

- **journey_id: JRN-005**
- **Persona:** Organization administrator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

An administrator can create an isolated project, assign the right synthetic
roles, and understand who performed a project action.

## Preconditions

Use `organization_roles`: two generated projects and generated admin, operator,
and viewer accounts. Local mail capture replaces real invitations; no person or
customer project is contacted.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Projects | Create generated blank/template project | The new project is separate from the second fixture project. |
| 2 | Team | Add generated operator and viewer memberships | Role labels and project scope are visible. |
| 3 | Task/activity | Start a permitted synthetic task | Activity identifies the generated actor and project. |
| 4 | Team | Inspect member list | Membership and role state remain project-specific. |
| 5 | Audit/activity | Review recent event | The action is attributable without disclosing credentials. |

## Recovery

Attempt to apply a membership from the second project. The UI/API must deny the
cross-project operation and leave both projects unchanged.

## Truth and claim boundaries

This is a local role/isolation demonstration. It does not send a real invitation
or prove a customer's identity-provider integration.

## Evidence

Store raw role/API and browser evidence in `artifacts/qa/<run-id>/`; approved
screenshots must replace all generated names and identifiers if shared.
