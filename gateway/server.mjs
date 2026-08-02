/**
 * server — the gateway sidecar's HTTP proxy core (bite 3.2a). Transparent metering pass-through
 * for BOTH wires, NON-STREAMING only (streaming is 3.2b; launcher wiring is 3.2d).
 *
 * WireAdapter integration (Universal Gateway 002): wire-specific logic (auth injection,
 * usage extraction, SSE parsing, denial formatting) is delegated to auto-discovered
 * WireAdapter modules rather than being hardcoded per-wire in this file.
 *
 * Enforcement (bite 3.2c): `checkVerdict(ctx)` is called EXACTLY ONCE per request, before
 * forwarding, and the single resulting verdict is threaded through to the token-event emitted for
 * that request — never re-queried, so the decision that blocked (or allowed) the call is always
 * the one stamped on the event. A 'deny' verdict never forwards upstream and responds with a
 * NON-retryable 403 in the client's own wire format (see adapter.formatDenial); any other decision
 * (incl. a future 'degrade') is treated as "forward"
 * for now (see windows.mjs's `makeCheckVerdict` for a real ledger-backed verdict source). The
 * default `checkVerdict` still always allows, so a gateway started without a real verdict source
 * stays permissive.
 *
 * D3: the harness only ever holds a short-lived per-run gateway token (see run-registry.mjs).
 * The real upstream API key is resolved and injected here, server-side, and never reaches the
 * harness process.
 *
 * Metering must never be silently skipped: every request that reaches a resolved run context
 * emits exactly one token-event, success or failure, with unknown usage fields left `null` (see
 * token-event.mjs's null-is-unknown contract) rather than fabricated as 0.
 */
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { resolveRoute } from './provider-registry.mjs';
import { makeTokenEvent, validateTokenEvent } from './token-event.mjs';
import { discoverAdapters } from './wire-adapter-registry.mjs';
import { logRequestResponse } from './logging.mjs';

export { applyThinkingToBody };

const HOP_BY_HOP_HEADERS = ['host', 'connection', 'authorization', 'x-api-key', 'x-gateway-token', 'content-length', 'transfer-encoding'];

/**
 * Detect the client wire format from a raw request body.
 * Returns 'anthropic', 'openai', or null if unrecognized.
 */
function detectClientWire(body) {
  if (!body || body.length === 0) return null;
  let parsed;
  try { parsed = JSON.parse(body.toString('utf8')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  // Anthropic: has `messages` and uses `max_tokens` (not `max_completion_tokens`)
  if (Array.isArray(parsed.messages) && parsed.max_tokens !== undefined && parsed.max_completion_tokens === undefined) {
    return 'anthropic';
  }
  // OpenAI: has `messages` and uses `max_completion_tokens` or has `stream`
  if (Array.isArray(parsed.messages) && (parsed.max_completion_tokens !== undefined || parsed.stream !== undefined)) {
    return 'openai';
  }
  return null;
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Order: x-gateway-token, then x-api-key, then Authorization: Bearer. The x-api-key path exists
// because a claude-code (anthropic-wire) run's gateway token rides on the SAME header the
// Anthropic client already sends its API key on (see harness-adapters.mjs's claudeCodeEnv +
// gateway/inject.mjs's applyGatewayInjection, which sets ANTHROPIC_API_KEY to the minted token).
function extractToken(req) {
  const direct = req.headers['x-gateway-token'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) return apiKey;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) return m[1];
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.length });
  res.end(payload);
}

/** HTTP status for a budget deny. A budget HALT is TERMINAL, not transient: unlike a real provider
 * rate-limit (429, which harnesses correctly retry because capacity frees up), retrying a deny will
 * NEVER succeed within this run — the cap won't clear. So we answer with a NON-retryable status. The
 * Anthropic and OpenAI SDKs (and the harnesses built on them, e.g. claude-code) retry 408/409/429/
 * >=500 and treat 403 as fatal — so a capped agent gets a hard API error and EXITS cleanly instead of
 * backing off and retrying against the cap until the launcher's 30-min kill (which wastes wall-clock
 * and a run slot). Once the agent exits, the runner's RCA-3 "opened-PR-but-didn't-transition"
 * recovery finishes the job. */
