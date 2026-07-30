# Subscription Setup Guide

This guide helps you route subscription-plan traffic (Claude Pro, GitHub Copilot, Anti-Gravity) through the MeridianOS gateway for unified cost visibility alongside your BYO-key API traffic.

> **⚠️ Legal Disclaimer**: Ensure your subscription terms allow this usage. MeridianOS does not bypass or circumvent any provider's authentication — it proxies your existing session tokens. You are responsible for verifying that your subscription agreement permits token-based proxy usage.

---

## Claude Pro

**Last verified**: 2026-07-30

### Prerequisites
- Active Claude Pro subscription
- Claude Code or Claude Cowork installed

### Token Extraction

1. Locate your Claude authentication file:
   - **macOS/Linux**: `~/.claude/auth.json`
   - **Windows**: `%USERPROFILE%\.claude\auth.json`
2. Find the `sessionToken` or `accessToken` field
3. Copy the token value

### Configuration

1. Set the environment variable:
   ```powershell
   # Windows PowerShell
   $env:CLAUDE_PRO_SESSION_TOKEN = "your-token-here"
   ```
   ```bash
   # macOS/Linux
   export CLAUDE_PRO_SESSION_TOKEN="your-token-here"
   ```
2. In the MeridianOS Dashboard, navigate to **Settings → Subscription Setup**
3. Select **Claude Pro** from the plan type dropdown
4. Check the legal disclaimer checkbox
5. Enter `CLAUDE_PRO_SESSION_TOKEN` as the environment variable name
6. Save configuration

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Token expired | Re-extract token from `auth.json` and update environment variable |
| 401 Unauthorized | Token may have been revoked — re-extract a fresh token |
| File not found | Claude may not be installed or may use a different auth storage location |

---

## GitHub Copilot

**Last verified**: 2026-07-30

### Prerequisites
- Active GitHub Copilot subscription
- VS Code with Copilot extension installed

### Token Extraction

1. Open VS Code
2. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
3. Run: **Developer: Toggle Developer Tools**
4. Navigate to the **Console** tab
5. Run: `const session = await vscode.authentication.getSession('github', ['read:user'], { createIfNone: false }); console.log(session?.accessToken);`
6. Copy the displayed token

Alternatively, GitHub Copilot tokens can be found in the VS Code credential store:
- **Windows**: Credential Manager → `vscode-github.copilot`
- **macOS**: Keychain Access → `vscode-github.copilot`
- **Linux**: `secret-tool lookup app vscode-github.copilot`

### Configuration

1. Set the environment variable:
   ```powershell
   $env:COPILOT_SESSION_TOKEN = "your-token-here"
   ```
2. In the MeridianOS Dashboard, navigate to **Settings → Subscription Setup**
3. Select **GitHub Copilot** from the plan type dropdown
4. Check the legal disclaimer checkbox
5. Enter `COPILOT_SESSION_TOKEN` as the environment variable name
6. Save configuration

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Token extraction method not working | GitHub may have changed auth storage — check the [Report broken](#reporting-issues) section |
| Copilot not routing through gateway | Ensure VS Code proxy settings are configured (see IDE Connect page) |

---

## Anti-Gravity (Gemini)

**Last verified**: 2026-07-30

### Prerequisites
- Active Anti-Gravity subscription or Google AI API access
- Anti-Gravity extension or CLI tool installed

### Token Extraction

Anti-Gravity uses native Gemini authentication. The gateway preserves Anti-Gravity's own auth headers when proxying requests.

1. Locate your Anti-Gravity configuration:
   - Check the Anti-Gravity extension settings in VS Code
   - Or the Anti-Gravity CLI config file
2. Find the API key or session token
3. Copy the token value

### Configuration

1. Set the environment variable:
   ```powershell
   $env:ANTIGRAVITY_SESSION_TOKEN = "your-token-here"
   ```
2. In the MeridianOS Dashboard, navigate to **Settings → Subscription Setup**
3. Select **Anti-Gravity** from the plan type dropdown
4. Check the legal disclaimer checkbox
5. Enter `ANTIGRAVITY_SESSION_TOKEN` as the environment variable name
6. Save configuration

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Gemini API errors | Verify the token has the correct API scope/permissions |
| Auth passthrough not working | Anti-Gravity may use a custom auth flow — check the [Report broken](#reporting-issues) section |

---

## Reporting Issues

If token extraction methods stop working due to provider changes:

1. Click the **Report broken** button in the Dashboard → Subscription Setup page
2. Or open a GitHub Issue: [github.com/gravity-7/meridianos-core/issues/new](https://github.com/gravity-7/meridianos-core/issues/new)
3. Include: provider name, what you tried, and any error messages

We update these guides as provider auth mechanisms change. Check back for updates.
