/**
 * token-event — the authoritative per-call usage record the gateway sidecar emits. This is the
 * record shape for a gateway-OWNED append-only ledger (its own store, wired in 3.2/3.3) — it is
 * NOT the daemon's board DB / schema.sql `events` table (see event-log.mjs), a separate concern.
 *
 * null-is-unknown: every token/cost/status/latency field is `number | null`. null means
 * GENUINELY UNKNOWN (e.g. the upstream response couldn't be parsed) and is NEVER fabricated as 0
 * — the same contract usage-readers.mjs enforces for post-hoc harness usage. `totalTokens` is
 * never auto-computed from its components: if any of inputTokens/outputTokens/cacheReadTokens/
 * cacheWriteTokens is null, the caller must decide totalTokens explicitly (or leave it null too).
 *
 * tenant is first-class even though single-tenant today (defaults to 'pv' via the optional
 * `{ defaultTenant }` second argument) — the gateway is designed to serve multiple tenants once
 * a control plane exists.
 */
import { randomUUID } from 'node:crypto';

const VALID_WIRES = ['anthropic', 'openai'];
const VALID_ENFORCEMENT_DECISIONS = ['allow', 'deny', 'degrade'];
const VALID_CAP_WINDOWS = ['5h', 'week', null];

// ─── Construction ───────────────────────────────────────────────────────────

/**
 * Normalizes a partial token-event into a full one: assigns `id`/`ts` if absent, defaults
 * `tenant`, leaves every usage/cost/wire field as `null` (unknown) unless explicitly provided.
 * Never fabricates a token count or cost — absence in `partial` stays `null`, not `0`.
 */
export function makeTokenEvent(partial = {}, { defaultTenant = 'pv' } = {}) {
  return {
    // Attribution
    id: partial.id ?? randomUUID(),
    ts: partial.ts ?? new Date().toISOString(),
    tenant: partial.tenant ?? defaultTenant,
    agent: partial.agent ?? null,
    session: partial.session ?? null,
    task: partial.task ?? null,
    runId: partial.runId ?? null,
    requestId: partial.requestId ?? null,
    // Wire
    provider: partial.provider ?? null,
    model: partial.model ?? null,
    wire: partial.wire ?? null,
    upstreamStatus: partial.upstreamStatus ?? null,
    latencyMs: partial.latencyMs ?? null,
    // Usage
    inputTokens: partial.inputTokens ?? null,
    outputTokens: partial.outputTokens ?? null,
    cacheReadTokens: partial.cacheReadTokens ?? null,
    cacheWriteTokens: partial.cacheWriteTokens ?? null,
    totalTokens: partial.totalTokens ?? null,
    // Governance
    costUsd: partial.costUsd ?? null,
    enforcementDecision: partial.enforcementDecision ?? 'allow',
    capWindow: partial.capWindow ?? null,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

function isNumberOrNull(v) {
  return v === null || typeof v === 'number';
}

/** Throws on the first malformed field. Returns true when the event is well-formed. */
export function validateTokenEvent(evt) {
  if (!evt || typeof evt !== 'object') {
    throw new Error('token-event must be an object');
  }
  if (typeof evt.id !== 'string' || evt.id.length === 0) {
    throw new Error('token-event.id must be a non-empty string');
  }
  if (typeof evt.ts !== 'string' || evt.ts.length === 0) {
    throw new Error('token-event.ts must be a non-empty ISO-8601 string');
  }
  if (typeof evt.tenant !== 'string' || evt.tenant.length === 0) {
    throw new Error('token-event.tenant must be a non-empty string');
  }
  if (typeof evt.agent !== 'string') {
    throw new Error('token-event.agent must be a string');
  }
  if (typeof evt.requestId !== 'string' || evt.requestId.length === 0) {
    throw new Error('token-event.requestId must be a non-empty string');
  }
  if (typeof evt.session !== 'string' || evt.session.length === 0) {
    throw new Error('token-event.session must be a non-empty string');
  }
  if (evt.task !== null && typeof evt.task !== 'string') {
    throw new Error('token-event.task must be null or a string');
  }
  if (evt.runId !== null && typeof evt.runId !== 'string') {
    throw new Error('token-event.runId must be null or a string');
  }
  if (typeof evt.provider !== 'string' || evt.provider.length === 0) {
    throw new Error('token-event.provider must be a non-empty string');
  }
  if (typeof evt.model !== 'string' || evt.model.length === 0) {
    throw new Error('token-event.model must be a non-empty string');
  }
  if (!VALID_WIRES.includes(evt.wire)) {
    throw new Error(`token-event.wire must be one of ${VALID_WIRES.join(', ')} (got '${evt.wire}')`);
  }
  if (!isNumberOrNull(evt.upstreamStatus)) {
    throw new Error('token-event.upstreamStatus must be a number or null');
  }
  if (!isNumberOrNull(evt.latencyMs)) {
    throw new Error('token-event.latencyMs must be a number or null');
  }
  for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens']) {
    if (!isNumberOrNull(evt[field])) {
      throw new Error(`token-event.${field} must be a number or null`);
    }
  }
  if (!isNumberOrNull(evt.costUsd)) {
    throw new Error('token-event.costUsd must be a number or null');
  }
  if (!VALID_ENFORCEMENT_DECISIONS.includes(evt.enforcementDecision)) {
    throw new Error(`token-event.enforcementDecision must be one of ${VALID_ENFORCEMENT_DECISIONS.join(', ')} (got '${evt.enforcementDecision}')`);
  }
  if (!VALID_CAP_WINDOWS.includes(evt.capWindow)) {
    throw new Error(`token-event.capWindow must be one of '5h', 'week', or null (got '${evt.capWindow}')`);
  }
  return true;
}

// ─── Interop with usage-readers.mjs / budget.mjs ───────────────────────────

/**
 * Projects a token-event down to the exact shape usage-readers.mjs's `readUsage` returns —
 * `{ inputTokens, outputTokens, totalTokens, provider, model }` — proving token-event is a
 * superset drop-in for that consumer. Preserves the null-is-unknown contract: a null component
 * on the event stays null here, never coerced to 0.
 */
export function tokenEventToUsage(evt) {
  return {
    inputTokens: evt.inputTokens,
    outputTokens: evt.outputTokens,
    totalTokens: evt.totalTokens,
    provider: evt.provider,
    model: evt.model,
  };
}