const DENY_STATUS = 403;

/** The deny body, shaped in the CLIENT's own wire format so a harness's existing error-handling
 * recognizes it. A non-retryable error `type` (403 `permission_error`, distinct from the retryable
 * `rate_limit_error`) is a second, wire-level signal that this must not be retried; the `over_budget`
 * code/message keeps it identifiable in logs as a gateway budget halt rather than a real auth error. */
function denyBody(wire, capWindow) {
  const message = `gateway: over budget (${capWindow})`;
  if (wire === 'anthropic') {
    return { type: 'error', error: { type: 'permission_error', message } };
  }
  // openai
  return { error: { message, type: 'permission_error', code: 'over_budget' } };
}

/** Send a budget-deny response using the adapter's wire-specific denial format.
 * Falls back to generic JSON 403 if no adapter available. */
function sendDeny(res, adapter, capWindow) {
  let denialStatus = DENY_STATUS;
  let denialBody;
  try {
    const denial = adapter?.formatDenial ? adapter.formatDenial(capWindow) : null;
    if (denial && typeof denial.status === 'number' && denial.body) {
      denialStatus = denial.status;
      denialBody = denial.body;
    }
  } catch {
    // Fall through to generic
  }
  if (!denialBody) {
    const message = `gateway: over budget (${capWindow})`;
    denialBody = { error: { message, type: 'permission_error' } };
  }
  const payload = Buffer.from(JSON.stringify(denialBody));
  res.writeHead(denialStatus, {
    'content-type': 'application/json',
    'content-length': payload.length,
    'x-should-retry': 'false',
  });
  res.end(payload);
}

/**
 * Thinking/reasoning-mode injection (policy-driven, per-provider, off-by-default — see
 * `route.thinking` in provider-registry.mjs / registry-source.mjs). The gateway is the clean,
 * harness-agnostic injection point because it already buffers the full request body before
 * forwarding it (harness CLIs like claude-code/opencode build that body themselves, so neither
 * agent nor harness code needs to change).
 *
 * `body` is a Buffer in, Buffer out — this must NEVER throw and must NEVER silently corrupt a
 * request: any body that isn't parseable JSON, or isn't a JSON object, is forwarded byte-for-byte
 * unchanged, exactly as if thinking weren't configured at all.
 */
function applyThinkingToBody(body, route) {
  if (!route?.thinking) return body;

  let parsed;
  try {
    if (!body || body.length === 0) return body;
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;

  // Respect an explicit client-set `thinking` — never override the caller's own choice.
  if ('thinking' in parsed) return body;

  parsed.thinking = { type: 'enabled' };

  // `reasoning_effort` is an OpenAI-wire-only knob; DeepSeek ignores `budget_tokens` on the
  // anthropic wire, so it is deliberately never set here on either wire.
  if (route.wire === 'openai' && typeof route.thinking === 'object' && route.thinking.effort) {
    parsed.reasoning_effort = route.thinking.effort;
  }

  return Buffer.from(JSON.stringify(parsed), 'utf8');
}

function buildForwardHeaders(req, route, adapter, resolveKey) {
  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name];

  // Force an uncompressed upstream response. The gateway reads the raw response bytes to meter the
  // `usage` block (see handleRequest); if it forwarded the client's `accept-encoding: gzip, br`, the
  // provider would compress and JSON.parse would fail on the compressed bytes (real DeepSeek does
  // exactly this — offline stubs never compress, so it only surfaced in a live dogfood). `identity`
  // guarantees plaintext to meter AND to forward. FOLLOW-UP: if a provider ever ignores this and
  // compresses anyway, add a gunzip/brotli decode on the parse path.
  headers['accept-encoding'] = 'identity';

  // Delegate auth injection to the adapter. The adapter knows which header to set.
  const apiKey = resolveKey(route.keyEnv);
  if (apiKey && adapter?.injectAuth) {
    try {
      adapter.injectAuth(headers, apiKey);
    } catch {
      // Fall through: auth injection failure is non-fatal; upstream will 401
    }
  } else if (apiKey) {
    // Fallback for when no adapter available: guess from wire
    if (route.wire === 'anthropic') {
      headers['x-api-key'] = apiKey;
    } else if (route.wire === 'openai') {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
  }

  // Phase 0: Per-provider headers from the registry (replaces hardcoded DEFAULT_ANTHROPIC_VERSION).
  // Provider headers are DEFAULTS — client-sent headers (already in `headers` from req.headers)
  // take priority. A provider configures anthropic-version as a fallback; the client can override it.
  const providerHeaders = route.providerHeaders ?? {};
  for (const [name, value] of Object.entries(providerHeaders)) {
    if (headers[name] == null) headers[name] = value; // only apply if client didn't send it
  }
  return headers;
}

/** Extracts `{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` from a parsed
 * upstream response body's `usage` block. Delegates to the adapter when available;
 * falls back to wire-based extraction for backward compatibility. Every field stays
 * `null` when absent — never fabricated as 0. */
function extractUsage(wire, parsedBody, adapter) {
  // Try adapter first
  if (adapter?.extractUsage) {
    try {
      const result = adapter.extractUsage(parsedBody);
      if (result) return result;
    } catch {
      // Fall through to wire-based extraction
    }
  }

  // Fallback: wire-based extraction
  const usage = parsedBody?.usage;
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
  }
  if (wire === 'anthropic') {
    return {
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      cacheReadTokens: usage.cache_read_input_tokens ?? null,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
    };
  }
  // openai (and generic fallback)
  return {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: null,
  };
}

