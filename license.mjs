/**
 * license — MeridianOS commercial license management.
 *
 * ZERO npm dependencies. All Stripe interactions use the REST API directly.
 * License keys are stored in a local SQLite table (ledger or standalone).
 *
 * TIERS:
 *   free    — $0, 1 agent, 1 provider (DeepSeek only), metering only, no enforcement
 *   pro     — $99/mo, 10 agents, unlimited providers, full enforcement, dashboard, key custody
 *   enterprise — custom, unlimited everything, ADO/Slack/Jira connectors, SSO, priority support
 *
 * FLOW:
 *   1. User clicks "Upgrade" → Stripe Checkout → pays
 *   2. Stripe webhook → license key generated + stored
 *   3. Gateway reads MERIDIAN_LICENSE_KEY env var → validates → enforces tier limits
 *   4. Heartbeat every 24h re-validates → degrades to Free if expired/cancelled
 *   5. Offline grace period: 7 days without successful validation before degradation
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ═══════════════════════════════════════════════════════════════
// License store (SQLite)
// ═══════════════════════════════════════════════════════════════

const LICENSE_SCHEMA = `
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
`;

/**
 * Open (creating if needed) the license store.
 * @param {string} [path] — file path; defaults to '.ai/license.db'
 */
export function openLicenseStore(path) {
  const dbPath = path || '.ai/license.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(LICENSE_SCHEMA);
  return db;
}

/** Look up a license key. Returns null if not found. */
export function getLicense(db, key) {
  try {
    return db.prepare('SELECT * FROM licenses WHERE key = ?').get(key) || null;
  } catch { return null; }
}

