import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrlScope, serializeUrlScope, inheritScope, operationalScopeKey } from '../dashboard/app/shared/operational-scope.mjs';
import { createOperationsApi, OperationsClientError } from '../dashboard/app/shared/operations-api.mjs';

test('URL scope resolves a previous-24-hour default to exact timestamps and preserves compatible filters', () => {
  const scope = parseUrlScope(new URL('http://localhost/app'), { now: Date.parse('2026-08-11T12:00:00Z') });
  assert.equal(scope.from, '2026-08-10T12:00:00.000Z'); assert.equal(scope.to, '2026-08-11T12:00:00.000Z');
  const next = inheritScope('/app/observability/cost?dimension=provider', { ...scope, project: 'project-a', provider: 'openai' });
  assert.match(next, /project=project-a/); assert.match(next, /provider=openai/); assert.match(next, /dimension=provider/);
  assert.equal(operationalScopeKey(scope), operationalScopeKey(parseUrlScope(new URL(`http://localhost/app?${serializeUrlScope(scope)}`))));
});

test('operations client validates envelopes, preserves scope, adds mutation guards, and normalizes safe errors', async () => {
  const calls = [];
  const scope = { from: '2026-08-10T12:00:00.000Z', to: '2026-08-11T12:00:00.000Z', project: 'project-a', provider: null, timezone: 'UTC' };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/bad')) return { ok: false, status: 409, json: async () => ({ error: { code: 'ALERT_VERSION_CONFLICT', message: 'changed' } }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { value: 1 }, scope }) };
  };
  let mutationToken = 'dash-token';
  const api = createOperationsApi({ fetchImpl, getMutationToken: () => mutationToken, getScope: () => scope, randomUUID: () => 'correlation-a' });
  assert.deepEqual(await api.read('/overview'), { value: 1 });
  await api.mutate('/alerts/a/acknowledge', { reason: 'triage' }, { idempotencyKey: 'mutation-a' });
  assert.match(calls[0].url, /from=/); assert.equal(calls[1].options.headers['x-aios-token'], 'dash-token');
  assert.equal(calls[1].options.headers['x-correlation-id'], 'correlation-a'); assert.equal(calls[1].options.headers['idempotency-key'], 'mutation-a');
  mutationToken = 'rotated-token'; await api.mutate('/alerts/a/acknowledge', { reason: 'follow-up' }); assert.equal(calls[2].options.headers['x-aios-token'], 'rotated-token');
  await assert.rejects(() => api.read('/bad'), (error) => error instanceof OperationsClientError && error.code === 'ALERT_VERSION_CONFLICT' && !String(error).includes('secret'));
  assert.equal(api.dispose, api.abortAll); api.abortAll();
});

test('operations client abortAll cancels every pending request', async () => {
  const scope = { from: '2026-08-10T12:00:00.000Z', to: '2026-08-11T12:00:00.000Z', project: null, provider: null, timezone: 'UTC' };
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const api = createOperationsApi({ fetchImpl, getScope: () => scope }); const pending = api.read('/overview');
  await Promise.resolve(); api.abortAll(); await assert.rejects(pending, { name: 'AbortError' });
});
