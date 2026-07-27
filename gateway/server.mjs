/**
 * server — the gateway sidecar's HTTP proxy core (bite 3.2a). Transparent metering pass-through
 * for BOTH wires, NON-STREAMING only (streaming is 3.2b; launcher wiring is 3.2d).
 *
 * Enforcement (bite 3.2c): `checkVerdict(ctx)` is called EXACTLY ONCE per request, before
 * forwarding, and the single resulting verdict is threaded through to the token-event emitted for
 * that request — never re-queried, so the decision that blocked (or allowed) the call is always
 * the one stamped on the event. A 'deny' verdict never forwards upstream and responds with a
 * NON-retryable 403 in the client's own wire format (see `denyBody`/`sendDeny`); any other decision
 * (incl. a future 'degrade') is treated as "forward"
 * for now (see windows.mjs's `makeCheckVerdict` for a real ledger-backed verdict source). The
 * default `checkVerdict` still always allows, so a gateway started without a real verdict source
 * stays permissive.
 *
 * No wire translation (locked decision D1): every request is forwarded to a same-wire upstream
 * (resolved from the provider-registry envelope) and metered — the gateway never converts an
 * Anthropic-shaped call into an OpenAI-shaped one or vice versa.
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
import { resolveRoute } from './provider-registry.mjs';
import { makeTokenEvent, validateTokenEvent } from './token-event.mjs';

export { applyThinkingToBody };

const HOP_BY_HOP_HEADERS = ['host', 'connection', 'authorization', 'x-api-key', 'x-gateway-token', 'content-length', 'transfer-encoding'];

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

/** Send a budget-deny response: a non-retryable 403 plus an explicit `x-should-retry: false` header.
 * That header is belt-and-suspenders — the Anthropic/OpenAI SDKs honor it OVER the status-code retry
 * heuristic, so even a harness that would otherwise retry this status is told, unambiguously, not to. */
function sendDeny(res, wire, capWindow) {
  const payload = Buffer.from(JSON.stringify(denyBody(wire, capWindow)));
  res.writeHead(DENY_STATUS, {
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

function buildForwardHeaders(req, route, resolveKey) {
  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name];

  // Force an uncompressed upstream response. The gateway reads the raw response bytes to meter the
  // `usage` block (see handleRequest); if it forwarded the client's `accept-encoding: gzip, br`, the
  // provider would compress and JSON.parse would fail on the compressed bytes (real DeepSeek does
  // exactly this — offline stubs never compress, so it only surfaced in a live dogfood). `identity`
  // guarantees plaintext to meter AND to forward. FOLLOW-UP: if a provider ever ignores this and
  // compresses anyway, add a gunzip/brotli decode on the parse path.
  headers['accept-encoding'] = 'identity';

  if (route.wire === 'anthropic') {
    const key = resolveKey(route.keyEnv);
    if (key) headers['x-api-key'] = key;
  } else if (route.wire === 'openai') {
    const key = resolveKey(route.keyEnv);
    if (key) headers['authorization'] = `Bearer ${key}`;
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
 * upstream response body's `usage` block, per wire. Every field stays `null` when absent —
 * never fabricated as 0. */
function extractUsage(wire, parsedBody) {
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
  // openai
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
 * transcript) and updates a running `usage` object per wire's terminal-usage shape. Every field
 * stays `null` (unknown) until an event actually reports it — same null-is-unknown contract as
 * `extractUsage`, just accumulated incrementally instead of parsed once from a full body.
 */
function createSseUsageTracker(wire) {
  let buf = '';
  const usage = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };

  function applyAnthropicEvent(evt) {
    if (evt?.type === 'message_start' && evt.message?.usage && typeof evt.message.usage === 'object') {
      const u = evt.message.usage;
      if (u.input_tokens !== undefined) usage.inputTokens = u.input_tokens;
      if (u.cache_creation_input_tokens !== undefined) usage.cacheWriteTokens = u.cache_creation_input_tokens;
      if (u.cache_read_input_tokens !== undefined) usage.cacheReadTokens = u.cache_read_input_tokens;
    } else if (evt?.type === 'message_delta' && evt.usage && typeof evt.usage.output_tokens === 'number') {
      // Cumulative per the anthropic streaming wire — the LAST value seen wins.
      usage.outputTokens = evt.usage.output_tokens;
    }
  }

  function applyOpenaiEvent(evt) {
    const u = evt?.usage;
    if (!u || typeof u !== 'object') return;
    if (u.prompt_tokens !== undefined) usage.inputTokens = u.prompt_tokens;
    if (u.completion_tokens !== undefined) usage.outputTokens = u.completion_tokens;
    if (u.prompt_tokens_details?.cached_tokens !== undefined) usage.cacheReadTokens = u.prompt_tokens_details.cached_tokens;
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
    if (wire === 'anthropic') applyAnthropicEvent(parsed);
    else applyOpenaiEvent(parsed);
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
function handleStreamingResponse(upstreamRes, res, { onTokenEvent, ctx, requestId, provider, model, wire, source, verdict, start, now, costFn }) {
  const responseHeaders = { ...upstreamRes.headers };
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];
  res.writeHead(upstreamRes.statusCode, {
    ...responseHeaders,
    'content-type': upstreamRes.headers['content-type'] ?? 'text/event-stream',
  });

  const tracker = createSseUsageTracker(wire);
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

function emitEvent({ onTokenEvent, ctx, requestId, provider, model, wire, source, upstreamStatus, latencyMs, usage, verdict, costFn }) {
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
  registry,
  runs,
  onTokenEvent = () => {},
  resolveKey = (k) => (k ? process.env[k] : undefined),
  now = () => Date.now(),
  checkVerdict = () => ({ decision: 'allow' }),
  costFn = () => null,
} = {}) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, { registry, runs, onTokenEvent, resolveKey, now, checkVerdict, costFn }).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 502, { error: 'gateway: unexpected failure', detail: String(err?.message ?? err) });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res2) => server.close(() => res2())),
      });
    });
  });
}

