/**
 * budget — the unified compute-budget ledger. UNIFORM and roster-driven (§1.4 simplification):
 * every agent in `config.domain.agents` gets the SAME shape of verdict — a plain 5h + weekly
 * window, compared against the caps in .ai/policy.yaml — regardless of how many agents/providers
 * the tenant runs or which local store their usage lives in. Answers the operational question the
 * watchdog needs: "may this agent claim new work right now?"
 *
 * Each agent's usage is read by a per-agent METER_READER (transcript or protobuf today; see
 * `config.domain.budgetMeter`), so a tenant with N agents on N different local stores still gets
 * one loop, one output shape, no special-cased branches. (Antigravity previously split Gemini vs
 * Claude/GPT usage into separate quota "pools" with a `gating_pool` — that multi-pool machinery
 * was dropped in §1.4; every agent is single-pool now. `policy.agent_budget.antigravity.pools` is
 * inert if still present in policy.yaml.)
 *
 * States per agent: ok → warn (>= warn_pct of a cap) → halt (>= a cap). halt or kill_switch
 * ⇒ no new claims (a task already in flight still finishes). The founder owns policy.yaml.
 *
 * ATTRIBUTION (`agent_budget.attribution`): `total` counts every local session — the founder's
 * own interactive work AND agent runs (this over-counts, and can HALT an agent on the founder's
 * usage). `agent_only` counts just agent-initiated sessions: we harvest the set of session ids the
 * runner launched from the run log (`.ai/runs/log.jsonl`) and pass it to the meters, which key on
 * each transcript/conversation filename (= its session id). No agent runs logged yet ⇒ zero agent
 * usage ⇒ the founder's usage never gates the agents.
 *
 * THIRD-PARTY / OPENCODE USAGE (1.6): claudeUsage()/antigravityUsage() only see what lands in
 * ~/.claude or ~/.gemini — which already covers a claude-code run pointed at a third-party
 * provider (DeepSeek via ANTHROPIC_BASE_URL still writes an ordinary claude-code transcript, read
 * model-agnostically). The one harness with its OWN separate local store is opencode — its usage
 * is invisible to both meters. `nonTranscriptUsage` adds that back in per agent, from the run
 * log's own post-hoc capture (usage-readers.mjs, populated by launcher.mjs), so opencode spend
 * actually moves that agent's ok/warn/halt needle. `providerBreakdown` is the separate, purely
 * additive, read-only "spend split by provider" view for the dashboard — every logged run already
 * carries its resolved `provider` + captured `usage`/`tokens`, regardless of harness. Since 1.8 it
 * also carries USD cost (pricing.mjs) alongside tokens, priced off the run's own `usage.model` —
 * a run with no price entry (or only the legacy tokens-only field, with no input/output split)
 * counts toward `costUnknownRuns` rather than a fabricated $0.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createAios } from './config.mjs';
import { claudeUsage } from './claude-usage.mjs';
import { antigravityUsage } from './antigravity-usage.mjs';
import { readRuns } from './runlog.mjs';
import { parseYaml } from './yaml-lite.mjs';
import { costFor, loadPricing } from './pricing.mjs';
import { openLedger, queryWindow, listEvents } from './gateway/ledger.mjs';

/** `config` is the injected AiosConfig (REQUIRED); it only matters when `path` itself is
 *  omitted. */
export function loadPolicy(path = undefined, config) {
  const p = path ?? config.policyPath;
  try { return parseYaml(readFileSync(p, 'utf8')); } catch { return {}; }
}

/** Compare one agent's window usage to its caps → { state, windows[] }. */
export function verdictFor(usage, caps, warnPct) {
  const rows = [
    { window: '5h', used: usage.last5h.billable, cap: caps?.per_5h_tokens ?? null },
    { window: 'week', used: usage.last7d.billable, cap: caps?.per_week_tokens ?? null },
  ];
  let state = 'ok';
  const windows = rows.map((r) => {
    if (!r.cap) return { ...r, pct: null, state: 'no-cap' };
    const pct = Math.round((r.used / r.cap) * 100);
    const s = r.used >= r.cap ? 'halt' : (pct >= warnPct ? 'warn' : 'ok');
    if (s === 'halt') state = 'halt';
    else if (s === 'warn' && state !== 'halt') state = 'warn';
    return { ...r, pct, state: s };
  });
  return { state, windows };
}

/**
 * The set of session ids a given agent launched, harvested from the run log. This is the join key
 * that separates agent-initiated usage from the founder's own interactive sessions: the runner
 * records one run per launch with the `session` it spawned the agent under (Claude via
 * `--session-id`, Antigravity as the conversation id), which the meters match on the transcript /
 * conversation filename.
 */
