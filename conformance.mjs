/**
 * conformance — the "onboard any new provider in a minute" battery. Point it at a provider
 * (a descriptor from providers.mjs, or an ad-hoc `{ baseURL, wire, model, key }`) and it runs a
 * fixed set of checks over the wire directly (no CLI harness spawn — that's harness-adapters.mjs
 * + the e2e smokes): basic completion, streaming, usage-field shape, and error-shape handling.
 *
 * Two modes:
 *   - mock mode — against test/mock-provider.mjs, $0, deterministic, runs in CI
 *     (tests/conformance.test.mjs).
 *   - live mode — against a real provider endpoint, opt-in, needs a real (or free/local, e.g.
 *     Ollama) endpoint + key. Not run in CI; see tests/ollama-e2e.test.mjs for the one live
 *     invocation this repo keeps, gated behind OLLAMA_E2E=1.
 *
 * A target is `{ name, baseURL, wire: 'openai' | 'anthropic', model, key }`. `resolveTarget`
 * builds one from a providers.mjs descriptor (or accepts a hand-built target directly), so a
 * brand-new provider can be checked with nothing but its base URL + a key — no code changes to
 * providers.mjs required first.
 */
import { pathToFileURL } from 'node:url';
import { resolveProvider, providerKeyPresent } from './providers.mjs';

// ─── Target resolution ──────────────────────────────────────────────────────────────────────

/**
 * Resolve a battery target. Accepts either:
 *   - a provider name (string) registered in providers.mjs — resolved via resolveProvider(),
 *     using its `wire`/model default and reading the BYO key from `process.env[keyEnv]`;
 *   - a ready-made target object `{ baseURL, wire, model, key }` — for a provider that isn't
 *     (yet) in the registry at all.
 * `wireOverride` picks which of a provider's endpoints to hit when it exposes both (e.g.
 * deepseek's native `openai` baseUrl vs its `anthropicBaseUrl`).
 */
export function resolveTarget(input, { wireOverride, model, prompt } = {}) {
  if (typeof input === 'string') {
    // No `config`/live policy.yaml here on purpose: this battery resolves providers from the
    // code registry (providers.mjs) for ad-hoc endpoint testing, not from the founder's policy
    // overlay — an empty policy makes that explicit rather than reaching for an ambient default.
    const provider = resolveProvider(input, {});
    if (!provider) throw new Error(`unknown provider: ${input}`);
    const wire = wireOverride ?? provider.wire;
    const baseURL = wire === 'anthropic' && provider.wire !== 'anthropic'
      ? provider.anthropicBaseUrl
      : provider.baseUrl;
    if (!baseURL) throw new Error(`provider '${input}' has no endpoint for wire '${wire}'`);
    return {
      name: provider.name,
      wire,
      baseURL,
      model: model ?? provider.models?.medium,
      key: provider.keyEnv ? process.env[provider.keyEnv] : undefined,
      keyPresent: providerKeyPresent(provider),
      prompt,
    };
  }
  if (!input || !input.baseURL || !input.wire) {
    throw new Error('ad-hoc target requires at least { baseURL, wire }');
  }
  return { prompt, ...input, name: input.name ?? input.baseURL, keyPresent: Boolean(input.key) };
}

// ─── Wire-format request/response helpers ───────────────────────────────────────────────────

function endpointPath(wire) {
  return wire === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
}

function buildBody(target, { stream, maxTokens }) {
  const messages = [{ role: 'user', content: target.prompt ?? 'Reply with a short greeting.' }];
  if (target.wire === 'anthropic') {
    return { model: target.model, max_tokens: maxTokens ?? 64, messages, stream };
  }
  const body = { model: target.model, messages, stream };
  if (maxTokens) body.max_tokens = maxTokens;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

function buildHeaders(target, { errorScenario } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (target.wire === 'anthropic') {
    headers['x-api-key'] = target.key ?? '';
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.authorization = `Bearer ${target.key ?? ''}`;
  }
  // Harmless against a real provider (an unrecognized header is ignored); mock-provider.mjs
  // reads it to inject a deterministic error response for the errorShape check.
  if (errorScenario) headers['x-mock-scenario'] = errorScenario;
  return headers;
}

function extractText(wire, body) {
  if (wire === 'anthropic') return (body?.content ?? []).map((b) => b.text ?? '').join('');
  return body?.choices?.[0]?.message?.content ?? '';
}

function extractUsage(wire, body) {
  if (!body?.usage) return null;
  return wire === 'anthropic'
    ? { input: body.usage.input_tokens, output: body.usage.output_tokens }
    : { input: body.usage.prompt_tokens, output: body.usage.completion_tokens, total: body.usage.total_tokens };
}

function usageLooksValid(usage) {
  if (!usage) return false;
  const nums = Object.values(usage).filter((v) => v !== undefined);
  return nums.length > 0 && nums.every((v) => Number.isFinite(v) && v >= 0);
}

async function post(target, { stream, errorScenario, maxTokens } = {}) {
  const url = target.baseURL.replace(/\/$/, '') + endpointPath(target.wire);
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(target, { errorScenario }),
    body: JSON.stringify(buildBody(target, { stream, maxTokens })),
  });
  return res;
}

async function collectSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const dataLines = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
    }
  }
  return dataLines;
}

// ─── Checks ─────────────────────────────────────────────────────────────────────────────────

async function checkCompletion(target) {
  const res = await post(target, { stream: false });
  if (!res.ok) return { name: 'completion', pass: false, detail: `HTTP ${res.status}` };
  const body = await res.json().catch((e) => { throw new Error(`response body was not valid JSON: ${e.message}`); });
  const text = extractText(target.wire, body);
  const usage = extractUsage(target.wire, body);
  return {
    name: 'completion',
    pass: text.length > 0,
    detail: text.length > 0 ? `got ${text.length} chars` : 'empty completion text',
    usage,
  };
}