/** Total tokens for the call. Unknown (null) ONLY when a CORE component (input or output) is
 * unknown. The cache components absent means "no cache tokens" (0), NOT "unknown" — e.g. OpenAI
 * has no cache-write concept, so treating its null cacheWriteTokens as unknown would wrongly null
 * every OpenAI total and drop all OpenAI spend from downstream caps math (3.3b). */
function computeTotal({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) {
  if (inputTokens === null || outputTokens === null) return null;
  return inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
}

/**
 * Incremental SSE (Server-Sent-Events) usage tracker (bite 3.2b). Fed raw upstream bytes as they
 * arrive; parses complete `\n\n`-delimited events out of a small rolling buffer (never the whole
 * transcript) and updates a running `usage` object via the adapter's extractUsageFromSSE.
 * Every field stays `null` (unknown) until an event actually reports it — same null-is-unknown
 * contract as `extractUsage`, just accumulated incrementally instead of parsed once from a full body.
 */
function createSseUsageTracker(adapter, wire) {
  let buf = '';
  const usage = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };

  function applySseEvent(parsed) {
    // Try adapter's SSE extraction first
    if (adapter?.extractUsageFromSSE) {
      try {
        const partial = adapter.extractUsageFromSSE(parsed);
        if (partial) {
          if (partial.inputTokens !== undefined) usage.inputTokens = partial.inputTokens;
          if (partial.outputTokens !== undefined) usage.outputTokens = partial.outputTokens;
          if (partial.cacheReadTokens !== undefined) usage.cacheReadTokens = partial.cacheReadTokens;
          if (partial.cacheWriteTokens !== undefined) usage.cacheWriteTokens = partial.cacheWriteTokens;
          return;
        }
      } catch {
        // Fall through to built-in handlers
      }
    }

    // Fallback: built-in wire-specific SSE handling
    if (wire === 'anthropic') {
      if (parsed?.type === 'message_start' && parsed.message?.usage && typeof parsed.message.usage === 'object') {
        const u = parsed.message.usage;
        if (u.input_tokens !== undefined) usage.inputTokens = u.input_tokens;
        if (u.cache_creation_input_tokens !== undefined) usage.cacheWriteTokens = u.cache_creation_input_tokens;
        if (u.cache_read_input_tokens !== undefined) usage.cacheReadTokens = u.cache_read_input_tokens;
      } else if (parsed?.type === 'message_delta' && parsed.usage && typeof parsed.usage.output_tokens === 'number') {
        usage.outputTokens = parsed.usage.output_tokens;
      }
    } else {
      // openai / generic
      const u = parsed?.usage;
      if (!u || typeof u !== 'object') return;
      if (u.prompt_tokens !== undefined) usage.inputTokens = u.prompt_tokens;
      if (u.completion_tokens !== undefined) usage.outputTokens = u.completion_tokens;
      if (u.prompt_tokens_details?.cached_tokens !== undefined) usage.cacheReadTokens = u.prompt_tokens_details.cached_tokens;
    }
  }

  function processEvent(rawEvent) {
    const dataLines = [];
    for (const line of rawEvent.split('\n')) {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return;
    const dataStr = dataLines.join('\n');
    if (dataStr === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return; // ignore non-JSON pings/comments
    }
    applySseEvent(parsed);
  }

  function feed(chunkStr) {
    buf += chunkStr;
    let idx;
    // SSE events are separated by a blank line; tolerate both \n\n and \r\n\r\n.
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const match = /\r?\n\r?\n/.exec(buf);
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + match[0].length);
      processEvent(rawEvent);
    }
  }

  return { feed, usage };
}

