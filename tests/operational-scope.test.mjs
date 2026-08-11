import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOperationalScope, OperationalScopeError } from '../dashboard/operational-scope.mjs';

const auth = { tenantId: 'tenant-a', allowedProjects: ['project-a'], allowedProviders: ['openai'] };

test('operational scope defaults to the previous 24 hours and never accepts tenant input', () => {
  const scope = parseOperationalScope(new URL('http://localhost/app/overview'), auth, {}, { now: Date.parse('2026-08-11T12:00:00Z') });
  assert.deepEqual(scope, {
    tenantId: 'tenant-a', projectId: null, provider: null,
    from: '2026-08-10T12:00:00.000Z', to: '2026-08-11T12:00:00.000Z', timezone: 'UTC',
  });
  assert.throws(() => parseOperationalScope(new URL('http://localhost/app?tenant=other'), auth), (error) => error instanceof OperationalScopeError && error.code === 'INVALID_SCOPE');
});

test('operational scope preserves an exact authorized UTC half-open interval', () => {
  const url = new URL('http://localhost/app?project=project-a&provider=openai&from=2026-08-01T00:00:00Z&to=2026-08-02T00:00:00Z');
  assert.deepEqual(parseOperationalScope(url, auth), {
    tenantId: 'tenant-a', projectId: 'project-a', provider: 'openai',
    from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z', timezone: 'UTC',
  });
});

test('operational scope rejects reversed, excessive, and unauthorized filters without broadening', () => {
  assert.throws(() => parseOperationalScope(new URL('http://localhost/app?from=2026-08-02T00:00:00Z&to=2026-08-01T00:00:00Z'), auth), /before/);
  assert.throws(() => parseOperationalScope(new URL('http://localhost/app?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z'), auth), /maximum/);
  assert.throws(() => parseOperationalScope(new URL('http://localhost/app?project=secret'), auth), (error) => error.code === 'FORBIDDEN_SCOPE');
  assert.throws(() => parseOperationalScope(new URL('http://localhost/app?provider=anthropic'), auth), (error) => error.code === 'FORBIDDEN_SCOPE');
});

test('local operator context may scope to an explicit project/provider but still cannot set tenant', () => {
  const scope = parseOperationalScope(new URL('http://localhost/app?project=p&provider=x'), { tenantId: 'local', local: true });
  assert.equal(scope.projectId, 'p');
  assert.equal(scope.provider, 'x');
});
