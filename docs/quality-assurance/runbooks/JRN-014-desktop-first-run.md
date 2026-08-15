# Desktop first run, daemon health, and locked-keychain recovery

- **journey_id: JRN-014**
- **Persona:** Desktop first-run administrator
- **Classification:** DETERMINISTIC-SIMULATED
- **Synthetic data: yes**
- **Review status:** REVIEWED-FOR-INTERNAL
- **Runbook reviewed:** 2026-08-14

## Customer value

An administrator can understand how the desktop companion guides local setup,
checks daemon/dashboard readiness, and explains a locked-keychain recovery path.

## Preconditions

Use `desktop_first_run`: fresh temporary app data, fake keychain, fake daemon,
and loopback provider. A manual smoke may open the packaged surface later, but
normal evidence uses generated local state only.

## Visible steps

| # | Screen | Action | Expected visible result |
| --- | --- | --- | --- |
| 1 | Desktop wizard | Start fresh generated profile | Wizard identifies local setup and synthetic configuration. |
| 2 | Keychain step | Store generated sentinel in fake keychain | UI confirms protected local handling without revealing value. |
| 3 | Daemon health | Start fake daemon | Readiness and dashboard handoff become visible. |
| 4 | Dashboard handoff | Open generated local dashboard | The established dashboard receives synthetic status only. |
| 5 | Recovery | Lock fake keychain and retry | Clear recovery guidance appears; no insecure fallback is silently used. |

## Recovery

Unlock or reset only the fake keychain, then restart the local fixture. A real
machine keychain, signed package, or user credential requires separate manual
approval and is not an agent default.

## Truth and claim boundaries

This is a desktop workflow simulation. It does not certify a signed installer,
operating-system keychain behavior, or a real provider credential on every device.

## Evidence

Keep desktop diagnostics, app-data paths, and screenshots internal at
`artifacts/qa/<run-id>/`; client sharing requires redaction and review.
