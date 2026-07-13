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
 */
import { findSessionTranscriptPath, readTranscript } from './claude-usage.mjs';
import { findConversationDbPath, readConversationUsage } from './antigravity-usage.mjs';
import { opencodeUsageForDirectory } from './opencode-usage.mjs';

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
