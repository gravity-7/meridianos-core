/**
 * usage-readers — post-hoc, provider-reported token usage for one completed run, generalized
 * across every harness behind a single interface:
 *
 *   readUsage(harness, run, result) → { inputTokens, outputTokens, totalTokens, provider, model }
 *                                      | null
 *
 * Mirrors the harness-adapters.mjs pattern: one small dispatcher keyed by harness name, each
 * reader wrapping an existing per-harness usage module so this file owns none of the parsing
 * itself. `run` is the same shape launcher.mjs's launchAgent builds it from: { agent, model,
 * task, session, provider, harness, worktreePath }, where `provider` is a resolved descriptor
 * from providers.mjs (so `run.provider.name` is the provider string, e.g. 'anthropic' |
 * 'deepseek' | 'openrouter') — the reader trusts this rather than re-guessing the provider from
 * a model string, since the launcher already knows exactly which provider it spawned against.
 * `result` (the harness's spawn result) is accepted for forward-compatibility with a future
 * harness whose CLI prints its own totals at exit; none of today's three readers use it.
 *
 * null means "genuinely unknown" — no transcript/session/db row found for this run yet, or the
 * harness doesn't expose usage at all. NEVER fabricated or estimated: callers (budget.mjs,
 * runlog.mjs) must treat null exactly like an absent legacy `tokens` field, not as zero spend.
 *
 * The optional 4th `overrides` argument on `readUsage` (and every reader below) is a test seam
 * only — `{ home, dirs, dbPath }` reach the same location-override knobs claude-usage.mjs /
 * antigravity-usage.mjs / opencode-usage.mjs already expose, so tests never touch a real
 * ~/.claude, ~/.gemini, or ~/.local/share/opencode. Production call sites omit it.
 *
 * `meterRun` (below `readUsage`) is the canonical-first entry point added on top of this module
 * (C4): when the cost-governance gateway is on, gateway/ledger.mjs's own append-only ledger is the
 * metering source of truth, and every reader above demotes to a fallback used only when the
 * gateway is off or the ledger has no matching event for this run. `readUsage` itself is untouched
 * — same signature, same behavior — so gateway-OFF callers of `readUsage` directly see zero change.
 */
import { findSessionTranscriptPath, readTranscript } from './claude-usage.mjs';
import { findConversationDbPath, readConversationUsage } from './antigravity-usage.mjs';
import { opencodeUsageForDirectory } from './opencode-usage.mjs';
import { queryWindow } from './gateway/ledger.mjs';

/**
 * claude-code — reads the session's own transcript, model-agnostically (no filter on
 * `message.model`): a claude-code run pointed at a third-party provider (DeepSeek via
 * ANTHROPIC_BASE_URL) writes the exact same transcript shape as a native-Anthropic run, just with
 * a different model string, so it's already counted correctly with zero special-casing.
 * `inputTokens` folds in cache-creation (fresh work), mirroring claude-usage.mjs's `billable`
 * definition exactly, so parity with the existing meter holds.
 */
function claudeCodeUsage(run, result, { home } = {}) {
  const path = findSessionTranscriptPath(run.session, home ? { home } : {});
  if (!path) return null;
  let input = 0, output = 0, cacheWrite = 0, model = null;
  for (const r of readTranscript(path)) {
    input += r.input; output += r.output; cacheWrite += r.cacheWrite;
    if (r.model && r.model !== 'unknown') model = r.model;
  }
  return {
    inputTokens: input + cacheWrite,
    outputTokens: output,
    totalTokens: input + cacheWrite + output,
    provider: run.provider?.name ?? null,
    model: model ?? run.model ?? null,
  };
}

/** antigravity — verbatim wrap of the existing protobuf decoder; no behavior change. */
function antigravityUsageFor(run, result, { dirs } = {}) {
  const path = findConversationDbPath(run.session, dirs ? { dirs } : {});
  if (!path) return null;
  let input = 0, output = 0, model = null;
  for (const g of readConversationUsage(path)) {
    input += g.inputFresh; output += g.outputTotal;
    if (g.model) model = g.model;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    provider: run.provider?.name ?? 'antigravity',
    model: model ?? run.model ?? null,
  };
}