export function agentSessionIds(runs, agent) {
  const ids = new Set();
  for (const r of runs) if (r && r.agent === agent && r.session) ids.add(r.session);
  return ids;
}

/** Sum two meter windows field-by-field (agent + founder ⇒ what attribution `total` gates on). */
const addWindow = (a = {}, b = {}) => {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] ?? 0) + b[k];
  return out;
};
const combineUsage = (u, f) => (!f ? u : {
  last5h: addWindow(u.last5h, f.last5h),
  last7d: addWindow(u.last7d, f.last7d),
  total: addWindow(u.total, f.total),
  noTimestamp: u.noTimestamp, // single counter in the meters — never split
});

const H5 = 5 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

// Harnesses claudeUsage()/antigravityUsage() already see by reading the transcript/conversation
// store directly (any model/provider — see the file doc comment). Anything else (today: only
// opencode) needs its usage added back in from the run log.
const TRANSCRIPT_COVERED_HARNESSES = new Set(['claude-code', 'antigravity']);

/**
 * Sum the tokens of runs `agent` launched through a non-transcript-covered harness, bucketed into
 * the SAME 5h/week windows the transcript meter used (so the two sources stay on one clock). Reads
 * only the run log's own post-hoc `usage` capture — never re-derives it — and a run with no usage
 * recorded (older log line, or a genuinely-unknown reader result) contributes nothing to any
 * window: unknown stays unknown, never fabricated as zero or double-counted.
 */
export function nonTranscriptUsage(runs, { agent, now = Date.now(), start5h = now - H5, startWeek = now - WEEK } = {}) {
  const win = () => ({ input: 0, output: 0, billable: 0, runs: 0 });
  const last5h = win(), last7d = win(), total = win();
  const add = (w, u) => { w.input += u.inputTokens ?? 0; w.output += u.outputTokens ?? 0; w.billable += u.totalTokens; w.runs++; };
  for (const r of runs ?? []) {
    if (!r || r.agent !== agent || !r.harness || TRANSCRIPT_COVERED_HARNESSES.has(r.harness)) continue;
    const u = r.usage;
    if (!u || typeof u.totalTokens !== 'number') continue; // unknown — never fabricated
    add(total, u);
    const ts = r.ts ? Date.parse(r.ts) : null;
    if (ts == null || ts > now) continue;
    if (ts >= start5h) add(last5h, u);
    if (ts >= startWeek) add(last7d, u);
  }
  return { last5h, last7d, total };
}

/** Fold a `nonTranscriptUsage` result into a gated usage object, field-by-field, per window. */
function mergeExtra(usage, extra) {
  const fold = (w, e) => ({ ...w, input: (w.input ?? 0) + e.input, output: (w.output ?? 0) + e.output, billable: w.billable + e.billable });
  return { ...usage, last5h: fold(usage.last5h, extra.last5h), last7d: fold(usage.last7d, extra.last7d), total: fold(usage.total, extra.total) };
}

/**
 * Read-only per-provider spend breakdown across every logged run in a window — "here's your
 * spend, split by provider," the dashboard view this whole feature exists to surface. Sourced
 * straight from the run log's `provider` field (recorded at decide-time, 1.4) and its post-hoc
 * `usage.totalTokens` (preferred) or legacy `tokens` (older log lines). A run with neither is
 * counted under the `unknown` bucket rather than silently dropped, so the founder can see the
 * coverage gap instead of an undercount that looks like zero spend.
 *
 * `cost` (USD, 1.8) mirrors that same never-fabricate rule: it only prices a run when `usage`
 * carries a model plus numeric input/output tokens AND the catalog has a price for that exact
 * provider+model — a legacy tokens-only run, or a model with no catalog entry, counts toward
 * `costUnknownRuns` instead of silently costing $0.
 */
export function providerBreakdown(runs, { config, now = Date.now(), sinceMs = null, pricing = loadPricing(undefined, config) } = {}) {
  const out = {};
  for (const r of runs ?? []) {
    if (!r) continue;
    const ts = r.ts ? Date.parse(r.ts) : null;
    if (sinceMs != null && (ts == null || ts < sinceMs || ts > now)) continue;
    const key = r.provider ?? 'unknown';
    const tokens = typeof r.usage?.totalTokens === 'number' ? r.usage.totalTokens : (typeof r.tokens === 'number' ? r.tokens : null);
    const bucket = out[key] ?? (out[key] = { billable: 0, runs: 0, unknownRuns: 0, cost: 0, costUnknownRuns: 0 });
    bucket.runs++;
    if (tokens == null) bucket.unknownRuns++;
    else bucket.billable += tokens;

    const model = r.usage?.model ?? null;
    const priceable = model && typeof r.usage?.inputTokens === 'number' && typeof r.usage?.outputTokens === 'number';
    const cost = priceable ? costFor(key, model, r.usage, { catalog: pricing }) : null;
    if (cost) bucket.cost += cost.totalCost;
    else bucket.costUnknownRuns++;
  }
  return out;
}

