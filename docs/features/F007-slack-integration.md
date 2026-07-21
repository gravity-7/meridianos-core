# F007 – Slack Integration

**Feature ID:** F007
**Area:** Integrations
**Wedge:** Multi-Tool Integration Hub (Wedge 3)
**Status:** Proposed
**Priority:** P2 — Visibility & Distribution
**Estimated Effort:** 1 day
**Assigned To:** builder (DeepSeek V4 Pro via gateway)
**Dependencies:** None (independent, parallel with F006)
**Blocks:** None

---

## Business Context

### Problem
MeridianOS operates as a daemon — it runs autonomously, but engagement happens through the board or the dashboard. There's no lightweight way for a team member to throw a quick task at the system ("refine this idea", "estimate this feature") without opening the full toolchain.

### Why This Matters
- **Distribution:** Slack is where engineering teams LIVE. A `/meridian refine <description>` slash command puts MeridianOS one keystroke away from every developer.
- **Virality:** When someone sees a Slack bot reply with "Feature X: estimated 3.2 hours, $1.47 in AI costs, ready for implementation" — they want it too.
- **Wedge 3 proof:** Shows MeridianOS integrates with real enterprise tools (Slack, ADO, Jira).

### Success Criteria
1. A Slack slash command `/meridian refine <description>` creates a MeridianOS task and returns an estimate
2. The bot posts updates when the task transitions states
3. Works with a Slack app installed in a workspace

---

## Functional Requirements

### FR1: Slash Command — `/meridian refine`
When a user types `/meridian refine <description>`:
1. Bot acknowledges immediately ("Refining: <description>... ⏳")
2. Creates a MeridianOS task with status `spec` (triggers the spec-writing agent)
3. Agent writes spec + acceptance criteria + complexity score
4. Bot posts thread reply: "✅ Refined: **<title>** — Complexity: <score>/5 — Est. cost: $<estimate>"
5. If refinement fails: bot posts error with reason

### FR2: Slash Command — `/meridian status`
When a user types `/meridian status`:
1. Bot returns a summary of the mos-dev board:
   - Tasks in backlog
   - Tasks in progress (with agent, elapsed time, cost so far)
   - Tasks in review
   - Recent completions

### FR3: State Transition Notifications
When a MeridianOS task changes state, the bot SHALL post to a configured Slack channel:
- `proposed → spec`: "📝 <title> — spec written by <agent>"
- `designing → ready-for-impl`: "🔧 <title> — design complete, ready for implementation"
- `ready-for-impl → in-review`: "🔍 <title> — PR opened: <url>"
- `in-review → done`: "✅ <title> — merged and done"

### FR4: Slack App Configuration
The integration SHALL use a Slack app with:
- OAuth bot token (`xoxb-...`)
- Slash command: `/meridian`
- Bot user with `chat:write`, `commands`, `channels:history` scopes
- Signing secret for request verification

---

## Technical Requirements

### TR1: Module Architecture
New module: `slack-source.mjs`
```js
export async function handleSlackCommand({ body, signingSecret, config, policy }) → Response
export async function postSlackMessage({ channel, text, token }) → void
export async function postThreadReply({ channel, threadTs, text, token }) → void
export function verifySlackRequest({ body, headers, signingSecret }) → boolean
```

### TR2: HTTP Endpoint
The dashboard server (or a new endpoint) SHALL handle:
```
POST /api/slack/commands
  Header: x-slack-signature, x-slack-request-timestamp
  Body: application/x-www-form-urlencoded (Slack's default)
  → Verify signature
  → Parse command + text
  → Dispatch to handler
  → Return JSON or plain text response (within 3 seconds — Slack's timeout)
```

### TR3: Long-Running Operations
Since refinement takes >3 seconds, the bot SHALL:
1. Return immediate 200 acknowledgment ("Refining... ⏳")
2. Spawn the agent asynchronously
3. Post result via `chat.postMessage` or `chat.update` when done

### TR4: Configuration
In `.ai/policy.yaml`:
```yaml
integrations:
  slack:
    enabled: true
    bot_token_env: SLACK_BOT_TOKEN
    signing_secret_env: SLACK_SIGNING_SECRET
    notification_channel: C0123456789   # channel ID for state notifications
    allowed_channels:                    # restrict /meridian to these channels
      - C0123456789
```

### TR5: Security
- Slack request signing verification on EVERY request (prevent spoofing)
- Bot token never logged or exposed in responses
- Allowed channels restriction (don't respond to commands from unauthorized channels)
- Rate limiting: max 10 commands per minute per channel (prevent abuse)

---

## Architecture

```
Slack User                     mos-dev                           MeridianOS
──────────                     ──────                            ──────────
/meridian refine "Add login"
        │
        ▼
Slack API ──POST──▶ /api/slack/commands
                         │
                    verify signature
                    parse command
                         │
                    ┌────┴────┐
                    │  ACK    │──▶ "Refining... ⏳"
                    │ (200ms) │
                    └────┬────┘
                         │
                    create task (spec status)
                         │
                    scheduler picks up
                    planner promotes
                    launcher spawns agent
                         │
                    agent writes spec + ACs + complexity
                         │
                    ┌────┴────┐
                    │ POST    │──▶ Slack: "✅ Refined: Add Login..."
                    │ result  │
                    └─────────┘
```

---

## Database Changes

**None.** Slack events create standard MeridianOS tasks in the existing board DB.

---

## Testing

- Unit tests for signature verification
- Unit tests for command parsing
- Integration test with Slack test workspace (or mock Slack API)
- Verify timeout handling (long refinement returns ACK, then async post)

---

## Acceptance Criteria

1. ✅ `/meridian refine Add dark mode` returns immediate ACK "Refining..."
2. ✅ Within 2 minutes, bot posts thread reply with spec title, complexity, and cost estimate
3. ✅ `/meridian status` returns current board summary
4. ✅ Invalid Slack signature returns 401
5. ✅ Command from unauthorized channel is ignored
6. ✅ Bot token never appears in logs or responses

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Slack app not yet created | High | Can't test end-to-end | Mock Slack API for tests; create real app when ready |
| Refinement takes >3s (Slack timeout) | High | User sees no response | Async ACK + postMessage pattern (FR3) |
| Agent fails to refine | Medium | Bad UX | Bot posts error with retry suggestion |

---

## AI Implementation Guidance

### Files to Create
- `slack-source.mjs` — Slack integration module
- `slack-handler.mjs` — command handlers (optional, can inline)

### Files to Modify
- `dashboard/server.mjs` — add `POST /api/slack/commands` endpoint
- `mos-dev/.ai/policy.yaml` — add `integrations.slack` config

### Key Dependencies
- No npm dependencies needed. Slack API is plain HTTPS + HMAC-SHA256 signing.
- Use Node.js built-in `crypto` for signature verification.

### Do NOT
- Use Slack's legacy RTM API (deprecated)
- Log the bot token or signing secret
- Make synchronous agent calls in the HTTP handler (always async ACK)

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