/** Insert or update a license record. */
export function upsertLicense(db, record) {
  const existing = getLicense(db, record.key);
  if (existing) {
    db.prepare(`UPDATE licenses SET tier=?, agent_limit=?, provider_limit=?, customer_email=?,
      stripe_subscription_id=?, expires_at=?, cancelled_at=?, last_validated_at=?
      WHERE key=?`).run(
      record.tier, record.agent_limit, record.provider_limit, record.customer_email,
      record.stripe_subscription_id, record.expires_at, record.cancelled_at,
      record.last_validated_at, record.key,
    );
  } else {
    db.prepare(`INSERT INTO licenses(key, tier, agent_limit, provider_limit, customer_email,
      stripe_subscription_id, issued_at, expires_at, cancelled_at, last_validated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      record.key, record.tier, record.agent_limit, record.provider_limit,
      record.customer_email, record.stripe_subscription_id, record.issued_at || new Date().toISOString(),
      record.expires_at, record.cancelled_at, record.last_validated_at,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// License key generation
// ═══════════════════════════════════════════════════════════════

/** Generate a MeridianOS license key: mer-XXXX-XXXX-XXXX-XXXX */
export function generateLicenseKey() {
  const bytes = randomBytes(9); // 9 bytes → 12 base32-ish chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let key = 'mer-';
  for (let i = 0; i < 12; i++) {
    key += chars[bytes[Math.floor(i * 9 / 12)] % chars.length];
    if ((i + 1) % 4 === 0 && i < 11) key += '-';
  }
  return key;
}

/**
 * Create a new license record in the store.
 * @returns {{ key: string, tier: string }}
 */
export function createLicense(db, { key, tier = 'free', customer_email, stripe_subscription_id, expires_at } = {}) {
  const TIER_CONFIG = {
    free:       { agent_limit: 1,  provider_limit: 1 },
    pro:        { agent_limit: 10, provider_limit: 999 },
    enterprise: { agent_limit: 999, provider_limit: 999 },
  };
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.free;
  const licenseKey = key || generateLicenseKey();
  upsertLicense(db, {
    key: licenseKey, tier,
    agent_limit: cfg.agent_limit, provider_limit: cfg.provider_limit,
    customer_email: customer_email || null,
    stripe_subscription_id: stripe_subscription_id || null,
    issued_at: new Date().toISOString(),
    expires_at: expires_at || null,
    cancelled_at: null,
    last_validated_at: new Date().toISOString(),
  });
  return { key: licenseKey, tier, agent_limit: cfg.agent_limit, provider_limit: cfg.provider_limit };
}

// ═══════════════════════════════════════════════════════════════
// License validation
// ═══════════════════════════════════════════════════════════════

const OFFLINE_GRACE_DAYS = 7;

/**
 * Validate a license key against the store.
 * @returns {{ valid: boolean, tier: string, agentLimit: number, providerLimit: number, reason?: string }}
 */
export function validateLicense(db, key) {
  if (!key) return { valid: false, tier: 'free', agentLimit: 1, providerLimit: 1, reason: 'no-key' };

  const record = getLicense(db, key);
  if (!record) return { valid: false, tier: 'free', agentLimit: 1, providerLimit: 1, reason: 'not-found' };

  // Check cancellation
  if (record.cancelled_at) {
    return { valid: false, tier: 'free', agentLimit: 1, providerLimit: 1, reason: 'cancelled' };
  }

  // Check expiry
  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    return { valid: false, tier: 'free', agentLimit: 1, providerLimit: 1, reason: 'expired' };
  }

  return {
    valid: true,
    tier: record.tier,
    agentLimit: record.agent_limit,
    providerLimit: record.provider_limit,
    customerEmail: record.customer_email,
  };
}

/**
 * Heartbeat: re-validate the license. Called at startup + every 24h.
 * On network failure, uses cached last_validated_at with 7-day grace period.
 * @returns {{ valid: boolean, tier: string, agentLimit: number, providerLimit: number, degraded: boolean }}
 */
export function heartbeat(db, key, { now = new Date().toISOString() } = {}) {
  // Local validation first (no network needed)
  const localResult = validateLicense(db, key);

  // Update last_validated_at
  try {
    db.prepare('UPDATE licenses SET last_validated_at = ? WHERE key = ?').run(now, key);
  } catch { /* best-effort */ }

  // Check offline grace period
  if (!localResult.valid) {
    const record = getLicense(db, key);
    if (record && record.last_validated_at) {
      const lastValid = new Date(record.last_validated_at);
      const daysSince = (new Date(now) - lastValid) / (24 * 60 * 60 * 1000);
      if (daysSince <= OFFLINE_GRACE_DAYS && record.tier !== 'free') {
        // Still within grace period — use last known good state
        return {
          valid: true, tier: record.tier,
          agentLimit: record.agent_limit, providerLimit: record.provider_limit,
          degraded: true, reason: `offline-grace-${Math.floor(daysSince)}d`,
        };
      }
    }
  }

  return { ...localResult, degraded: false };
}

// ═══════════════════════════════════════════════════════════════
// Stripe integration (zero-dependency REST API)
// ═══════════════════════════════════════════════════════════════

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * Create a Stripe Checkout session.
 * @param {string} secretKey — Stripe secret key (sk_live_... or sk_test_...)
 * @param {string} priceId — Stripe Price ID for the tier
 * @param {string} successUrl — redirect after payment
 * @param {string} cancelUrl — redirect on cancel
 */
export async function createCheckoutSession({ secretKey, priceId, successUrl, cancelUrl }) {
  const body = new URLSearchParams({
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode: 'subscription',
    'success_url': successUrl,
    'cancel_url': cancelUrl,
  });

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe error (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Verify a Stripe webhook signature.
 * Uses the Stripe signature scheme: HMAC-SHA256 of timestamp.body with webhook secret.
 * Zero dependencies — uses Node.js built-in crypto.
 */
export function verifyStripeSignature({ payload, signature, secret, tolerance = 300 }) {
  try {
    // Stripe signature format: t=timestamp,v1=signature[,v1=signature]...
    const parts = {};
    for (const part of signature.split(',')) {
      const [k, v] = part.split('=');
      parts[k] = v;
    }
    const timestamp = parseInt(parts.t, 10);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > tolerance) return false;

    const { createHmac } = await_import_crypto();
    const signedPayload = `${timestamp}.${payload}`;
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

    // Compare against all provided signatures (v1 scheme)
    const sigs = signature.match(/v1=([a-f0-9]+)/g) || [];
    return sigs.some(s => {
      const sigVal = s.slice(3); // strip "v1="
      try { return crypto.timingSafeEqual(Buffer.from(sigVal), Buffer.from(expected)); } catch { return false; }
    });
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════
// Tier enforcement helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Check if an agent registration is allowed under the current tier.
 */
export function canRegisterAgent(license, agentCount) {
  return agentCount < (license.agentLimit || 1);
}

/**
 * Check if a provider is allowed under the current tier.
 */
export function canUseProvider(license, provider) {
  // Free tier: only DeepSeek
  if (license.tier === 'free' && provider !== 'deepseek') return false;
  return true;
}

/**
 * Check if enforcement (deny on over-budget) is allowed under this tier.
 * Free tier: metering only, no enforcement.
 */
export function canEnforce(license) {
  return license.tier !== 'free';
}

// Lazy async import helper
async function await_import_crypto() {
  return import('node:crypto');
}

// Standalone diagnostic
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const db = openLicenseStore(':memory:');
  const lic = createLicense(db, { tier: 'pro', customer_email: 'test@meridianos.dev' });
  console.log('Generated license:', lic);
  const result = validateLicense(db, lic.key);
  console.log('Validation:', result);
  const hb = heartbeat(db, lic.key);
  console.log('Heartbeat:', hb);
  db.close();
}
