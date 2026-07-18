/**
 * exit-classify — the ONE place that turns a spawned agent's exit into a typed reason.
 *
 * Before this module, scheduling logic grepped English out of free-text notes in two different
 * places (`launcher` built the note, `watchdog` re-parsed it with `note.includes("session limit")`).
 * That is architecture weakness A3 in the postmortem: any wording change silently re-opened the
 * session-limit crash loop. Now the launcher classifies ONCE into a stable `reason` enum and a
 * structured `resetAt`, both persisted on the run record; every consumer keys on the enum, never
 * on the prose.
 *
 * reason ∈ 'ok' | 'quota' | 'budget' | 'timeout' | 'signal' | 'spawn_error' | 'nonzero'
 *   quota  → the PROVIDER refused because a session/usage window is exhausted (Anthropic:
 *            "You've hit your session limit"; Antigravity: quota/rate wording). resetAt is the
 *            wall-clock the window reopens, when the provider prints it. Retrying later succeeds.
 *   budget → OUR OWN gateway sidecar refused the call (gateway/server.mjs's non-retryable 403,
 *            see PR #29) because this agent is over its policy.yaml cap. Deliberately a SEPARATE
 *            reason from 'quota': a quota window reopens on its own (resetInstant/cooldown apply);
 *            a budget halt does NOT clear within the run — retrying is never correct, and
 *            runner.mjs's quotaHold must never treat the two as interchangeable. Also deliberately
 *            separate from the generic 'nonzero' catch-all: a budget deny is an EXPECTED,
 *            governance-driven exit (the run did exactly what #29 designed it to do), not a crash
 *            — collapsing it into 'nonzero' would make it indistinguishable from a real bug in the
 *            run log / dashboard.
 */

/** Provider fingerprints for an exhausted quota window. Add new wordings HERE, nowhere else. */
const QUOTA_PATTERNS = [
  /you've hit your session limit/i,
  /\bsession limit\b/i,
  /\busage limit\b/i,
  /rate limit(?:ed)?\b.*\bretry\b/i,
  /quota (?:exceeded|exhausted)/i,
  /\b429\b.*\b(quota|rate|limit)\b/i,
];

/** Fingerprint for OUR OWN gateway's budget-deny message (gateway/server.mjs's `denyBody`:
 *  `gateway: over budget (${capWindow})`, on both the anthropic and openai wire shapes). This is a
 *  literal string WE control (not a provider's own wording), so it's a precise, low-risk match —
 *  unlike QUOTA_PATTERNS's provider-wording heuristics, this can't collide with a real provider
 *  error. Empirically confirmed (offline, real `claude` CLI spawn against a local denying gateway,
 *  2026-07-18): claude-code surfaces the gateway's message verbatim as
 *  "Failed to authenticate. API Error: 403 gateway: over budget (5h)" on stdout. */
const BUDGET_PATTERNS = [
  /gateway:\s*over budget/i,
];

/** Is this output OUR OWN gateway's budget-deny refusal (PR #29's non-retryable 403)? */
export function isBudgetText(text) {
  const s = String(text ?? '');
  return BUDGET_PATTERNS.some((re) => re.test(s));
}

/** Pull a human reset time ("resets 6:20pm", "resets at 11:40pm (Asia/Karachi)") if present. */
export function parseResetAt(text) {
  const m = String(text ?? '').match(/resets(?:\s+at)?\s+([\d:]+\s*(?:am|pm)?)/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}

/** Cap how long a quota gate will wait on a parsed reset — a session window never exceeds ~5h,
 *  so we never wedge an agent for a mis-parsed "tomorrow". */
export const MAX_QUOTA_WAIT_MS = 5 * 60 * 60 * 1000;

/**
 * Turn a human reset string ("6:20pm", "11:40pm", "06:20") into an absolute epoch-ms instant:
 * the NEXT local occurrence of that clock time at/after `nowMs`, clamped to MAX_QUOTA_WAIT_MS
 * ahead so a stale "pm" can't park an agent for a whole day. Returns null if unparseable — the
 * caller then falls back to a fixed cooldown, never to "block forever".
 */
export function resetInstant(resetStr, nowMs = Date.now()) {
  if (!resetStr) return null;
  const m = String(resetStr).match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = parseInt(m[2], 10);
  const mer = m[3]?.toLowerCase();
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date(nowMs);
  d.setHours(h, min, 0, 0);
  let ms = d.getTime();
  if (ms <= nowMs) ms += 24 * 60 * 60 * 1000; // next occurrence
  return Math.min(ms, nowMs + MAX_QUOTA_WAIT_MS);
}

/** Is this output a provider quota/session-limit refusal? */
export function isQuotaText(text) {
  const s = String(text ?? '');
  return QUOTA_PATTERNS.some((re) => re.test(s));
}

/**
 * Classify a completed spawn. Inputs mirror child_process 'close' plus the captured streams.
 * @returns {{ reason: string, outcome: 'ok'|'failed', note: string, resetAt: string|null }}
 */
export function classifyExit({ code, signal, stdout = '', stderr = '', timedOut = false, spawnError = null } = {}) {
  if (spawnError) return { reason: 'spawn_error', outcome: 'failed', note: `spawn error: ${spawnError}`, resetAt: null };
  if (timedOut) return { reason: 'timeout', outcome: 'failed', note: 'timeout — process tree killed', resetAt: null };

  // Headless agents print their error to STDOUT, not stderr — check both.
  const blob = `${stderr}\n${stdout}`;
  if (isQuotaText(blob)) {
    const resetAt = parseResetAt(blob);
    return { reason: 'quota', outcome: 'failed', note: `quota exhausted${resetAt ? ` · resets ${resetAt}` : ''}`, resetAt };
  }
  // Checked AFTER quota (no pattern overlap either way) and BEFORE the generic nonzero fallback —
  // a gateway budget halt (#29) is a distinct, expected, governance-driven exit, not a crash.
  if (isBudgetText(blob)) {
    return { reason: 'budget', outcome: 'failed', note: 'gateway budget halt (non-retryable deny, #29)', resetAt: null };
  }
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    return { reason: 'signal', outcome: 'failed', note: `killed by signal ${signal}`, resetAt: null };
  }
  if (code === 0) return { reason: 'ok', outcome: 'ok', note: 'completed', resetAt: null };

  const errText = (String(stderr).trim() || String(stdout).trim()).slice(-400);
  return { reason: 'nonzero', outcome: 'failed', note: `exit ${code}: ${errText || '(no output)'}`, resetAt: null };
}