/**
 * Streaming response path (bite 3.2b): the upstream is SSE (`text/event-stream`). Pipes bytes to
 * the client as they arrive (no whole-body buffering) while incrementally parsing the same bytes
 * for the terminal usage block, then meters exactly once at stream-end (or on stream error, with
 * whatever usage was captured — best-effort, never silently skipped). Status/headers are written
 * up front so the client starts receiving bytes immediately, mirroring the buffered path's header
 * handling (drop content-length/transfer-encoding; keep the upstream content-type).
 */
function handleStreamingResponse(upstreamRes, res, { onTokenEvent, ctx, requestId, provider, model, wire, source, ideName, billingType, verdict, start, now, costFn, adapter }) {
  const responseHeaders = { ...upstreamRes.headers };
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];
  res.writeHead(upstreamRes.statusCode, {
    ...responseHeaders,
    'content-type': upstreamRes.headers['content-type'] ?? 'text/event-stream',
  });

  const tracker = createSseUsageTracker(adapter, wire);
  let emitted = false;
  const emitOnce = () => {
    if (emitted) return;
    emitted = true;
    emitEvent({
      onTokenEvent,
      ctx,
      requestId,
      provider,
      model,
      wire,
      source,
      ideName,
      billingType,
      upstreamStatus: upstreamRes.statusCode ?? null,
      latencyMs: now() - start,
      usage: tracker.usage,
      verdict,
      costFn,
    });
  };

  return new Promise((resolve) => {
    upstreamRes.on('data', (chunk) => {
      res.write(chunk);
      tracker.feed(chunk.toString('utf8'));
    });
    upstreamRes.on('end', () => {
      res.end();
      emitOnce();
      resolve();
    });
    upstreamRes.on('error', () => {
      // Best-effort: meter with whatever was captured (possibly all-null) rather than skip.
      emitOnce();
      if (!res.writableEnded) res.end();
      resolve();
    });
  });
}