/** opencode — matched by worktree directory (see opencode-usage.mjs for why). */
function opencodeUsageFor(run, result, { dbPath } = {}) {
  if (!run.worktreePath) return null;
  const u = opencodeUsageForDirectory(run.worktreePath, dbPath ? { dbPath } : {});
  if (!u) return null;
  return {
    inputTokens: u.input,
    outputTokens: u.output,
    totalTokens: u.billable,
    provider: u.providerID ?? run.provider?.name ?? null,
    model: u.model ?? run.model ?? null,
  };
}

const READERS = {
  'claude-code': claudeCodeUsage,
  antigravity: antigravityUsageFor,
  opencode: opencodeUsageFor,
};

/**
 * Dispatch to the reader for `harness`. An unrecognized harness (or one with no reader yet) is
 * "unknown" like any other unreadable run — return null rather than throw, since a harness
 * accounting gap must never crash the run it's trying to meter.
 */
export function readUsage(harness, run, result, overrides) {
  const reader = READERS[harness];
  if (!reader) return null;
  try { return reader(run, result, overrides); } catch { return null; }
}

/**
 * meterRun — canonical-first metering for one completed run (C4). When the cost-governance
 * gateway is ON, gateway/ledger.mjs's own append-only ledger is the metering source of truth;
 * the `readUsage` dispatcher above demotes to a FALLBACK used only when the gateway is off, or
 * when the ledger has no event matching this run. Purely additive: `readUsage` is called exactly
 * as it always was, so the fallback path is byte-identical to today's metering.
 *
 * Ledger match key: tenant (`config.gateway.registry.tenant`) + agent (`run.agent`) + the run's
 * own time window — `run.startedAt` / `run.endedAt`, both optional ISO-8601 strings forwarded
 * straight to `queryWindow`'s `since`/`until` (an absent bound is unbounded on that side, exactly
 * as `queryWindow` already defines it). Neither `run.startedAt` nor `run.endedAt` is wired into
 * any production caller yet — a run with neither simply queries the tenant+agent's entire ledger
 * history, which is a superset match, never a false negative.
 *
 * "Matching ledger event" is `queryWindow`'s own `runs > 0` — the same never-fabricate aggregate
 * budget.mjs/windows.mjs already trust, so this reuses that signal rather than re-deriving it.
 * Missing `tenant`/`agent`/`ledger` (nothing to match against) is treated identically to "no
 * match": fall through to the reader.
 *
 * Never guesses: if neither the ledger nor the reader has a number for this run, tokens/cost come
 * back as `0` — not fabricated as anything else — with `source` still naming which path was
 * consulted, so the caller (not this function) decides whether that zero means "genuinely zero
 * spend" or "totally unmetered."
 *
 * `overrides` is the same test seam `readUsage` exposes ( `{ home, dirs, dbPath }` ), forwarded
 * verbatim to the fallback reader; production call sites omit it.
 */
export function meterRun(run, result, { config, ledger, overrides } = {}) {
  const gatewayOn = config?.gateway?.enabled === true;
  if (gatewayOn && ledger) {
    const tenant = config.gateway.registry?.tenant;
    const agent = run?.agent;
    if (tenant && agent) {
      const w = queryWindow(ledger, { tenant, agent, since: run?.startedAt, until: run?.endedAt });
      if (w.runs > 0) {
        return { tokensIn: w.inputTokens, tokensOut: w.outputTokens, costUsd: w.costUsd, source: 'ledger' };
      }
    }
  }
  const usage = readUsage(run?.harness, run, result, overrides);
  return {
    tokensIn: usage?.inputTokens ?? 0,
    tokensOut: usage?.outputTokens ?? 0,
    costUsd: 0,
    source: 'usage-reader',
  };
}
