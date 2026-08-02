# Troubleshooting Multi-Tenant Platform

## Common Issues

### 1. Dashboard Returns 401 Unauthorized
**Symptom:** You cannot access the dashboard or API endpoints return 401.
**Resolution:** Ensure you are passing the `Authorization: Bearer <token>` header. If you lost your token, you can generate a new one via the CLI using `node gateway/cli.mjs auth generate-token --admin`.

### 2. Project Fails to Start
**Symptom:** A project gets stuck in the "stopped" state after clicking Start.
**Resolution:** Check the control-plane logs for errors. Typically, this happens if a port is unavailable or the state directory is inaccessible. Ensure `port` ranges (4320-65535) are free.

### 3. SSO / OIDC Login Fails
**Symptom:** Clicking Google/GitHub login redirects to an error page.
**Resolution:** Verify your `policy.yaml` has the correct OIDC `clientId` and `clientSecret`. Ensure the `redirectUri` matches exactly what is registered in the Identity Provider.

### 4. License Key Invalid
**Symptom:** Gateway refuses to start additional agents.
**Resolution:** Your license key might be expired or cached negatively. Use the Dashboard Billing panel to force a license refresh, or ensure your host has outbound access to the Stripe/License servers.