// Per-agent meter reader registry (§1.4 budget simplification): every roster agent gets a plain
// 5h+weekly verdict, sourced from whichever local usage store the tenant's DomainPlugin says to
// read for it (`config.domain.budgetMeter[agent]`, default 'transcript' — see config.mjs). Both
// readers already return the SAME aggregate shape when called with no `pools` argument
// ({last5h, last7d, total, founder, fiveHourSession, noTimestamp}), which is what makes one
// uniform loop possible instead of a hardcoded claude/antigravity branch pair.
const METER_READERS = {
  transcript: { fn: claudeUsage, dirKey: 'dir' },
  protobuf: { fn: antigravityUsage, dirKey: 'dirs' },
};

/**
 * ledgerWindowUsage (C9) — one agent's 5h/week window usage sourced from the gateway's own
 * token-event ledger (gateway/ledger.mjs's `queryWindow`), the canonical record when the
 * cost-governance gateway is on. Computed over the EXACT SAME window boundaries budgetStatus
 * already anchors every agent to — `weekStartMs` is the SAME `weekWindow(agent)` result the
 * transcript path uses (plan-week anchor, else rolling trailing-7d), and the 5h boundary is
 * either a rolling trailing-5h OR — when `session5h` is on — an activity-anchored session computed
 * from the ledger's OWN event timestamps, mirroring claude-usage.mjs's `session5h` algorithm
 * exactly so the two metering paths can never disagree about what "the current window" means.
 *
 * No founder split: unlike the transcript/protobuf meters (which see EVERY local session,
 * founder-interactive or agent-launched, and need `agentSessions` to tell them apart), the ledger
 * only ever contains gateway-PROXIED calls already tagged with the requesting agent — there is no
 * founder-usage bleed to separate out, so `attribution` (total vs agent_only) is a no-op here.
 *
 * Never fabricates: `queryWindow`'s own never-fabricate aggregate is used verbatim — an agent/
 * window with zero matching ledger rows correctly reports 0 usage (a real "no spend"), not
 * "unknown". Never throws: `queryWindow` already swallows its own query errors into a zeroed
 * aggregate, and `listEvents` (used only for `session5h` anchoring) does the same.
 */
export function ledgerWindowUsage(ledger, { tenant, agent, now = Date.now(), weekStartMs = null, session5h = false } = {}) {
  const nowIso = new Date(now).toISOString();
  const startWeekMs = weekStartMs ?? (now - WEEK);

  let start5hMs = now - H5;
  let fiveHourSession = null;
  if (session5h) {
    const stamped = listEvents(ledger, { tenant, agent, limit: 1_000_000 })
      .map((e) => (e?.ts ? Date.parse(e.ts) : null))
      .filter((ts) => ts != null && ts <= now)
      .sort((a, b) => a - b);
    let ws = null;
    for (const ts of stamped) if (ws == null || ts >= ws + H5) ws = ts;
    const active = ws != null && now < ws + H5;
    start5hMs = active ? ws : Infinity;
    fiveHourSession = { start: active ? ws : null, resetAt: active ? ws + H5 : null };
  }

  const w5 = Number.isFinite(start5hMs)
    ? queryWindow(ledger, { tenant, agent, since: new Date(start5hMs).toISOString(), until: nowIso })
    : null;
  const wWeek = queryWindow(ledger, { tenant, agent, since: new Date(startWeekMs).toISOString(), until: nowIso });
  const wTotal = queryWindow(ledger, { tenant, agent });

  const toWindow = (agg) => (agg
    ? { input: agg.inputTokens, output: agg.outputTokens, billable: agg.totalTokens }
    : { input: 0, output: 0, billable: 0 });

  return { last5h: toWindow(w5), last7d: toWindow(wWeek), total: toWindow(wTotal), noTimestamp: 0, founder: null, fiveHourSession };
}

