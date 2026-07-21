/**
 * quota-guard — pre-flight quota check for OAuth-based AI harnesses (Claude Code, Antigravity).
 *
 * PROBLEM: Claude Code and Antigravity authenticate via OAuth/keychain — no API key, no
 * redirectable base URL. The gateway CANNOT sit in this path, so it cannot meter or enforce
 * these harnesses. But the harnesses' local usage stores (~/.claude, ~/.gemini) ARE readable
 * and contain exact per-turn token counts.
 *
 * SOLUTION: Before launching any OAuth-based agent, read its local usage store, compute the
 * 5h trailing window, compare against founder-configured caps, and block the launch if
 * remaining quota is below `min_remaining_pct`. This prevents burning through a $20/mo
 * Claude Pro or Antigravity Pro subscription on autonomous agent work.
 *
 * The gateway ALREADY handles API-key providers (DeepSeek, OpenRouter) — inline metering,
 * budget enforcement, hard caps. This module is the COMPANION for OAuth harnesses that the
 * gateway structurally cannot intercept.
 *
 * INTEGRATION: Called by launcher.mjs's launchAgent() BEFORE spawn, same lifecycle point
 * where gateway injection is checked. A blocked launch returns `{ outcome: 'skipped',
 * reason: 'quota' }` — same shape as other pre-flight failures so the runner handles it
 * uniformly.
 *
 * CONFIGURATION (in .ai/policy.yaml):
 *   quota_guard:
 *     <agent>:
 *       harness: claude-code | antigravity
 *       cap_5h_tokens: <number>        # YOUR plan's effective 5h limit in billable tokens
 *       min_remaining_pct: <number>     # block if remaining < this %  (default: 50)
 */

import { homedir } from 'node:os';
import { claudeUsage } from './claude-usage.mjs';
import { antigravityUsage } from './antigravity-usage.mjs';

const H5 = 5 * 60 * 60 * 1000;

/**
 * Pre-flight check for ONE agent: reads local harness usage, compares against cap.
 *
 * @param {string} agent — the agent name (matches policy.quota_guard.<agent>)
 * @param {object} opts
 * @param {object} opts.policy — parsed policy.yaml (must have quota_guard section)
 * @param {number} [opts.now] — clock seam for testing (default: Date.now())
 * @returns {object} { agent, harness, used5h, cap5h, pctUsed, remainingPct, canLaunch, reason }
 *   canLaunch: true if no guard configured, or remaining >= min_remaining_pct
 *   reason: 'no-quota-guard-configured' | 'quota-below-threshold' | 'usage-read-failure' | 'ok'
 */
export function preFlightCheck(agent, { policy, now = Date.now() } = {}) {
  const guard = policy?.quota_guard?.[agent];
  if (!guard) {
    return { agent, canLaunch: true, reason: 'no-quota-guard-configured' };
  }

  const result = {
    agent,
    harness: guard.harness ?? 'unknown',
    used5h: null,
    cap5h: guard.cap_5h_tokens ?? null,
    pctUsed: null,
    remainingPct: null,
    canLaunch: false,
    reason: 'usage-read-failure',
    minRemainingPct: guard.min_remaining_pct ?? 50,
  };

  // ── Read local usage ──
  let usage = null;
  try {
    if (guard.harness === 'claude-code') {
      usage = claudeUsage({ home: homedir() });
    } else if (guard.harness === 'antigravity') {
      usage = antigravityUsage();
    }
  } catch {
    // usage-read-failure: can't determine usage → block launch (fail-safe)
    result.reason = 'usage-read-failure';
    return result;
  }

  if (!usage || usage.last5h == null) {
    result.reason = 'usage-read-failure';
    return result;
  }

  // ── Compute 5h window ──
  result.used5h = usage.last5h.billable ?? 0;

  // No cap configured → always allow (but log warning)
  if (result.cap5h === null || result.cap5h === 0) {
    result.canLaunch = true;
    result.reason = 'no-cap-configured';
    result.remainingPct = 100;
    return result;
  }

  // ── Compare against cap ──
  result.pctUsed = Math.round((result.used5h / result.cap5h) * 100);
  result.remainingPct = Math.max(0, 100 - result.pctUsed);
  result.canLaunch = result.remainingPct >= result.minRemainingPct;
  result.reason = result.canLaunch ? 'ok' : 'quota-below-threshold';

  return result;
}

