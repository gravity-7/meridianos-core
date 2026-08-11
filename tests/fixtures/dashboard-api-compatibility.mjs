export const DASHBOARD_API_COMPATIBILITY = Object.freeze([
  { method: 'GET', path: '/api/status', status: 200, type: 'json', keys: ['ts', 'kill_switch'] },
  { method: 'GET', path: '/api/run?id=missing', status: 404, type: 'json', keys: ['ok', 'error'] },
  { method: 'GET', path: '/api/ledger/summary', status: 200, type: 'json', keys: ['ok', 'available'] },
  { method: 'GET', path: '/api/analytics/overview', status: 200, type: 'json', keys: ['totalSpend', 'totalTokens', 'totalApiCalls', 'period'] },
  { method: 'GET', path: '/api/activity/feed', status: 401, type: 'json', keys: ['error'] },
  { method: 'GET', path: '/api/v1/openapi.yaml', status: 200, type: 'yaml', contains: 'openapi:' },
  { method: 'GET', path: '/static/app-platform.mjs', status: 200, type: 'javascript', contains: 'routeModule' },
]);