function emitEvent({ onTokenEvent, ctx, requestId, provider, model, wire, source, ideName, billingType, upstreamStatus, latencyMs, usage, verdict, costFn }) {
  const usageFields = usage ?? { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
  const v = verdict ?? {};
  // costFn is a seam into domain pricing (see assembleGateway in index.mjs) — this module never
  // imports pricing.mjs itself. It must NEVER take down the request path: a throwing or
  // misbehaving costFn degrades to a null (unknown) cost, same as an absent catalog entry.
  let costUsd = null;
  try {
    costUsd = costFn(provider, model, usageFields) ?? null;
  } catch {
    costUsd = null;
  }

  const evt = makeTokenEvent(
    {
      tenant: ctx.tenant,
      agent: ctx.agent,
      session: ctx.session,
      task: ctx.task ?? null,
      runId: ctx.runId ?? null,
      requestId,
      provider,
      model,
      wire,
      upstreamStatus,
      latencyMs,
      inputTokens: usageFields.inputTokens,
      outputTokens: usageFields.outputTokens,
      cacheReadTokens: usageFields.cacheReadTokens,
      cacheWriteTokens: usageFields.cacheWriteTokens,
      totalTokens: computeTotal(usageFields),
      costUsd,
      enforcementDecision: v.decision ?? 'allow',
      capWindow: v.capWindow ?? null,
      source,
      ideName: ideName ?? null,
      billingType,
      userId: ctx.userId ?? null,
      projectId: ctx.projectId ?? null,
    },
    { defaultTenant: ctx.tenant },
  );
  validateTokenEvent(evt);
  onTokenEvent(evt);
}

/**
 * Starts the gateway's HTTP proxy. `registry` is EITHER a validated provider-registry envelope
 * (built elsewhere — 3.4a wires the real control-plane fetch), OR a zero-arg function returning
 * one — the latter lets a live registry-store (registry-pull.mjs's `createRegistryStore`) drive
 * per-request updates without restarting the gateway (e.g. `registry: () => store.get()`). Every
 * existing caller passes a plain object, which behaves exactly as before. `runs` is a run-registry instance (see
 * run-registry.mjs). `onTokenEvent` is a sink callback for every emitted token-event (the ledger
 * is 3.3; defaults to a no-op so this module has no storage dependency). `resolveKey` and `now`
 * are test seams (default `process.env` lookup and `Date.now`). `checkVerdict` is the
 * enforcement seam — defaults to always-allow; pass `makeCheckVerdict(...)` (windows.mjs) for
 * real ledger-backed cap enforcement (3.2c). `costFn` is the pricing seam — a pure
 * `(provider, model, usage) => number|null` — defaults to `() => null` so a gateway started
 * without one behaves byte-identically to before `costUsd` existed (always null). This module
 * NEVER imports pricing.mjs itself; `assembleGateway` (index.mjs) builds the real costFn from the
 * pricing catalog and injects it here (bite: ledger cost).
 */
export function startGateway({
  port = 0,
  host = process.env.GATEWAY_HOST || '127.0.0.1',
  registry,
  runs,
  onTokenEvent = () => {},
  resolveKey = (k) => (k ? process.env[k] : undefined),
  now = () => Date.now(),
  checkVerdict = () => ({ decision: 'allow' }),
  costFn = () => null,
  adapters = null,
  logging = false,
  ledger = null,
  keyRotators = new Map(),
  circuitBreaker = null,
} = {}) {
  // Resolve adapters: use provided map, or discover from default directory
  let adaptersPromise;
  if (adapters instanceof Map) {
    adaptersPromise = Promise.resolve(adapters);
  } else if (adapters === null || adapters === undefined) {
    const adaptersDir = join(dirname(fileURLToPath(import.meta.url)), 'wire-adapters');
    adaptersPromise = discoverAdapters(adaptersDir);
  } else {
    adaptersPromise = Promise.resolve(adapters);
  }

  // Cache adapters after discovery (frozen after boot per spec)
  let cachedAdapters = null;
  const getAdapters = async () => {
    if (cachedAdapters) return cachedAdapters;
    cachedAdapters = await adaptersPromise;
    return cachedAdapters;
  };

  const server = http.createServer(async (req, res) => {
    // Cheap liveness/readiness probe (no DB/provider I/O) — K8s httpGet target.
    if (req.method === 'GET' && req.url === '/healthz') {
      return sendJson(res, 200, { ok: true, ts: Date.now() });
    }

    // Management endpoints (intercepted before proxy path)
    if (req.method === 'GET' && req.url === '/api/wire-adapters') {
      const adaps = await getAdapters();
      const adapterList = [];
      for (const [wire, a] of adaps) {
        adapterList.push({
          name: wire,
          wire,
          hasInjectAuth: a.hasInjectAuth ?? false,
          hasSSEExtraction: a.hasSSEExtraction ?? false,
          hasFormatDenial: a.hasFormatDenial ?? false,
          hasNormalizeModel: a.hasNormalizeModel ?? false,
        });
      }
      return sendJson(res, 200, { adapters: adapterList });
    }

    // Logging management endpoints
    if (logging && req.method === 'GET' && req.url === '/api/gateway/logs') {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
      const provider = url.searchParams.get('provider') ?? undefined;
      const since = url.searchParams.get('since') ?? undefined;
      const { listLogs } = await import('./logging.mjs');
      const logs = listLogs(ledger, { limit, offset, provider, since });
      return sendJson(res, 200, { logs });
    }

    if (logging && req.method === 'GET') {
      const logMatch = /^\/api\/gateway\/logs\/([^/]+)$/.exec(req.url);
      if (logMatch) {
        const { getLogById } = await import('./logging.mjs');
        const entry = getLogById(ledger, logMatch[1]);
        if (!entry) return sendJson(res, 404, { error: 'log entry not found' });
        return sendJson(res, 200, entry);
      }
    }

    if (logging && req.method === 'POST') {
      const replayMatch = /^\/api\/gateway\/replay\/([^/]+)$/.exec(req.url);
      if (replayMatch) {
        const { replayRequest } = await import('./logging.mjs');
        const result = await replayRequest(ledger, replayMatch[1], { registry, resolveKey });
        if (!result) return sendJson(res, 404, { error: 'log entry not found or replay failed' });
        return sendJson(res, 200, result);
      }
    }

    const adaps = await getAdapters();
    handleRequest(req, res, { registry, runs, onTokenEvent, resolveKey, now, checkVerdict, costFn, adapters: adaps, logging, ledger, keyRotators, circuitBreaker }).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 502, { error: 'gateway: unexpected failure', detail: String(err?.message ?? err) });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://${host}:${addr.port}`,
        close: () => new Promise((res2) => server.close(() => res2())),
      });
    });
  });
}

