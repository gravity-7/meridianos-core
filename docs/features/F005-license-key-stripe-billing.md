# F005 – License Key System & Stripe Billing

**Feature ID:** F005
**Area:** Gateway
**Wedge:** Governance Gateway (Wedge 1) — Revenue Engine
**Status:** Proposed
**Priority:** P1 — Revenue Critical
**Estimated Effort:** 2 days
**Assigned To:** builder (DeepSeek V4 Pro via gateway)
**Dependencies:** F002 (gateway published)
**Blocks:** Revenue generation (Month 1, Week 4)

---

## Business Context

### Problem
The gateway is functional, published to npm, and usable. But there is no way to charge for it. The `5.3 license+heartbeat` and `5.5 commercial license` items flagged by Claude in the plan amendments are the missing revenue engine. Without them, the gateway is freeware.

### Why This Matters
- **Revenue:** The plan targets first revenue in Week 4. Without Stripe integration and license validation, there's nothing to sell.
- **Self-serve:** Users should be able to go from "npx meridian-gateway" to "enter credit card" to "unlock pro features" without human intervention.
- **Heartbeat:** License validation prevents usage beyond the paid period. A weekly heartbeat checks license validity.

### Success Criteria
1. A user can sign up via Stripe Checkout and receive a license key
2. The gateway validates the license key at startup and periodically (heartbeat)
3. Expired/invalid licenses cause the gateway to run in degraded mode (Free tier limits)
4. Stripe webhooks handle subscription lifecycle (created, renewed, cancelled, expired)

---

## Functional Requirements

### FR1: Pricing Tiers
Three tiers defined:

| Tier | Price | Agents | Providers | Features |
|---|---|---|---|---|
| Free | $0 | 1 agent, 1 provider | DeepSeek only | Metering only, no enforcement |
| Pro | $99/mo | 10 agents, unlimited | All supported | Full enforcement, dashboard, key custody |
| Enterprise | Custom | Unlimited | All + custom | ADO/Slack/Jira connectors, SSO, priority support |

### FR2: License Key Generation
On successful Stripe payment, the system SHALL:
- Generate a cryptographically random license key (format: `mer-XXXX-XXXX-XXXX-XXXX`)
- Store the key with: tier, agent limit, provider limit, expiry date, customer email
- Return the key to the user (displayed once; also emailed)

### FR3: License Validation (Gateway Startup)
At gateway boot, the gateway SHALL:
- Read license key from `MERIDIAN_LICENSE_KEY` env var or `.ai/license.key` file
- Validate the key against the license store (local cache or API)
- If valid: enable features according to tier
- If invalid/expired: run in Free tier mode
- If missing: run in Free tier mode (unlicensed)

### FR4: Heartbeat (Periodic Validation)
Every 24 hours (plus at startup), the gateway SHALL:
- Re-validate the license key
- If subscription cancelled/expired: degrade to Free tier at next heartbeat
- If validation fails (network): use cached result for up to 7 days (offline grace period)
- Log heartbeat results to the ledger

### FR5: Stripe Integration
The system SHALL use Stripe Checkout for payment:
- Pre-built checkout page (no custom payment form needed)
- Webhook endpoint for subscription events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- License keys stored in a simple SQLite table (no external DB needed for v0.1)

### FR6: Degraded Mode
When license is invalid/expired/missing:
- Gateway boots normally but with Free tier limits
- Dashboard shows banner: "Unlicensed — upgrade to Pro"
- Enforcement is disabled (allow-all mode)
- Agent limit enforced: only 1 agent can register
- Provider limit enforced: only DeepSeek routes available

---

## Technical Requirements