async function handleRequest(req, res, { registry, runs, onTokenEvent, resolveKey, now, checkVerdict, costFn }) {
  const start = now();
  const requestId = randomUUID();

  const token = extractToken(req);
  if (!token) return sendJson(res, 401, { error: 'gateway: missing token' });

  const ctx = runs.resolveRun(token);
  if (!ctx) return sendJson(res, 401, { error: 'gateway: unknown token' });

  // Phase 0: Determine traffic source from request context. Defaults to 'agent' since all
  // current gateway traffic originates from agent spawns. IDE/CLI/API sources will be
  // detected via specific headers in P1/P4/P6 (x-meridianos-source or similar).
  const source = req.headers['x-meridianos-source'] || 'agent';

  // `registry` may be a plain envelope or a zero-arg provider function (see startGateway's doc
  // comment) — resolved fresh on EVERY request so a live registry-store's updates take effect
  // immediately, without needing to restart the gateway or re-resolve per-connection.
  const activeRegistry = typeof registry === 'function' ? registry() : registry;
  const route = resolveRoute(activeRegistry, ctx.provider);
  if (!route) {
    // No wire is known yet at this point (routing failed before any wire could be resolved), and
    // token-event.wire has no "unknown" value to fall back to — so unlike the post-routing
    // failures below, this edge (a misconfigured run pointing at an unregistered provider) is
    // reported to the client but does not produce a token-event.
    return sendJson(res, 502, { error: `gateway: no route for provider '${ctx.provider}'` });
  }

  // Compute the enforcement verdict ONCE per request, before forwarding. The same verdict object
  // is threaded through to every emitEvent call below so the decision that blocked (or allowed)
  // the call is exactly the one stamped on the token-event — never re-queried against the ledger
  // a second time, which could return a different answer than the one just enforced.
  const verdict = checkVerdict(ctx) ?? { decision: 'allow', capWindow: null };

  // Any decision other than 'deny' is treated as "forward" for this bite. FOLLOW-UP: a future
  // 'degrade' decision (reroute to a cheaper provider instead of blocking outright) is a
  // documented follow-up, not implemented here.
  if (verdict.decision === 'deny') {
    emitEvent({
      onTokenEvent,
      ctx,
      requestId,
      provider: ctx.provider,
      model: ctx.model,
      wire: route.wire,
      source,
      upstreamStatus: null,
      latencyMs: now() - start,
      usage: null,
      verdict,
      costFn,
    });
    return sendDeny(res, route.wire, verdict.capWindow);
  }

  const body = await readBody(req);
  const forwardBody = applyThinkingToBody(body, route);
  const headers = buildForwardHeaders(req, route, resolveKey);
  // Preserve the upstream base path: an upstreamUrl like 'https://api.deepseek.com/anthropic' must
  // become '…/anthropic/v1/messages', NOT '…/v1/messages'. `new URL(req.url, base)` would drop the
  // base path (an absolute-path req.url replaces the whole path), so concatenate base path + req.url.
  const base = new URL(route.upstreamUrl);
  const target = new URL(base.pathname.replace(/\/$/, '') + req.url, base.origin);
  const transport = target.protocol === 'https:' ? https : http;

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
    emitEvent({
      onTokenEvent,
      ctx,
      requestId,
      provider: ctx.provider,
      model: ctx.model,
      wire: route.wire,
      source,
      upstreamStatus: null,
      latencyMs: now() - start,
      usage: null,
      verdict,
      costFn,
    });
    return sendJson(res, 502, { error: 'gateway: upstream request failed', detail: String(err?.message ?? err) });
  }

  // Streaming path (bite 3.2b): detected from the UPSTREAM's own content-type, not the client's
  // request — a streaming request whose upstream fails before it can respond (or an upstream that
  // ignores `stream: true`) is metered on the buffered path exactly as before.
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
      verdict,
      start,
      now,
      costFn,
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
      upstreamStatus: upstreamRes.statusCode ?? null,
      latencyMs,
      usage: null,
      verdict,
      costFn,
    });
    return sendJson(res, 502, { error: 'gateway: could not parse upstream response' });
  }

  const usage = extractUsage(route.wire, parsed);
  emitEvent({
    onTokenEvent,
    ctx,
    requestId,
    provider: ctx.provider,
    model: ctx.model,
    wire: route.wire,
    source,
    upstreamStatus: upstreamRes.statusCode ?? null,
    latencyMs,
    usage,
    verdict,
    costFn,
  });

  const responseHeaders = { ...upstreamRes.headers };
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];
  res.writeHead(upstreamRes.statusCode, {
    ...responseHeaders,
    'content-type': upstreamRes.headers['content-type'] ?? 'application/json',
    'content-length': Buffer.byteLength(responseBody),
  });
  res.end(responseBody);
}
