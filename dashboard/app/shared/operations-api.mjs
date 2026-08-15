import { operationalScopeKey, serializeUrlScope } from './operational-scope.mjs';

export class OperationsClientError extends Error {
  constructor(code, message, status = 0, details = null) { super(message); this.name = 'OperationsClientError'; this.code = code; this.status = status; this.details = details; }
}

export function createOperationsApi({ fetchImpl = fetch, token = globalThis.AIOS_TOKEN, getMutationToken = () => token, getScope, randomUUID = () => crypto.randomUUID() } = {}) {
  const controllers = new Set();
  async function call(path, { method = 'GET', body = null, params = {}, idempotencyKey = null } = {}) {
    const scope = getScope(); const url = new URL(`/api/operations${path}`, globalThis.location?.origin || 'http://localhost');
    for (const [key, value] of serializeUrlScope(scope)) url.searchParams.set(key, value);
    for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, value);
    const controller = new AbortController(); controllers.add(controller);
    const headers = { accept: 'application/json' };
    if (method !== 'GET') {
      headers['content-type'] = 'application/json'; headers['x-aios-token'] = getMutationToken();
      headers['x-correlation-id'] = randomUUID(); if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    }
    try {
      const response = await fetchImpl(`${url.pathname}${url.search}`, { method, headers, signal: controller.signal, ...(body == null ? {} : { body: JSON.stringify(body) }) });
      const envelope = await response.json().catch(() => null);
      if (!response.ok || envelope?.ok === false) {
        const error = envelope?.error ?? {};
        throw new OperationsClientError(error.code || `HTTP_${response.status}`, error.message || 'Operational request failed. Refresh and try again.', response.status, error.details ?? null);
      }
      if (!envelope || !Object.hasOwn(envelope, 'data')) throw new OperationsClientError('INVALID_RESPONSE', 'The operational response was incomplete.', response.status);
      if (envelope.scope && operationalScopeKey(envelope.scope) !== operationalScopeKey(scope)) throw new OperationsClientError('STALE_SCOPE', 'A response for an earlier scope was ignored.', 409);
      return envelope.data;
    } finally { controllers.delete(controller); }
  }
  const abortAll = () => { for (const controller of controllers) controller.abort(); controllers.clear(); };
  return {
    read: (path, params) => call(path, { params }),
    mutate: (path, body, options = {}) => call(path, { method: 'POST', body, idempotencyKey: options.idempotencyKey }),
    abortAll,
    dispose: abortAll,
  };
}