export function budgetStatus({ config, policy = loadPolicy(undefined, config), now = Date.now(), agentDirs = {}, runs, runsPath = undefined, pricing = loadPricing(undefined, config), ledger: ledgerOverride = undefined } = {}) {
  const warnPct = policy?.agent_budget?.warn_pct ?? 80;
  const killed = policy?.kill_switch === true;
  // Anything other than the explicit `agent_only` keeps today's behaviour: count every session.
  const attribution = policy?.agent_budget?.attribution === 'agent_only' ? 'agent_only' : 'total';

  // Window anchoring to each plan's real quota cycles (founder-set, .ai/policy.yaml):
  //  - <agent>.week_anchor: ISO instant of ANY known weekly reset for THAT platform (different
  //    agents can recycle on different clocks); boundaries recur every 7d from it, and the week
  //    window counts usage since the latest boundary ≤ now. A top-level week_anchor is honoured
  //    as a fallback for any agent. Absent ⇒ rolling trailing-7d (more conservative near a reset).
  //  - five_hour_sessions: true ⇒ activity-anchored 5h sessions derived from the records
  //    themselves (first activity starts a window, it empties 5h later) — self-calibrating,
  //    no timestamp needed. Absent/false ⇒ rolling trailing-5h.
  const weekWindow = (agent) => {
    const anchor = Date.parse(policy?.agent_budget?.[agent]?.week_anchor ?? policy?.agent_budget?.week_anchor ?? '');
    if (!Number.isFinite(anchor)) return { startMs: null, resetAt: null };
    const startMs = anchor + Math.floor((now - anchor) / WEEK) * WEEK;
    return { startMs, resetAt: startMs + WEEK };
  };
  const session5h = policy?.agent_budget?.five_hour_sessions === true;

  // The run log's session ids split every meter pass into agent vs founder usage. The split runs
  // regardless of attribution: the founder gauges are read-only stats on the dashboard, while the
  // lever only decides which side gates the agents. Whole run log ⇒ no in-window run is missed.
  const runList = runs ?? readRuns({ path: runsPath, limit: 0, config });

  // Gating usage per the lever: agent_only ⇒ agent sessions alone; total ⇒ founder + agent.
  const view = ({ last5h, last7d, total, noTimestamp }) => ({ last5h, last7d, total, noTimestamp });
  const gate = (u) => (attribution === 'agent_only' ? view(u) : combineUsage(view(u), u.founder));
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

  const roster = config.domain.agents ?? [];
  const out = {};
  const resets = {};
  const mayClaim = {};

  // C9: ledger-canonical budget windows. Byte-identical to pre-C9 when the gateway is off/absent
  // (AC6) — `ledger` stays null and every agent falls straight into the existing meter-reader path
  // below, unchanged. When `config.gateway.enabled === true` (AC5), the gateway's own token-event
  // ledger becomes the source of truth for window usage: it's opened ONCE here (an explicit
  // `ledger` override — the test seam — skips the open entirely), and a failure to open/resolve it
  // (missing tenant, or the open itself throwing) degrades to the existing path rather than
  // crashing budgetStatus, exactly like every other never-fabricate guard in this file.
  const gatewayOn = config?.gateway?.enabled === true;
  const gatewayTenant = config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? null;
  let ledger = null;
  if (gatewayOn && gatewayTenant) {
    try { ledger = ledgerOverride ?? openLedger(config.gateway.ledgerPath, { config }); } catch { ledger = null; }
  }

  for (const agent of roster) {
    const week = weekWindow(agent);

    if (ledger) {
      const lu = ledgerWindowUsage(ledger, { tenant: gatewayTenant, agent, now, weekStartMs: week.startMs, session5h });
      out[agent] = { usage: lu, founder: null, source: 'ledger', ...verdictFor(lu, policy?.agent_budget?.[agent], warnPct) };
      mayClaim[agent] = !killed && out[agent].state !== 'halt';
      resets[`${agent}_week_at`] = iso(week.resetAt);
      resets[`${agent}_5h_at`] = iso(lu.fiveHourSession?.resetAt);
      continue;
    }

    const sessions = agentSessionIds(runList, agent);
    const kind = config.domain.budgetMeter?.[agent] ?? 'transcript';
    const reader = METER_READERS[kind] ?? METER_READERS.transcript;
    const dirOverride = agentDirs[agent];
    const usage = reader.fn({ ...(dirOverride ? { [reader.dirKey]: dirOverride } : {}), now, agentSessions: sessions, splitFounder: true, weekStartMs: week.startMs, session5h });
    // Opencode runs this agent launched carry usage the transcript/protobuf meter above never
    // sees (opencode has its own store) — fold them into the SAME windows before gating on a cap.
    const extra = nonTranscriptUsage(runList, { agent, now, start5h: usage.fiveHourSession?.start ?? (now - H5), startWeek: week.startMs ?? (now - WEEK) });
    const withExtra = mergeExtra(gate(usage), extra);
    out[agent] = { usage: withExtra, founder: usage.founder, source: 'meter', ...verdictFor(withExtra, policy?.agent_budget?.[agent], warnPct) };
    mayClaim[agent] = !killed && out[agent].state !== 'halt';
    resets[`${agent}_week_at`] = iso(week.resetAt);
    resets[`${agent}_5h_at`] = iso(usage.fiveHourSession?.resetAt);
  }

  return {
    kill_switch: killed,
    attribution,
    ...out,
    // When each agent's windows will empty. Week resets need the week_anchor levers; the 5h
    // resets need five_hour_sessions (null ⇒ rolling window, or no session currently active).
    resets,
    mayClaim,
    // Read-only "spend split by provider" — every logged run already carries its resolved
    // provider (1.4) and captured usage (1.6), regardless of harness, so this needs no new source.
    providerUsage: {
      last5h: providerBreakdown(runList, { now, sinceMs: now - H5, pricing }),
      last7d: providerBreakdown(runList, { now, sinceMs: now - WEEK, pricing }),
      total: providerBreakdown(runList, { now, pricing }),
    },
  };
}