async function checkStreaming(target) {
  const res = await post(target, { stream: true });
  if (!res.ok) return { name: 'streaming', pass: false, detail: `HTTP ${res.status}` };
  const dataLines = await collectSSE(res);
  if (dataLines.length === 0) return { name: 'streaming', pass: false, detail: 'no SSE data lines received' };

  let text = '';
  let usage = null;
  for (const line of dataLines) {
    if (line === '[DONE]') continue;
    let evt;
    try { evt = JSON.parse(line); } catch { return { name: 'streaming', pass: false, detail: `unparseable SSE data line: ${line.slice(0, 80)}` }; }
    if (target.wire === 'anthropic') {
      if (evt.type === 'content_block_delta') text += evt.delta?.text ?? '';
      if (evt.type === 'message_start') usage = { input: evt.message?.usage?.input_tokens };
      if (evt.type === 'message_delta' && evt.usage) usage = { ...usage, output: evt.usage.output_tokens };
    } else {
      const delta = evt.choices?.[0]?.delta;
      if (delta?.content) text += delta.content;
      if (evt.usage) usage = { input: evt.usage.prompt_tokens, output: evt.usage.completion_tokens, total: evt.usage.total_tokens };
    }
  }
  return {
    name: 'streaming',
    pass: text.length > 0,
    detail: text.length > 0 ? `assembled ${text.length} chars from ${dataLines.length} SSE events` : 'no text assembled from stream',
    usage,
  };
}

async function checkUsage(target, priorResults) {
  const completionUsage = priorResults.find((r) => r.name === 'completion')?.usage;
  const streamingUsage = priorResults.find((r) => r.name === 'streaming')?.usage;
  const ok = usageLooksValid(completionUsage) && usageLooksValid(streamingUsage);
  return {
    name: 'usage',
    pass: ok,
    detail: ok ? 'usage present and well-formed on both completion and streaming' : `completion=${JSON.stringify(completionUsage)} streaming=${JSON.stringify(streamingUsage)}`,
  };
}

async function checkErrorShape(target) {
  // maxTokens: 1 keeps this cheap on a real (non-mock) provider: if it ignores the mock-only
  // header below, this falls through to a normal — but minimal — billable completion instead of
  // a full one (mock-provider.mjs ignores max_tokens entirely, so mock mode is unaffected).
  const res = await post(target, { stream: false, errorScenario: '429', maxTokens: 1 });
  if (res.ok) {
    return { name: 'errorShape', pass: true, skipped: true, detail: 'endpoint returned 2xx for the synthetic error trigger (expected for a real provider that ignores the mock-only header) — nothing to verify without mock mode' };
  }
  const text = await res.text();
  const body = (() => { try { return JSON.parse(text); } catch { return null; } })();
  const hasErrorShape = Boolean(body && typeof body === 'object' && (body.error || body.type === 'error'));
  return {
    name: 'errorShape',
    pass: hasErrorShape,
    detail: hasErrorShape ? `HTTP ${res.status} with a parseable error body` : `HTTP ${res.status} body did not look like an error shape: ${text.slice(0, 120)}`,
  };
}

// ─── Battery runner ─────────────────────────────────────────────────────────────────────────

export async function runBattery(target) {
  const results = [];
  for (const fn of [checkCompletion, checkStreaming]) {
    try {
      results.push(await fn(target));
    } catch (e) {
      results.push({ name: fn.name.replace('check', '').replace(/^./, (c) => c.toLowerCase()), pass: false, detail: e.message });
    }
  }
  results.push(await checkUsage(target, results).catch((e) => ({ name: 'usage', pass: false, detail: e.message })));
  results.push(await checkErrorShape(target).catch((e) => ({ name: 'errorShape', pass: false, detail: e.message })));

  return {
    provider: target.name,
    wire: target.wire,
    baseURL: target.baseURL,
    pass: results.every((r) => r.pass),
    results,
  };
}

/** Renders a report exactly like the CLI prints — reused by tests that want the same text. */
export function formatReport(report) {
  const lines = [`conformance: ${report.provider} (${report.wire}) — ${report.pass ? 'PASS' : 'FAIL'}`];
  for (const r of report.results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    const note = r.skipped ? ' (skipped)' : '';
    lines.push(`  [${mark}]${note} ${r.name} — ${r.detail}`);
  }
  return lines.join('\n');
}

// ─── CLI entry ──────────────────────────────────────────────────────────────────────────────
// node tools/aios/conformance.mjs --provider deepseek [--wire anthropic] [--model ...]
// node tools/aios/conformance.mjs --base-url http://localhost:11434/v1 --wire openai --model gemma4:e4b --key local

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let target;
  if (args.provider) {
    target = resolveTarget(args.provider, { wireOverride: args.wire, model: args.model, prompt: args.prompt });
    if (!target.keyPresent) {
      console.error(`provider '${args.provider}' has no key configured (${target.key === undefined ? 'unset env var' : 'n/a'}) — set its keyEnv before running live conformance`);
      process.exitCode = 1;
      return;
    }
  } else if (args['base-url']) {
    target = resolveTarget({ baseURL: args['base-url'], wire: args.wire ?? 'openai', model: args.model, key: args.key, name: args.name }, { prompt: args.prompt });
  } else {
    console.error('usage: node tools/aios/conformance.mjs --provider <name> | --base-url <url> --wire <openai|anthropic> --model <id> [--key <key>]');
    process.exitCode = 1;
    return;
  }

  const report = await runBattery(target);
  console.log(formatReport(report));
  process.exitCode = report.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
