# Cloud Control Plane Guide

The cloud shell is a small native ES-module client for the existing `/api/cloud/*` contract. It preserves same-origin login and bearer-session behavior and exposes machine health plus an administrator-only policy preview flow.

## Login and machine health

Log in with the cloud control-plane account. The shell stores only the existing session token and recent-authentication timestamp required by the server’s confirmation contract. It then loads organization-scoped machines and aggregate provider health. Unauthorized requests remain rejected by the server.

## Policy preview

Enter a policy path and JSON value, then choose **Preview policy change**. The server calculates eligible targets and a rollback boundary without pushing a change. An administrator must review the result and type `APPLY POLICY`; the server enforces the role and recent-authentication checks. Offline machines are reported as failed outcomes rather than silently treated as successful.

The rollback action records the server-defined boundary. It does not promise to reverse external machine side effects. Follow [policy-rollback.md](./policy-rollback.md) and the incident runbook for operational recovery.

## Accessibility and privacy

The shell includes a skip link, semantic main content, live status regions, visible keyboard focus, reduced-motion and forced-colors support, 44px controls, and no horizontal page overflow down to 320px. It renders server values through HTML escaping. It does not send search text, prompts, API keys, webhook secrets, or raw request content as telemetry.