async function handleRequest(req, res, { registry, runs, onTokenEvent, resolveKey, now, checkVerdict, costFn, adapters, logging, ledger, keyRotators, circuitBreaker }) {
  const start = now();
  const requestId = randomUUID();

  // P5: Spend pause gate — single boolean read, <1ms overhead.
  // Checked BEFORE token extraction so paused state blocks ALL requests immediately.
  if (ledger) {
    try {
      const pauseState = ledger.prepare('SELECT is_paused, paused_at, reason FROM spend_pause_state').get();
      if (pauseState && pauseState.is_paused === 1) {
        return sendJson(res, 503, {
          error: 'Spend is paused',
          pausedAt: pauseState.paused_at,
          reason: pauseState.reason || 'All AI spend has been paused by the operator',
        });
      }
    } catch { /* table may not exist yet — allow request through */ }
  }

  const token = extractToken(req);
  if (!token) return sendJson(res, 401, { error: 'gateway: missing token' });

  const ctx = runs.resolveRun(token);
  if (!ctx) return sendJson(res, 401, { error: 'gateway: unknown token' });

  // Phase 0: Determine traffic source from request context. Defaults to 'agent' since all
  // current gateway traffic originates from agent spawns. IDE/CLI/API sources will be
  // detected via specific headers in P1/P4/P6. Only known source values are accepted;
  // anything else (including unvalidated client headers) falls back to 'agent'.
  const VALID_SOURCES = new Set(['agent', 'ide', 'cli', 'api']);
  const rawSource = req.headers['x-meridianos-source'];
  const source = (rawSource && VALID_SOURCES.has(rawSource)) ? rawSource : 'agent';

  // Phase 4: IDE traffic attribution — extract ide_name from request header.
  // Valid values: vscode-copilot, claude-code, cursor, windsurf, unknown-ide
  const rawIdeName = req.headers['x-meridianos-ide-name'];
  const VALID_IDE_NAMES = new Set(['vscode-copilot', 'claude-code', 'cursor', 'windsurf', 'unknown-ide']);
  const ideName = (rawIdeName && VALID_IDE_NAMES.has(rawIdeName)) ? rawIdeName
    : (source === 'ide' ? 'unknown-ide' : null);

  // `registry` may be a plain envelope or a zero-arg provider function (see startGateway's doc
  // comment) — resolved fresh on EVERY request so a live registry-store's updates take effect
  // immediately, without needing to restart the gateway or re-resolve per-connection.
  const activeRegistry = typeof registry === 'function' ? registry() : registry;
  const route = resolveRoute(activeRegistry, ctx.provider);
  if (!route) {
    return sendJson(res, 502, { error: `gateway: no route for provider '${ctx.provider}'` });
  }

  // Look up the WireAdapter for this route's wire type
  const adapter = adapters?.get(route.wire) ?? null;

  // Phase 4: Determine billing type — subscription if route has auth.mode === 'subscription'
  const billingType = (route.auth?.mode === 'subscription') ? 'subscription' : ((ctx.billingType) || 'api_key');

  // ── Key Rotation: select key from rotator if multi-key configured ──────────
  let selectedKeyIndex = null;
  let selectedKeyValue = null;
  const rotator = keyRotators?.get(ctx.provider);
  if (rotator) {
    const selection = rotator.selectKey();
    if (selection.allExhausted) {
      return sendJson(res, 502, {
        error: `gateway: all API keys exhausted for provider '${ctx.provider}'. Retry after ${selection.shortestCooldownMs ?? '?'}s.`,
      });
    }
    selectedKeyIndex = selection.index;
    selectedKeyValue = selection.key;
  }

  // Compute the enforcement verdict ONCE per request, before forwarding.
  const verdict = checkVerdict(ctx) ?? { decision: 'allow', capWindow: null };

  if (verdict.decision === 'deny') {
    emitEvent({
      onTokenEvent,
      ctx,
      requestId,
      provider: ctx.provider,
      model: ctx.model,
      wire: route.wire,
      source,
      ideName,
      billingType,
      upstreamStatus: null,
      latencyMs: now() - start,
      usage: null,
      verdict,
      costFn,
    });
    return sendDeny(res, adapter, verdict.capWindow);
  }

  const body = await readBody(req);
  let forwardBody = applyThinkingToBody(body, route);

  // ── Cross-Wire Translation: translate request if route.translate is set ─────
  let translateClientWire = null;
  let translatedBody = null;
  if (route.translate) {
    // Detect client wire format from the request body
    const clientWire = detectClientWire(body);
    if (clientWire && clientWire !== route.wire) {
      translateClientWire = clientWire;
      const { anthropicToOpenai, openaiToAnthropic } = await import('./translate.mjs');
      const bodyObj = safeParseJson(body.toString('utf8'));
      if (bodyObj) {
        if (clientWire === 'anthropic' && route.wire === 'openai') {
          translatedBody = anthropicToOpenai(bodyObj);
        } else if (clientWire === 'openai' && route.wire === 'anthropic') {
          translatedBody = openaiToAnthropic(bodyObj);
        }
        if (translatedBody) {
          forwardBody = Buffer.from(JSON.stringify(translatedBody), 'utf8');
        }
      }
    }
  }

  const headers = buildForwardHeaders(req, route, adapter, selectedKeyValue ? (() => selectedKeyValue) : resolveKey);
  // Preserve the upstream base path: an upstreamUrl like 'https://api.deepseek.com/anthropic' must
  // become '…/anthropic/v1/messages', NOT '…/v1/messages'. `new URL(req.url, base)` would drop the
  // base path (an absolute-path req.url replaces the whole path), so concatenate base path + req.url.
  const base = new URL(route.upstreamUrl);
  const target = new URL(base.pathname.replace(/\/$/, '') + req.url, base.origin);
  const transport = target.protocol === 'https:' ? https : http;

  // Merge route-level custom headers (for generic-http and others)
  if (route.headers && typeof route.headers === 'object') {
    for (const [name, value] of Object.entries(route.headers)) {
      if (headers[name] == null) headers[name] = value;
    }
  }

  let upstreamRes;
  try {
    upstreamRes = await new Promise((resolvePromise, rejectPromise) => {
      const outReq = transport.request(
        target,
        { method: req.method, headers: { ...headers, 'content-length': Buffer.byteLength(forwardBody) } },
        (r) => resolvePromise(r),
      );
      outReq.on('error', rejectPromise);
      outReq.end(forwardBody);
    });
  } catch (err) {
    // Mark key as failed on connection error (not auth-specific, but indicates key issues)
    if (rotator && selectedKeyIndex !== null) rotator.markKeyFailed(selectedKeyIndex);
    // Circuit breaker: record upstream connection failure
    if (circuitBreaker && ctx.model) {
      circuitBreaker.recordFailure(ctx.model, { message: err?.message ?? String(err), status: null });
    }
    emitEvent({
      onTokenEvent,
      ctx,
      requestId,
      provider: ctx.provider,
      model: ctx.model,
      wire: route.wire,
      source,
      ideName,
      billingType,
      upstreamStatus: null,
      latencyMs: now() - start,
      usage: null,
      verdict,
      costFn,
    });
    return sendJson(res, 502, { error: 'gateway: upstream request failed', detail: String(err?.message ?? err) });
  }

  // ── Key Rotation: handle 401 vs success ─────────────────────────────────────
  if (rotator && selectedKeyIndex !== null) {
    if (upstreamRes.statusCode === 401) {
      rotator.markKeyFailed(selectedKeyIndex);
    } else if (upstreamRes.statusCode < 500) {
      rotator.markKeySuccess(selectedKeyIndex);
    }
    // 5xx: don't mark success or failure — key might be fine, server might be down
  }

  // Streaming path
  const upstreamContentType = (upstreamRes.headers['content-type'] || '').toLowerCase();
  if (upstreamContentType.startsWith('text/event-stream')) {
    await handleStreamingResponse(upstreamRes, res, {
      onTokenEvent,
      ctx,
      requestId,
      provider: ctx.provider,
      model: ctx.model,
      wire: route.wire,
      source,
      ideName,
      billingType,
      verdict,
      start,
      now,
      costFn,
      adapter,
    });
    return;
  }

  const responseBody = await readBody(upstreamRes);
  const latencyMs = now() - start;

  let parsed = null;
  let parseFailed = false;
  try {
    parsed = responseBody.length > 0 ? JSON.parse(responseBody.toString('utf8')) : {};
  } catch {
    parseFailed = true;
  }

  if (parseFailed) {
    emitEvent({
      onTokenEvent,
      ctx,
      requestId,
      provider: ctx.provider,
      model: ctx.model,
      wire: route.wire,
      source,
      ideName,
      billingType,
      upstreamStatus: upstreamRes.statusCode ?? null,
      latencyMs,
      usage: null,
      verdict,
      costFn,
    });
    return sendJson(res, 502, { error: 'gateway: could not parse upstream response' });
  }

  const usage = extractUsage(route.wire, parsed, adapter);

  // ── Request Logging: log request/response if logging is enabled ─────────────
  if (logging && ledger) {
    try {
      logRequestResponse(ledger, {
        provider: ctx.provider,
        model: ctx.model,
        method: req.method,
        url: target.href,
        statusCode: upstreamRes.statusCode ?? 0,
        latencyMs,
        requestHeaders: req.headers,
        requestBody: body.toString('utf8'),
        responseHeaders: upstreamRes.headers,
        responseBody: responseBody.toString('utf8'),
        extractedUsage: usage,
      });
    } catch {
      // Logging failure must never block the response
    }
  }

  emitEvent({
    onTokenEvent,
    ctx,
    requestId,
    provider: ctx.provider,
    model: ctx.model,
    wire: route.wire,
    source,
    ideName,
    billingType,
    upstreamStatus: upstreamRes.statusCode ?? null,
    latencyMs,
    usage,
    verdict,
    costFn,
  });

  // Circuit breaker: record success or failure based on upstream status
  if (circuitBreaker && ctx.model) {
    if (upstreamRes.statusCode >= 200 && upstreamRes.statusCode < 400) {
      circuitBreaker.recordSuccess(ctx.model);
    } else {
      circuitBreaker.recordFailure(ctx.model, { status: upstreamRes.statusCode, message: `upstream returned ${upstreamRes.statusCode}` });
    }
  }

  // ── Reverse Translation: translate upstream response back to client wire ────
  let clientResponseBody = responseBody;
  if (translateClientWire && parsed) {
    try {
      const { openaiResponseToAnthropic, anthropicResponseToOpenai } = await import('./translate.mjs');
      let translated;
      if (route.wire === 'openai' && translateClientWire === 'anthropic') {
        translated = openaiResponseToAnthropic(parsed);
      } else if (route.wire === 'anthropic' && translateClientWire === 'openai') {
        translated = anthropicResponseToOpenai(parsed);
      }
      if (translated) {
        clientResponseBody = Buffer.from(JSON.stringify(translated), 'utf8');
      }
    } catch {
      // Translation failure: fall through with original response
    }
  }

  const responseHeaders = { ...upstreamRes.headers };
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];
  res.writeHead(upstreamRes.statusCode, {
    ...responseHeaders,
    'content-type': upstreamRes.headers['content-type'] ?? 'application/json',
    'content-length': Buffer.byteLength(clientResponseBody),
  });
  res.end(clientResponseBody);
}
