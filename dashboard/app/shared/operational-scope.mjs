const DAY_MS = 86400000;

function instant(value, fallback) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

export function parseUrlScope(input, { now = Date.now() } = {}) {
  const url = input instanceof URL ? input : new URL(String(input), 'http://localhost');
  const to = instant(url.searchParams.get('to'), new Date(now).toISOString());
  const from = instant(url.searchParams.get('from'), new Date(Date.parse(to) - DAY_MS).toISOString());
  if (Date.parse(from) >= Date.parse(to)) throw new Error('Operational time scope must have from before to.');
  return { from, to, project: url.searchParams.get('project') || null, provider: url.searchParams.get('provider') || null, timezone: 'UTC' };
}

export function serializeUrlScope(scope) {
  const params = new URLSearchParams({ from: scope.from, to: scope.to });
  if (scope.project) params.set('project', scope.project);
  if (scope.provider) params.set('provider', scope.provider);
  return params;
}

export function operationalScopeKey(scope) {
  return JSON.stringify([scope.from, scope.to, scope.project ?? null, scope.provider ?? null]);
}

export function inheritScope(destination, scope, { keepProject = true, keepProvider = true } = {}) {
  const url = new URL(destination, 'http://localhost');
  const inherited = serializeUrlScope({ ...scope, project: keepProject ? scope.project : null, provider: keepProvider ? scope.provider : null });
  for (const [key, value] of inherited) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function presetScope(name, scope, { now = Date.now() } = {}) {
  const to = new Date(now).toISOString();
  const durations = { '1h': 3600000, '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };
  if (!durations[name]) return scope;
  return { ...scope, from: new Date(now - durations[name]).toISOString(), to };
}
