/**
 * wire-adapter-registry — auto-discovers WireAdapter modules from gateway/wire-adapters/,
 * validates their interface contract, loads them, and dispatches incoming requests to the
 * first matching adapter.
 *
 * Each adapter module exports an object with 2 required methods (detectRequest, extractUsage)
 * and 4 optional methods (injectAuth, extractUsageFromSSE, formatDenial, normalizeModel).
 * Missing optional methods get no-op defaults.
 *
 * @typedef {object} WireAdapter
 * @property {(req: import('node:http').IncomingMessage) => {wire:string, model:string, provider:string}|null} detectRequest
 * @property {(parsedBody: object) => {inputTokens:number|null, outputTokens:number|null, cacheReadTokens:number|null, cacheWriteTokens:number|null}|null} extractUsage
 * @property {(headers: object, resolveKey: (keyEnv:string) => string|undefined) => void} [injectAuth]
 * @property {(event: object) => Partial<{inputTokens:number|null, outputTokens:number|null, cacheReadTokens:number|null, cacheWriteTokens:number|null}>|null} [extractUsageFromSSE]
 * @property {(capWindow: string) => {status: number, body: object}} [formatDenial]
 * @property {(model: string) => string} [normalizeModel]
 */

import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Load and validate a single adapter module from a directory.
 * Returns a validated adapter object with no-op defaults for omitted optional methods,
 * or null if the module fails validation (logged to stderr).
 *
 * @param {string} dir - Absolute path to the adapters directory
 * @param {string} filename - The filename (e.g. 'anthropic.mjs')
 * @returns {Promise<{adapter: object, wire: string}|null>}
 */
export async function loadAdapter(dir, filename) {
  const filePath = join(dir, filename);
  let mod;
  try {
    mod = await import(pathToFileURL(filePath).href);
  } catch (err) {
    console.error(`[MERIDIANOS] wire-adapter-registry: failed to import ${filename}: ${err?.message ?? err}`);
    return null;
  }

  const adapter = mod?.default ?? mod;
  if (!adapter || typeof adapter !== 'object') {
    console.error(`[MERIDIANOS] wire-adapter-registry: ${filename} does not export an object (got ${typeof adapter})`);
    return null;
  }

  // Validate required methods
  if (typeof adapter.detectRequest !== 'function') {
    console.error(`[MERIDIANOS] wire-adapter-registry: ${filename} missing required method detectRequest`);
    return null;
  }
  if (typeof adapter.extractUsage !== 'function') {
    console.error(`[MERIDIANOS] wire-adapter-registry: ${filename} missing required method extractUsage`);
    return null;
  }

  // Validate optional methods that are present are actually functions
  for (const optMethod of ['injectAuth', 'extractUsageFromSSE', 'formatDenial', 'normalizeModel']) {
    if (adapter[optMethod] !== undefined && typeof adapter[optMethod] !== 'function') {
      console.error(`[MERIDIANOS] wire-adapter-registry: ${filename} optional method ${optMethod} is not a function (got ${typeof adapter[optMethod]})`);
      return null;
    }
  }

  // Determine wire key: use adapter's own `wire` export, or derive from filename
  const wire = typeof adapter.wire === 'string' ? adapter.wire : filename.replace(/\.mjs$/, '');

  // Wrap with no-op defaults for omitted optional methods
  const noop = () => {};
  const wrapped = {
    wire,
    detectRequest: adapter.detectRequest,
    extractUsage: adapter.extractUsage,
    injectAuth: typeof adapter.injectAuth === 'function' ? adapter.injectAuth : noop,
    extractUsageFromSSE: typeof adapter.extractUsageFromSSE === 'function' ? adapter.extractUsageFromSSE : () => null,
    formatDenial: typeof adapter.formatDenial === 'function'
      ? adapter.formatDenial
      : (capWindow) => ({
        status: 403,
        body: { error: { message: `gateway: over budget (${capWindow})`, type: 'permission_error' } },
      }),
    normalizeModel: typeof adapter.normalizeModel === 'function' ? adapter.normalizeModel : (m) => m,
    // Reflect which optional methods are actually implemented
    hasInjectAuth: typeof adapter.injectAuth === 'function',
    hasSSEExtraction: typeof adapter.extractUsageFromSSE === 'function',
    hasFormatDenial: typeof adapter.formatDenial === 'function',
    hasNormalizeModel: typeof adapter.normalizeModel === 'function',
  };

  return { adapter: wrapped, wire };
}

/**
 * Discover and load all WireAdapter modules from a directory.
 * Scans for *.mjs files, calls loadAdapter on each, returns a Map<wire, adapter>.
 * Logs and skips invalid adapters; never throws.
 *
 * @param {string} adaptersDir - Absolute path to the adapters directory
 * @returns {Promise<Map<string, object>>}
 */
export async function discoverAdapters(adaptersDir) {
  const adapters = new Map();
  let files;
  try {
    files = readdirSync(adaptersDir);
  } catch {
    // Directory doesn't exist — no adapters is not an error
    console.warn(`[MERIDIANOS] wire-adapter-registry: adapters directory not found at ${adaptersDir}`);
    return adapters;
  }

  const mjsFiles = files.filter((f) => extname(f) === '.mjs');
  for (const filename of mjsFiles) {
    const result = await loadAdapter(adaptersDir, filename);
    if (result) {
      adapters.set(result.wire, result.adapter);
    }
  }

  return adapters;
}

/**
 * Dispatch an incoming request to the first matching adapter.
 * Iterates registered adapters calling detectRequest(req) on each.
 * Returns { adapter, result } for the first match, or null if no adapter claims the request.
 *
 * @param {Map<string, object>} adapters - Map of wire key → adapter
 * @param {import('node:http').IncomingMessage} req - The incoming HTTP request
 * @returns {{ adapter: object, result: {wire:string, model:string, provider:string} }|null}
 */
export function dispatchAdapter(adapters, req) {
  for (const adapter of adapters.values()) {
    let result;
    try {
      result = adapter.detectRequest(req);
    } catch (err) {
      console.warn(`[MERIDIANOS] wire-adapter-registry: adapter detectRequest threw: ${err?.message ?? err}`);
      continue;
    }
    if (result && typeof result === 'object' && typeof result.wire === 'string') {
      return { adapter, result };
    }
  }
  return null;
}