/**
 * Batch check: run preFlightCheck for every agent in the roster that has a quota_guard entry.
 * Returns { allClear, results: [...], blocked: [...] }.
 */
export function preFlightCheckAll(agents, { policy, now } = {}) {
  const results = agents.map((agent) => preFlightCheck(agent, { policy, now }));
  const blocked = results.filter((r) => !r.canLaunch);
  return {
    allClear: blocked.length === 0,
    results,
    blocked,
  };
}

/**
 * Format a pre-flight result as a human-readable log line.
 */
export function formatCheckResult(r) {
  if (r.reason === 'no-quota-guard-configured') {
    return `quota-guard: ${r.agent} — no guard configured (launch allowed)`;
  }
  if (r.reason === 'no-cap-configured') {
    return `quota-guard: ${r.agent} — no cap set for ${r.harness} (launch allowed, used ${r.used5h?.toLocaleString() ?? '?'} tokens)`;
  }
  if (r.reason === 'usage-read-failure') {
    return `quota-guard: ${r.agent} — could not read ${r.harness} usage (BLOCKED — fail-safe)`;
  }
  if (r.reason === 'quota-below-threshold') {
    return `quota-guard: ${r.agent} — BLOCKED | ${r.used5h?.toLocaleString() ?? '?'}/${r.cap5h?.toLocaleString() ?? '?'} tokens (${r.pctUsed}% used, ${r.remainingPct}% remaining < ${r.minRemainingPct}% threshold) | ${r.harness}`;
  }
  // 'ok'
  return `quota-guard: ${r.agent} — OK | ${r.used5h?.toLocaleString() ?? '?'}/${r.cap5h?.toLocaleString() ?? '?'} tokens (${r.pctUsed}% used, ${r.remainingPct}% remaining) | ${r.harness}`;
}

/**
 * Compute a recommended cap for a harness based on plan tier.
 * These are CONSERVATIVE estimates — the founder should tune based on observed usage.
 *
 * @param {'claude-code'|'antigravity'} harness
 * @param {'pro'|'max-5x'|'max-20x'} [plan='pro']
 * @returns {number} recommended cap_5h_tokens
 */
export function recommendedCap(harness, plan = 'pro') {
  const caps = {
    'claude-code': {
      pro: 1_500_000,       // $20/mo — conservative; real limit may be higher
      'max-5x': 7_500_000,  // $100/mo — 5x Pro
      'max-20x': 30_000_000, // $200/mo — 20x Pro
    },
    antigravity: {
      pro: 1_000_000,       // $20/mo — Gemini models are efficient
      'max-5x': 5_000_000,
      'max-20x': 20_000_000,
    },
  };
  return caps[harness]?.[plan] ?? 500_000;
}

// ── Run as standalone diagnostic ──
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const agents = ['builder', 'reviewer', 'designer', 'docs-writer'];
  const policy = {
    quota_guard: {
      reviewer:    { harness: 'claude-code',   cap_5h_tokens: recommendedCap('claude-code', 'pro'), min_remaining_pct: 50 },
      designer:    { harness: 'antigravity',   cap_5h_tokens: recommendedCap('antigravity', 'pro'),   min_remaining_pct: 50 },
      'docs-writer': { harness: 'antigravity', cap_5h_tokens: recommendedCap('antigravity', 'pro'),   min_remaining_pct: 50 },
      // builder uses DeepSeek (API key, gateway-metered) — no quota guard needed
    },
  };

  const { allClear, results, blocked } = preFlightCheckAll(agents, { policy });
  console.log('=== QUOTA GUARD PRE-FLIGHT ===');
  for (const r of results) console.log(formatCheckResult(r));
  console.log(`\nAll clear: ${allClear}`);
  if (blocked.length > 0) {
    console.log(`Blocked agents: ${blocked.map(r => r.agent).join(', ')}`);
    console.log('These agents will be SKIPPED by the scheduler until quota recovers.');
  }
  console.log(`\nRecommended caps (Pro $20/mo):`);
  console.log(`  Claude Code:  ${recommendedCap('claude-code', 'pro').toLocaleString()} tokens/5h`);
  console.log(`  Antigravity:  ${recommendedCap('antigravity', 'pro').toLocaleString()} tokens/5h`);
}
