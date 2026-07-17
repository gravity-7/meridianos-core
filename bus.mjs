/**
 * bus — the AIOS coordination library. Schema-validated, lease-aware task operations over the
 * SQLite state core (state.mjs), used IN-PROCESS by the orchestrator (runner, watchdog,
 * verifier, planner). Winning work is ONE atomic DB claim — no `git push` race, no lost
 * handoff, no alphabetical queue (the failure modes of the v1 file bridge).
 *
 * Deliberately separate from tools/ai-bus-mcp (Antigravity's design-handoff bridge): that server
 * hands out briefs + collects design handoffs; THIS library is how the orchestrator and agents
 * claim / heartbeat / transition real work against the DB. Pure functions over a `db` handle, so
 * every path is unit-testable without a socket.
 *
 * Defence in depth:
 *   - every call is validated against the tool's inputSchema (unknown tool / missing field /
 *     bad type / bad enum / extra field → quarantined as a BusError, never reaches state).
 *   - inbound free text (handoff markdown) is scanned for smuggled instructions before it is
 *     written where another agent will read it (the BUS guardrail seam — `scan` is injectable).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonArray } from './state.mjs';
import { STATES } from './machine.mjs';
import { scanInbound } from './bus-guard.mjs';
import { createInboxSource } from './inbox-source.mjs';

/** A validation / quarantine failure. Carries a machine-readable `code`. */
export class BusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BusError';
    this.code = code;
  }
}

// ---- tool catalog (also drives MCP tools/list) -------------------------------------------
/** Build the BUS tool catalog. `config` is the injected AiosConfig (REQUIRED) — its
 *  `domain.agents` roster drives the `agent` field's enum. */
export function buildBusTools(config) {
  const AGENT = { type: 'string', enum: config.domain.agents };
  return [
    {
      name: 'next_task',
      description: 'The next task this agent may work: right status, not live-leased, all dependencies done, highest priority first. Read-only — call claim_task to actually take it.',
      inputSchema: { type: 'object', properties: { agent: AGENT }, required: ['agent'], additionalProperties: false },
    },
    {
      name: 'claim_task',
      description: 'Atomically lease a task (and lock every resource it declares) so no other agent can take it. Returns {ok:false,error:"leased"|...} if you lose the race — pick another task.',
      inputSchema: { type: 'object', properties: { agent: AGENT, taskId: { type: 'string' }, session: { type: 'string' }, ttlMs: { type: 'number' } }, required: ['agent', 'taskId', 'session'], additionalProperties: false },
    },
    {
      name: 'heartbeat',
      description: 'Extend your lease while you work. Succeeds only if you still hold a live lease on the task.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, session: { type: 'string' }, ttlMs: { type: 'number' } }, required: ['taskId', 'session'], additionalProperties: false },
    },
    {
      name: 'transition',
      description: 'Move a task to a new status (state-machine enforced). Pass your session to prove you hold the lease. Optionally set pr and a note.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, to: { type: 'string', enum: STATES }, session: { type: 'string' }, note: { type: 'string' }, pr: { type: 'number' } }, required: ['taskId', 'to'], additionalProperties: false },
    },
    {
      name: 'release',
      description: 'Voluntarily drop a lease you hold (frees its resource locks). Status is unchanged.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, session: { type: 'string' } }, required: ['taskId', 'session'], additionalProperties: false },
    },
    {
      name: 'block_task',
      description: 'Park a task as blocked with a reason (e.g. waiting on data or a founder decision).',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, reason: { type: 'string' }, session: { type: 'string' } }, required: ['taskId', 'reason'], additionalProperties: false },
    },
    {
      name: 'list_tasks',
      description: 'All tasks as briefs (id, title, status, owner, priority, resources, deps, pr). Read-only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'submit_handoff',
      description: 'Submit a completed design handoff. Writes .ai/inbox/<feature>.handoff.md and, if the feature is a live-leased designing task you hold, advances it designing → ready-for-impl. Markdown is scanned for injected instructions before it is accepted.',
      inputSchema: { type: 'object', properties: { feature: { type: 'string' }, markdown: { type: 'string' }, session: { type: 'string' } }, required: ['feature', 'markdown'], additionalProperties: false },
    },
  ];
}

// ---- schema validation (quarantine bad input) --------------------------------------------
/** Validate `args` against a tool's inputSchema. Throws BusError on any violation. Returns args.
 *  `config` is the injected AiosConfig (REQUIRED), threaded to buildBusTools. */
export function validateArgs(toolName, args, config) {
  const tool = buildBusTools(config).find((t) => t.name === toolName);
  if (!tool) throw new BusError('unknown_tool', `unknown tool: ${toolName}`);
  const schema = tool.inputSchema;
  const a = args ?? {};
  if (typeof a !== 'object' || Array.isArray(a)) throw new BusError('bad_args', 'arguments must be an object');
  const props = schema.properties || {};
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(a)) if (!(k in props)) throw new BusError('bad_args', `unexpected argument: ${k}`);
  }
  for (const r of schema.required || []) {
    if (a[r] === undefined || a[r] === null || a[r] === '') throw new BusError('bad_args', `missing required argument: ${r}`);
  }
  for (const [k, spec] of Object.entries(props)) {
    if (a[k] === undefined) continue;
    if (spec.type === 'string' && typeof a[k] !== 'string') throw new BusError('bad_args', `${k} must be a string`);
    if (spec.type === 'number' && typeof a[k] !== 'number') throw new BusError('bad_args', `${k} must be a number`);
    if (spec.enum && !spec.enum.includes(a[k])) throw new BusError('bad_args', `${k} must be one of ${spec.enum.join(', ')}`);
  }
  return a;
}