### TR1: License Store
New SQLite table in the gateway ledger (or a separate `license.db`):
```sql
CREATE TABLE IF NOT EXISTS licenses (
  key TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'free',
  agent_limit INTEGER NOT NULL DEFAULT 1,
  provider_limit INTEGER NOT NULL DEFAULT 1,
  customer_email TEXT,
  stripe_subscription_id TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  cancelled_at TEXT,
  last_validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### TR2: License Module
New module: `license.mjs`
```js
export function generateLicenseKey() → string
export function validateLicense(key, store) → { valid, tier, agentLimit, providerLimit, expiresAt }
export function heartbeat(key, store) → { valid, changed }
export function createCheckoutSession({ tier, successUrl, cancelUrl }) → { url }
export function handleWebhook(event) → void
```

### TR3: Stripe Webhook
The dashboard server (or a new HTTP endpoint) SHALL handle:
```
POST /api/stripe/webhook
  Header: stripe-signature
  Body: raw JSON from Stripe
  → Verify signature with Stripe SDK secret
  → Process event type
  → Update license store
  → Return 200
```

### TR4: Environment Variables
```
MERIDIAN_LICENSE_KEY=mer-XXXX-XXXX-XXXX-XXXX   # license key
STRIPE_SECRET_KEY=sk_live_...                    # Stripe secret (server-side only)
STRIPE_WEBHOOK_SECRET=whsec_...                  # Stripe webhook signing secret
STRIPE_PRICE_PRO_MONTHLY=price_...               # Stripe price ID for Pro tier
```

### TR5: Graceful Degradation
When license validation fails (network error):
- Use last known valid state for up to 7 days
- After 7 days without successful validation: degrade to Free
- Log warning: "License validation failed for N days. Degrading in M days."

---

## Database Changes

Add `licenses` table to the gateway ledger schema (or separate `license.db` file). Migration handled by existing `openLedger`/`migrate` pattern.

---

## Security

- **License keys:** Cryptographically random (crypto.randomUUID-based with additional entropy). NOT derived from user data.
- **Stripe secrets:** Never committed, never in client-side code. Server-side only.
- **Webhook verification:** Stripe signature verification prevents spoofed webhooks.
- **No PII in ledger:** Customer email stored only in license table. Never mixed into token events.

---

## Testing

- Unit tests for `generateLicenseKey`, `validateLicense`, `heartbeat`
- Test with Stripe test mode keys
- Verify Free tier limits enforced
- Verify Pro tier features unlocked
- Verify expiry degradation
- Verify offline grace period

---

## Acceptance Criteria

1. ✅ `MERIDIAN_LICENSE_KEY=mer-XXX` enables Pro features on gateway boot
2. ✅ Missing/invalid key causes Free tier mode with dashboard banner
3. ✅ Stripe Checkout URL is generated correctly in test mode
4. ✅ Webhook `checkout.session.completed` creates license in store
5. ✅ Webhook `customer.subscription.deleted` marks license as cancelled
6. ✅ Heartbeat validates license and degrades after 7 days offline
7. ✅ Agent limit enforced: >1 agent registration fails in Free tier
8. ✅ Provider limit enforced: non-DeepSeek routes return 403 in Free tier

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stripe account not yet created | High | Can't test | Use Stripe test mode (no account needed for test keys) |
| License key sharing | Medium | Revenue loss | Heartbeat detects concurrent usage; warn but don't block in v0.1 |
| Offline grace period exploitable | Low | Minor revenue loss | 7-day window is standard; acceptable for v0.1 |

---

## AI Implementation Guidance

### Files to Create
- `license.mjs` — license generation, validation, heartbeat
- `gateway/license-store.mjs` — SQLite license table management

### Files to Modify
- `gateway/index.mjs` — read license at assembly time, pass tier limits to server
- `gateway/server.mjs` — enforce agent/provider limits based on tier
- `dashboard/server.mjs` — add Stripe webhook endpoint, checkout session endpoint
- `gateway/ledger-schema.sql` — add `licenses` table (or create separate `license-schema.sql`)

### Do NOT
- Use a third-party license management SaaS (keep it simple — SQLite is enough)
- Require internet for initial boot (offline grace period)
- Store raw Stripe API keys in the DB

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