/** Read-only per-provider spend breakdown sourced from the GATEWAY LEDGER
 *  (not the run log). Groups by provider+model, with USD cost and token counts.
 *  Returns { [provider]: { [model]: { calls, tokens, cost } } } or null if the
 *  ledger is unavailable. */
export function providerBreakdownFromLedger(config) {
  try {
    const gatewayOn = config?.gateway?.enabled === true;
    const tenant = config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? null;
    if (!gatewayOn || !tenant) return null;
    const ledger = openLedger(undefined, { config });
    const rows = ledger.prepare(
      `SELECT provider, model, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost
         FROM token_events WHERE tenant = ? GROUP BY provider, model ORDER BY cost DESC`
    ).all(tenant);
    const out = {};
    for (const r of rows) {
      const p = r.provider || 'unknown';
      if (!out[p]) out[p] = {};
      out[p][r.model || 'unknown'] = { calls: r.calls, tokens: r.tokens ?? 0, cost: r.cost ?? 0 };
    }
    return out;
  } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Diagnostic-only: core has no default tenant, so `node budget.mjs` directly needs SOME
  // DomainPlugin to construct a config. This tiny inline plugin exists ONLY to make this
  // standalone invocation runnable — real callers (the PV runner) inject their own tenant's
  // DomainPlugin (e.g. tools/aios/pv-domain.mjs) via createAios({domain}). budgetStatus() itself
  // is fully roster-driven (§1.4) — it iterates config.domain.agents, so this diagnostic works for
  // any roster, not just the two identities below.
  const DIAG_DOMAIN = {
    agents: ['claude', 'antigravity'], prompts: { implRules: [], reviewCriteria: [] }, guardrailCheck: null,
    boardTitle: 'AIOS', riskToAction: {}, knownRiskTags: [], budgetMeter: { claude: 'transcript', antigravity: 'protobuf' },
  };
  const { config } = createAios({ domain: DIAG_DOMAIN });
  const s = budgetStatus({ config });
  const f = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
  const icon = { ok: 'OK  ', warn: 'WARN', halt: 'HALT', 'no-cap': '—   ' };
  console.log(`AIOS compute budget   (kill_switch: ${s.kill_switch}; counting: ${s.attribution === 'agent_only' ? 'agent work only' : 'founder + agent'})`);
  for (const agent of config.domain.agents) {
    console.log(`\n${agent}  → may claim new work: ${s.mayClaim[agent] ? 'YES' : 'NO'}  [${s[agent].state.toUpperCase()}]`);
    for (const w of s[agent].windows) {
      console.log(`  ${icon[w.state]} ${w.window.padEnd(4)}  ${f(w.used).padStart(12)} / ${f(w.cap).padStart(12)} tokens${w.pct != null ? `  (${w.pct}%)` : ''}`);
    }
    const fo = s[agent].founder;
    if (fo) console.log(`  founder (read-only): ${f(fo.last5h.billable)} in 5h · ${f(fo.last7d.billable)} in 7d`);
  }
  const at = (t) => (t ? new Date(t).toLocaleString() : 'rolling (no anchor)');
  console.log('');
  for (const agent of config.domain.agents) {
    console.log(`resets — ${agent} week: ${at(s.resets[`${agent}_week_at`])} · 5h: ${at(s.resets[`${agent}_5h_at`])}`);
  }
  console.log('\nEdit ceilings in .ai/policy.yaml (founder-only).');
}