// ---- BUS guardrail: injection defense for inbound bus content (lives in bus-guard.mjs) ----
export { scanInbound };

// ---- handlers (db-injected; pure over state.mjs) -----------------------------------------
const brief = (t) => t && {
  id: t.id, title: t.title, status: t.status, owner: t.owner, priority: t.priority,
  resources: parseJsonArray(t.resources), depends_on: parseJsonArray(t.depends_on),
  contracts: parseJsonArray(t.contracts), spec: t.spec ?? null, pr: t.pr ?? null,
};

export function nextTask(store, { agent }) {
  const t = store.state.nextEligibleTask({ agent });
  return t ? { ok: true, task: brief(t) } : { ok: true, task: null, message: `no eligible task for ${agent}` };
}

export function claim(store, { agent, taskId, session, ttlMs }) {
  const r = store.state.claimTask({ taskId, agent, session, ...(ttlMs ? { ttlMs } : {}) });
  return r.won ? { ok: true, task: brief(r.task) } : { ok: false, error: r.reason, by: r.by };
}

export function heartbeat(store, { taskId, session, ttlMs }) {
  const r = store.state.heartbeat({ taskId, session, ...(ttlMs ? { ttlMs } : {}) });
  return r.ok ? { ok: true } : { ok: false, error: 'not-lease-holder' };
}

export function transition(store, { taskId, to, session, note, pr }) {
  try {
    const r = store.state.transition({ taskId, to, actor: session || 'agent', note, requireSession: session || null, pr });
    return r && r.ok === false ? { ok: false, error: r.reason } : { ok: true, task: brief(r.task) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function release(store, { taskId, session }) {
  const r = store.state.releaseLease({ taskId, session });
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export function blockTask(store, { taskId, reason, session }) {
  try {
    const r = store.state.blockTask({ taskId, actor: session || 'agent', reason });
    return r && r.ok === false ? { ok: false, error: r.reason } : { ok: true, task: brief(r.task) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function list(store) {
  return { ok: true, tasks: store.state.listTasks().map(brief) };
}

export function submitHandoff(store, { feature, markdown, session }, { config, inbox = undefined, scan = scanInbound, docs = store.docs, inboxSource = createInboxSource({ config, docs }) } = {}) {
  const flagged = scan(markdown);
  if (flagged) return { ok: false, error: `quarantined: ${flagged}` };
  const safe = String(feature).replace(/[^\w.-]/g, '_');
  // `from`/`to` are fixed prose describing the design→impl contract (nothing parses them back —
  // see REPO-AUDIT.md §1.3), not a roster lookup, so they don't need generalizing for 2.1b. TODO:
  // if a non-default roster ever adds a second design or impl role, key these off config.domain.agents.
  let handoffPath;
  if (inbox !== undefined) {
    // Test override: preserve today's exact behavior — write directly to the given absolute dir,
    // bypassing the DocStore/InboxSource (which are scoped to config.repoRoot, not an arbitrary
    // temp dir).
    const body = `---\nfeature: ${feature}\nfrom: antigravity\nto: claude-code\nstatus: ready-for-impl\n---\n\n${markdown}`;
    if (!existsSync(inbox)) mkdirSync(inbox, { recursive: true });
    const outPath = join(inbox, `${safe}.handoff.md`);
    writeFileSync(outPath, body, 'utf8');
    handoffPath = `.ai/inbox/${safe}.handoff.md`;
  } else {
    // Default path: write through the InboxSource (D2 bite #3) instead of a direct docs.write —
    // its `submit()` reproduces this exact frontmatter/body byte-for-byte (see inbox-source.mjs).
    handoffPath = inboxSource.submit({ feature, markdown });
  }

  let advanced = false;
  const t = store.state.getTask(feature);
  if (t && t.status === 'designing') {
    try {
      store.state.transition({ taskId: feature, to: 'ready-for-impl', actor: session || 'antigravity', note: 'design handoff submitted', requireSession: session || null, releaseLease: !!session });
      advanced = true;
    } catch { /* not a legal/owned advance — leave the task as-is, handoff is still written */ }
  }
  return { ok: true, handoff: handoffPath, advanced };
}

// ---- dispatcher --------------------------------------------------------------------------
/** Validate + route one tool call. Throws BusError on bad input; returns the handler result.
 *  `opts.config` is the injected AiosConfig (REQUIRED). */
export function dispatch(store, name, args, opts = {}) {
  const { config } = opts;
  const a = validateArgs(name, args, config);
  switch (name) {
    case 'next_task': return nextTask(store, a);
    case 'claim_task': return claim(store, a);
    case 'heartbeat': return heartbeat(store, a);
    case 'transition': return transition(store, a);
    case 'release': return release(store, a);
    case 'block_task': return blockTask(store, a);
    case 'list_tasks': return list(store);
    case 'submit_handoff': return submitHandoff(store, a, opts);
    default: throw new BusError('unknown_tool', `unrecognized tool: ${name}`);
  }
}
