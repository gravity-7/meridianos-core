/**
 * cassette — a small VCR-style helper for provider HTTP calls.
 *
 * record mode: makes a REAL request and writes a sanitized, committed JSON cassette to
 *   `tools/aios/test/cassettes/<name>.json`. Run manually, cheaply, once (against a free/local
 *   provider — Ollama needs no key; a paid provider needs founder spend authorization per
 *   .ai/constitution.md §6 same as any other live call).
 * replay mode (default, what CI runs): serves the committed cassette — deterministic, no
 *   network, $0.
 *
 * Sanitization on record strips auth headers/keys before writing, so a committed cassette never
 * carries a secret (guardrails scans committed files for exactly this).
 *
 * Usage:
 *   import { fetchWithCassette } from './cassette.mjs';
 *   const res = await fetchWithCassette('ollama-chat-completion', {
 *     url: 'http://localhost:11434/v1/chat/completions',
 *     headers: { authorization: 'Bearer local' },
 *     body: { model: 'gemma4:e4b', messages: [{ role: 'user', content: 'Say OK.' }] },
 *   });
 *   // res.status, res.headers, res.body — same shape whether recorded or replayed.
 *
 * Record a cassette:
 *   AIOS_CASSETTE_MODE=record node -e "import('./tools/aios/test/cassette.mjs').then(...)"
 * or write a tiny one-off script that calls fetchWithCassette with { mode: 'record' }.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CASSETTE_DIR = join(HERE, 'cassettes');

// Header names (case-insensitive) whose values are secrets and must never reach a committed file.
const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key', 'anthropic-api-key', 'cookie', 'set-cookie']);

function sanitizeHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

export function cassetteFile(name) {
  return join(CASSETTE_DIR, `${name}.json`);
}

/** Reads a committed cassette. Throws a clear error (record-it-first) if it doesn't exist. */
export function loadCassette(name) {
  const path = cassetteFile(name);
  if (!existsSync(path)) {
    throw new Error(`cassette not found: ${path} — record it first with { mode: 'record' } against a real (free/local) provider`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveCassette(name, entry) {
  mkdirSync(CASSETTE_DIR, { recursive: true });
  writeFileSync(cassetteFile(name), JSON.stringify(entry, null, 2) + '\n');
}

/**
 * Record mode: performs the real fetch, sanitizes it, writes the cassette, returns the response.
 * Replay mode (default): reads the committed cassette, returns its response — no network call.
 * Returns `{ status, headers, body }` either way, so callers don't care which mode ran.
 */
export async function fetchWithCassette(name, { url, method = 'POST', headers = {}, body } = {}, { mode = process.env.AIOS_CASSETTE_MODE ?? 'replay' } = {}) {
  if (mode === 'record') {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const responseBody = safeParseJson(text);
    const entry = {
      recordedAt: new Date().toISOString(),
      request: { method, url, headers: sanitizeHeaders(headers), body: body ?? null },
      response: { status: res.status, headers: sanitizeHeaders(Object.fromEntries(res.headers)), body: responseBody },
    };
    saveCassette(name, entry);
    return entry.response;
  }

  const entry = loadCassette(name);
  return entry.response;
}
