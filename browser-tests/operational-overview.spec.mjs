import { test, expect } from '@playwright/test';

const FROM = '2026-08-11T00:00:00.000Z'; const TO = '2026-08-12T00:00:00.000Z';
async function attachJson(testInfo, name, value) { await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' }); }
function scopeFor(request) { const url = new URL(request.url()); return { from: url.searchParams.get('from'), to: url.searchParams.get('to'), project: url.searchParams.get('project'), provider: url.searchParams.get('provider'), timezone: 'UTC' }; }
function query(scope) { const params = new URLSearchParams({ from: scope.from, to: scope.to }); if (scope.project) params.set('project', scope.project); if (scope.provider) params.set('provider', scope.provider); return params; }
function target(path, scope) { return `${path}?${query(scope)}`; }
function series(metric, unit, count = 24) { return { metric, unit, freshAsOf: '2026-08-11T12:00:00.000Z', aggregation: 'deterministic bucket size 1', points: Array.from({ length: count }, (_, index) => ({ at: new Date(Date.parse(FROM) + index * 1000).toISOString(), value: index % 17, sampleCount: 1, drilldown: { label: `Open evidence ${index + 1}`, href: `/app/observability/usage?point=${index}` } })) }; }

async function stubOperations(page, { points = 24, delayMutation = 0, conflictLifecycle = false, retryAllowed = true, paginatedEvidence = false, paginatedAlerts = false, suppressionReason = null, retentionDisclosure = 'Retained evidence available for this run.' } = {}) {
  const mutations = [];
  await page.route('**/api/operations/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace('/api/operations', ''); const scope = scopeFor(request);
    const envelope = (data) => route.fulfill({ json: { ok: true, data, scope, meta: { pollingIntervalMs: 10000, realtimeAvailable: true } } });
    if (request.method() === 'POST') {
      mutations.push({ path, body: request.postDataJSON() }); if (delayMutation) await new Promise((resolve) => setTimeout(resolve, delayMutation));
      if (conflictLifecycle && /\/alerts\/[^/]+\/(acknowledge|resolve|reopen)$/.test(path)) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'ALERT_VERSION_CONFLICT', message: 'The alert changed after this page was loaded.', details: { refresh: true } } } });
      if (path.includes('/acknowledge')) return envelope({ occurrence: { id: 'alert-a', status: 'acknowledged', version: 2 }, event: { id: 'audit-ack' }, audit: { href: target('/app/observability/audit/audit-ack', scope) } });
      if (path.includes('/retry')) return envelope({ ok: true, duplicate: false, audit: { href: target('/app/observability/audit/audit-retry', scope) } });
      return route.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } } });
    }
    const alert = { id: 'alert-a', severity: 'critical', status: 'open', title: 'Run failed', summary: 'Provider timeout requires review.', affectedEntity: 'run-a', firstSeenAt: '2026-08-11T00:02:00.000Z', lastSeenAt: '2026-08-11T00:03:00.000Z', occurrenceCount: 2, drilldown: { entityType: 'alert', label: 'Investigate Run failed', href: target('/app/observability/alerts/alert-a', scope) } };
    if (path === '/overview') return envelope({ attention: [alert, { ...alert, id: 'alert-b', severity: 'warning', title: 'Budget warning', drilldown: { ...alert.drilldown, href: target('/app/observability/alerts/alert-b', scope), label: 'Investigate Budget warning' } }], attentionSummary: '2 unacknowledged conditions require attention.', health: { state: 'degraded', label: 'Gateway requests need review', requests: 10, errors: 1, errorRate: 10, freshAsOf: TO, drilldown: { label: 'Open gateway evidence', href: target('/app/observability/gateway', scope) } }, work: { activeAgents: 1, queuedTasks: 2, blockedTasks: 1, failedRuns: 1, definition: 'Active agents use current leases.', drilldowns: { tasks: { label: 'Open task operations', href: target('/app/operations/tasks', scope) }, runs: { label: 'Open failed runs', href: target('/app/operations/runs', scope) } } }, cost: { spend: 1.25, unknownCostEvents: 1, budget: { spend: 8, monthlyLimit: 100, forecast: 20, periodLabel: 'Current monthly budget period (fixed exception to selected time scope)' }, drilldown: { label: 'Open cost drivers', href: target('/app/observability/cost', scope) } }, regions: { attention: 'fresh', health: 'fresh', work: 'fresh', cost: 'fresh' }, freshAsOf: TO });
    if (path === '/alerts') { const laterPage = url.searchParams.get('cursor') === 'alert-page-2'; const warning = { ...alert, id: 'alert-b', severity: 'warning', title: 'Gateway warning', drilldown: { ...alert.drilldown, href: target('/app/observability/alerts/alert-b', scope), label: 'Investigate Gateway warning' } }; return envelope({ items: [laterPage ? warning : alert], nextCursor: paginatedAlerts && !laterPage ? 'alert-page-2' : null, snapshot: TO, limit: 1 }); }
    if (path === '/alerts/alert-a' || path === '/alerts/alert-b') return envelope({ occurrence: { id: path.endsWith('b') ? 'alert-b' : 'alert-a', severity: path.endsWith('b') ? 'warning' : 'critical', status: 'open', title: path.endsWith('b') ? 'Budget warning' : 'Run failed', summary: 'Provider timeout requires review.', task_id: 'project-a/task-a', run_id: 'run-a', first_seen_at: FROM, last_seen_at: TO, occurrence_count: 2, version: 1, acknowledged_by: null, acknowledgement_reason: null, notification_suppression_reason: suppressionReason, resolution_reason: null }, related: { task: { entityId: 'project-a/task-a', href: target('/app/operations/tasks/project-a%2Ftask-a', scope) }, run: { entityId: 'run-a', href: target('/app/operations/runs/run-a', scope) } }, actions: { acknowledge: { allowed: true, explanation: 'Available with a reason.' }, resolve: { allowed: true, explanation: 'Available with evidence.' }, reopen: { allowed: false, explanation: 'Only acknowledged alerts can reopen.' } }, evidenceAvailability: { alert: { earliestAvailableAt: FROM, unavailableReason: null }, run: { earliestAvailableAt: FROM, unavailableReason: null }, ledger: { earliestAvailableAt: '2026-08-11T00:02:01.000Z', unavailableReason: null } }, timeline: [{ id: 'audit-created', event_type: 'created', actor_id: 'system', from_status: null, to_status: 'open', from_severity: null, to_severity: 'critical', reason: null, result: 'recorded', created_at: FROM, drilldown: { href: target('/app/observability/audit/audit-created', scope) } }] });
    if (path === '/tasks/project-a%2Ftask-a') return envelope({ task: { id: 'project-a/task-a', title: 'Task A', status: 'blocked', projectId: 'project-a', owner: 'agent-a', updatedAt: TO }, runs: [{ run_id: 'run-a', outcome: 'failed', reason: 'timeout', provider: 'openai', model: 'gpt-test', ts: FROM, drilldown: { href: target('/app/operations/runs/run-a', scope) } }], history: [{ ts: FROM, op: 'block', from_state: 'in-progress', to_state: 'blocked', actor: 'agent-a', note: 'timeout' }], cost: { spend: 1.25, requests: 1 }, alerts: [{ id: 'alert-a', severity: 'critical', title: 'Run failed', drilldown: { href: target('/app/observability/alerts/alert-a', scope) } }], retention: { disclosure: 'Run evidence is available.' } });
    if (path === '/runs/run-a') { const laterPage = url.searchParams.get('cursor') === 'evidence-page-2'; return envelope({ run: { run_id: 'run-a', outcome: 'failed', reason: 'timeout', ts: FROM, task: 'project-a/task-a', agent: 'agent-a', provider: 'openai', model: 'gpt-test' }, task: { id: 'project-a/task-a', projectId: 'project-a', drilldown: { href: target('/app/operations/tasks/project-a%2Ftask-a', scope) } }, timeline: [{ at: FROM, type: 'task.block', summary: 'in-progress → blocked', auditId: 'task-history:1' }], evidence: { items: [{ ts: laterPage ? TO : FROM, outcome: 'failed', reason: 'timeout', note: laterPage ? 'Second retained evidence page' : 'Safe timeout summary' }], nextCursor: paginatedEvidence && !laterPage ? 'evidence-page-2' : null }, attribution: { totalTokens: 15, costUsd: 1.25, unknownCostEvents: 0 }, checks: [{ id: 'event-a', status: 'failed', upstreamStatus: 504, latencyMs: 100 }], retryHistory: [{ created_at: FROM, actor_id: 'operator-a', actor_role: 'operator', reason: 'Earlier retry', result: 'denied', correlation_id: 'retry-history-a', audit: { href: target('/app/observability/audit/audit-retry-history', scope) } }], alerts: [{ id: 'alert-a', severity: 'critical', status: 'open', title: 'Run failed', drilldown: { href: target('/app/observability/alerts/alert-a', scope) } }], recovery: { retry: { allowed: retryAllowed, explanation: retryAllowed ? 'This typed transient failure can be safely requeued.' : 'This policy failure is non-retryable; update policy before creating a new run.' }, restart: { allowed: false, explanation: 'Restart is administrator-only and is never automatic.' } }, retention: { disclosure: retentionDisclosure } }); }
    if (path === '/runs/missing') return route.fulfill({ status: 404, json: { ok: false, error: { code: 'RUN_NOT_FOUND', message: 'Run evidence is unavailable or no longer retained.' }, scope } });
    if (path.startsWith('/audit/')) return envelope({ id: path.split('/').at(-1), event_type: path.includes('retry') ? 'retry.outcome' : 'acknowledged', result: 'succeeded', created_at: TO, actor_id: 'operator-a', actor_role: 'operator', tenant_id: 'tenant-a', project_id: 'project-a', target_type: 'run', target_id: 'run-a', before: { status: 'open' }, after: { status: 'acknowledged' }, reason: 'Investigating', correlation_id: 'corr-a', metadata: {} });
    const gatewaySeries = { requests: series('requests','requests',points), errorRate: series('error_rate','%',points), latencyP50: series('latency_p50','ms',points), latencyP95: series('latency_p95','ms',points) };
    if (path === '/gateway') return envelope({ summary: { requests: points, errors: 1, errorRate: 1, latencyP50: 100, latencyP95: 200, missingLatencySamples: 0 }, series: gatewaySeries, freshAsOf: TO });
    const breakdown = Object.fromEntries(['provider','model','project','agent','task','run'].map((dimension) => [dimension, [{ key: dimension === 'provider' ? 'openai' : `${dimension}-a`, cost: 1.25, tokens: 15, requests: 1, share: 100, unknownCostEvents: 0, drilldown: { href: target(`/app/observability/usage?dimension=${dimension}&value=a`, scope) } }]]));
    if (path === '/cost') return envelope({ summary: { spend: 1.25, unknownCostEvents: 0, currency: 'USD', budget: { periodFrom: '2026-08-01T00:00:00.000Z', periodTo: '2026-09-01T00:00:00.000Z', periodLabel: 'Current monthly budget period (fixed exception to selected time scope)', spend: 8, monthlyLimit: 100, forecast: 20 } }, series: { cost: series('cost','USD',points) }, breakdowns: breakdown, freshAsOf: TO });
    if (path === '/usage') return envelope({ summary: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, totalTokens: 15, requests: 1, unknownTokenEvents: 0 }, series: { totalTokens: series('total_tokens','tokens',points) }, breakdowns: breakdown, freshAsOf: TO });
    if (path === '/usage-records') return envelope({ items: [{ id: 'event-a', ts: FROM, outcome: 'failed', provider: 'openai', model: 'gpt-test', agent: 'agent-a', taskId: 'project-a/task-a', runId: 'run-a', totalTokens: 15, costUsd: 1.25, taskUrl: target('/app/operations/tasks/project-a%2Ftask-a', scope), runUrl: target('/app/operations/runs/run-a', scope) }], nextCursor: null });
    if (path === '/tasks') return envelope({ items: [], nextCursor: null }); if (path === '/runs') return envelope({ items: [], nextCursor: null });
    return route.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND', message: 'Missing fixture route' } } });
  });
  return mutations;
}

const scopedPath = (path = '/app') => `${path}?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&project=project-a`;

test('operator identifies critical attention within five seconds and exact scope survives refresh/history at 320px', async ({ page }, testInfo) => {
  await stubOperations(page); const started = Date.now(); await page.goto(scopedPath());
  await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible();
  await expect(page.locator('.attention-item').first()).toContainText('critical'); const attentionMs = Date.now() - started; expect(attentionMs).toBeLessThan(5000);
  await page.getByLabel('Provider').fill('openai'); await page.getByRole('button', { name: 'Apply scope' }).click(); await expect(page).toHaveURL(/provider=openai/);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible(); await expect(page.getByLabel('Provider')).toHaveValue('openai');
  await page.getByRole('link', { name: 'Investigate Run failed' }).click(); await expect(page.getByRole('heading', { name: 'Run failed' })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Operational overview' })).toBeVisible(); await expect(page).toHaveURL(/project=project-a.*provider=openai|provider=openai.*project=project-a/);
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Run failed' })).toBeVisible(); await expect(page).toHaveURL(/provider=openai/); await page.goBack();
  await page.setViewportSize({ width: 320, height: 800 }); await expect(page.locator('.scope-controls')).toBeVisible(); await page.screenshot({ path: testInfo.outputPath('overview-320.png'), fullPage: true });
  const evidence = { project: testInfo.project.name, attentionMs, thresholdMs: 5000, topSeverity: 'critical', viewport: { width: 320, height: 800 }, scopePreserved: true };
  await attachJson(testInfo, 'five-second-attention.json', evidence); console.log(`[operational-attention] ${JSON.stringify(evidence)}`);
});

test('failed alert reaches exact run evidence and prevents duplicate retry submission', async ({ page }) => {
  const mutations = await stubOperations(page, { delayMutation: 100, paginatedEvidence: true, retentionDisclosure: 'Earlier run-log evidence expired under the existing retention policy; retained pages begin here.' }); await page.goto(scopedPath('/app/observability/alerts/alert-a'));
  await page.getByRole('link', { name: 'Open task project-a/task-a' }).click(); await expect(page.getByRole('heading', { name: 'Task project-a/task-a' })).toBeVisible(); await page.reload();
  await page.getByRole('link', { name: 'run-a' }).click(); await expect(page.getByRole('heading', { name: 'Run run-a' })).toBeVisible(); await page.reload();
  await expect(page.getByText('This typed transient failure can be safely requeued.')).toBeVisible(); await expect(page.getByRole('table', { name: 'Chronological retained run evidence' })).toContainText('timeout');
  await expect(page.getByRole('table', { name: 'Policy and gateway checks for this run' })).toContainText('504'); await expect(page.getByRole('table', { name: 'Recorded retry requests and immutable outcomes' })).toContainText('retry-history-a'); await expect(page.getByRole('table', { name: 'Alerts related to this run' })).toContainText('Run failed');
  await expect(page.getByText(/Earlier run-log evidence expired/)).toBeVisible(); await page.getByRole('link', { name: 'Next evidence page' }).click(); await expect(page).toHaveURL(/cursor=evidence-page-2/); await expect(page).toHaveURL(/project=project-a/); await expect(page.getByText('Second retained evidence page')).toBeVisible();
  await page.goBack(); await expect(page.getByText('Safe timeout summary')).toBeVisible(); await page.goForward(); await expect(page.getByText('Second retained evidence page')).toBeVisible();
  await page.getByLabel('Reason for retry').fill('Transient provider timeout'); const submit = page.getByRole('button', { name: 'Retry by requeueing task' }); await submit.dblclick();
  await expect(page.getByText('The task was safely requeued.')).toBeVisible(); expect(mutations.filter((item) => item.path.endsWith('/retry'))).toHaveLength(1);
  await page.getByRole('link', { name: 'Open retry audit evidence' }).click(); await expect(page.getByRole('heading', { name: /Audit evidence/ })).toBeVisible(); await expect(page.getByText('corr-a')).toBeVisible();
});

test('non-retryable run explains the safe next step without exposing a recovery mutation', async ({ page }) => {
  await stubOperations(page, { retryAllowed: false }); await page.goto(scopedPath('/app/operations/runs/run-a'));
  await expect(page.getByText('This policy failure is non-retryable; update policy before creating a new run.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Retry by requeueing task' })).toHaveCount(0);
  await page.getByText('Administrator restart (sensitive action)').click(); await expect(page.getByText('Restart is administrator-only and is never automatic.')).toBeVisible();
});

test('alert pagination forwards its cursor and missing run detail returns to the scoped list', async ({ page }) => {
  await stubOperations(page, { paginatedAlerts: true }); await page.goto(scopedPath('/app/observability/alerts'));
  await expect(page.getByRole('navigation', { name: 'Alert severity' }).getByRole('link', { name: 'Critical' })).toHaveAttribute('href', /severity=critical/); await expect(page.getByRole('table', { name: 'Scoped operational alert occurrences' })).toContainText('Run failed'); await page.getByRole('link', { name: 'Next alert page' }).click();
  await expect(page).toHaveURL(/cursor=alert-page-2/); await expect(page).toHaveURL(/project=project-a/); await expect(page.getByRole('table', { name: 'Scoped operational alert occurrences' })).toContainText('Gateway warning');
  await page.goto(scopedPath('/app/operations/runs/missing')); await expect(page.getByText('Run evidence is unavailable or no longer retained.')).toBeVisible(); const recovery = page.getByRole('link', { name: 'Return to run list' }); await expect(recovery).toHaveAttribute('href', /project=project-a/); await recovery.click(); await expect(page.getByRole('heading', { name: 'Run operations' })).toBeVisible();
});

test('alert lifecycle is keyboard-operable, conflict-safe, and demo data remains read-only', async ({ page }) => {
  const mutations = await stubOperations(page, { suppressionReason: 'Acknowledged occurrence suppresses duplicate outbound notifications until severity escalates.' }); await page.goto(scopedPath('/app/observability/alerts/alert-a')); await expect(page.getByText(/suppresses duplicate outbound notifications/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Retained source evidence' })).toBeVisible(); await expect(page.getByText(/Gateway ledger/).locator('xpath=following-sibling::dd[1]')).toContainText('Available since');
  await page.getByLabel('Acknowledge').check(); const submit = page.getByRole('button', { name: 'Record lifecycle action' }); await submit.click(); expect(mutations).toHaveLength(0);
  await page.getByLabel('Reason').fill('Investigating with provider team'); await submit.focus(); await submit.press('Enter');
  await expect(page.getByText('Alert acknowledged.')).toBeVisible(); await expect(submit.locator('xpath=following-sibling::div[@aria-live="polite"]')).toContainText('Alert acknowledged.'); await expect(submit).toBeFocused(); await expect(page.getByRole('link', { name: 'Open immutable audit evidence' })).toBeVisible();
  await page.goto(`${scopedPath('/app/observability/alerts/alert-a')}&demo=true`); await expect(page.getByText('Demo data is read-only. Lifecycle actions are disabled.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Record lifecycle action' })).toHaveCount(0); await expect(page).toHaveURL(/demo=true/);
});

test('stale alert lifecycle mutation keeps focus and offers an explicit refresh', async ({ page }) => {
  await stubOperations(page, { conflictLifecycle: true }); await page.goto(scopedPath('/app/observability/alerts/alert-a')); await page.getByLabel('Acknowledge').check(); await page.getByLabel('Reason').fill('Investigating a concurrent update');
  const submit = page.getByRole('button', { name: 'Record lifecycle action' }); await submit.focus(); await submit.press('Enter');
  await expect(page.getByText('Another actor changed this alert. Refresh before trying again.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Refresh current alert' })).toBeVisible(); await expect(submit).toBeFocused();
  await page.getByRole('button', { name: 'Refresh current alert' }).click(); await expect(page.getByRole('heading', { name: 'Run failed' })).toBeVisible();
});

test('finance view reconciles chart/table evidence with uPlot unavailable and passes semantic checks', async ({ page }, testInfo) => {
  await page.route('**/static/vendor/uplot.iife.min.js', (route) => route.abort()); await stubOperations(page); await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.goto(scopedPath('/app/observability/cost')); await expect(page.getByRole('heading', { name: 'Cost drivers and budget' })).toBeVisible();
  await expect(page.getByText('Current monthly budget period (fixed exception')).toBeVisible(); await expect(page.getByRole('table', { name: /Cost over selected time/ })).toBeVisible(); await expect(page.locator('.chart-table tbody tr')).toHaveCount(24); await expect(page.getByRole('table', { name: /Cost drivers by provider/ })).toContainText('openai'); await expect(page.locator('dl')).toContainText('$1.25');
  await page.getByRole('link', { name: 'Model', exact: true }).click(); await expect(page).toHaveURL(/dimension=model/); await expect(page.getByRole('table', { name: /Cost drivers by model/ })).toContainText('model-a'); await page.goBack(); await expect(page.getByRole('table', { name: /Cost drivers by provider/ })).toBeVisible(); await page.goForward();
  const evidenceLink = page.getByRole('link', { name: 'Open model-a usage records' }); await evidenceLink.focus(); await expect(evidenceLink).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: 'Usage records' })).toBeVisible(); await expect(page.getByRole('table', { name: 'Usage breakdown by model' })).toContainText('model-a'); await expect(page.getByRole('navigation', { name: 'Usage dimension' }).getByRole('link', { name: 'Agent' })).toBeVisible(); await expect(page.getByRole('table', { name: /Allowlisted gateway usage records/ })).toContainText('$1.25');
  await expect(page.getByRole('button', { name: /retry|record lifecycle/i })).toHaveCount(0);
  await page.evaluate(() => { document.body.style.zoom = '2'; }); await page.setViewportSize({ width: 640, height: 900 });
  const evidence = await page.evaluate(() => {
    const issues = [];
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id); const duplicateIds = ids.filter((id,index,all) => all.indexOf(id) !== index);
    for (const id of duplicateIds) issues.push({ impact: 'serious', rule: 'duplicate-id', wcag: '4.1.1', target: `#${id}` });
    for (const node of document.querySelectorAll('input,select,textarea')) if (!node.labels?.length && !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby')) issues.push({ impact: 'critical', rule: 'form-control-name', wcag: '4.1.2', target: node.outerHTML.slice(0, 120) });
    for (const node of document.querySelectorAll('a,button')) if (!node.textContent.trim() && !node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby')) issues.push({ impact: 'critical', rule: 'interactive-name', wcag: '2.4.4/4.1.2', target: node.outerHTML.slice(0, 120) });
    for (const table of document.querySelectorAll('table')) { if (!table.caption?.textContent.trim()) issues.push({ impact: 'serious', rule: 'table-caption', wcag: '1.3.1', target: table.outerHTML.slice(0, 120) }); if (!table.querySelector('th')) issues.push({ impact: 'serious', rule: 'table-header', wcag: '1.3.1', target: table.outerHTML.slice(0, 120) }); }
    if (document.querySelectorAll('h1').length !== 1) issues.push({ impact: 'serious', rule: 'single-page-heading', wcag: '1.3.1/2.4.6', target: `h1 count ${document.querySelectorAll('h1').length}` });
    return { issues, settings: { forcedColors: matchMedia('(forced-colors: active)').matches, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, zoom: document.body.style.zoom }, semanticTables: document.querySelectorAll('table').length };
  });
  expect(evidence.issues.filter((issue) => ['critical','serious'].includes(issue.impact))).toEqual([]);
  expect(evidence.settings).toEqual({ forcedColors: true, reducedMotion: true, zoom: '2' }); expect(evidence.semanticTables).toBeGreaterThan(0);
  const ariaSnapshot = await page.locator('main').ariaSnapshot(); expect(ariaSnapshot).toContain('Usage records'); expect(ariaSnapshot).toContain('table');
  await attachJson(testInfo, 'accessibility-semantic-audit.json', evidence); await testInfo.attach('screen-reader-semantic-snapshot.yml', { body: ariaSnapshot, contentType: 'text/yaml' }); console.log(`[operational-accessibility] ${JSON.stringify({ project: testInfo.project.name, ...evidence, keyboardDrilldown: true, semanticSnapshot: true })}`);
});

test('2,000-point chart and table updates stay within the p95 performance budget', async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.__longTasks = []; new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true }); });
  await stubOperations(page, { points: 2000 }); await page.goto(scopedPath('/app/observability/gateway'));
  for (let index = 0; index < 9; index++) { const label = index % 2 ? 'Gateway' : 'Cost'; await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: label }).click(); await expect(page.locator('.chart-table tbody tr')).toHaveCount(2000); }
  const evidence = await page.evaluate(() => ({ durations: performance.getEntriesByName('operational-chart-render').map((entry) => entry.duration), longTasks: window.__longTasks }));
  const ordered = [...evidence.durations].sort((a,b) => a-b); const p95 = ordered[Math.max(0, Math.ceil(ordered.length * .95) - 1)]; const maxLongTaskMs = Math.max(0, ...evidence.longTasks);
  const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory ?? null }));
  const report = { project: testInfo.project.name, pointCount: 2000, samples: ordered.length, aggregation: 'deterministic bucket size 1', p95Ms: p95, thresholdMs: 500, maxLongTaskMs, longTaskThresholdMs: 200, environment };
  expect(ordered.length).toBeGreaterThanOrEqual(10); expect(p95).toBeLessThanOrEqual(500); expect(maxLongTaskMs).toBeLessThanOrEqual(200);
  await attachJson(testInfo, 'chart-performance.json', report); console.log(`[operational-performance] ${JSON.stringify(report)}`);
});

test('ten alert-to-evidence journeys stay below sixty seconds with successful recovery identification', async ({ page }, testInfo) => {
  await stubOperations(page); const durations = [];
  for (let index = 0; index < 10; index++) { const start = Date.now(); await page.goto(scopedPath('/app/observability/alerts/alert-a')); await page.getByRole('link', { name: 'Open run run-a' }).click(); await expect(page.getByText('This typed transient failure can be safely requeued.')).toBeVisible(); durations.push(Date.now() - start); }
  durations.sort((a,b) => a-b); const medianMs = (durations[4] + durations[5]) / 2; const successRate = durations.filter((value) => value <= 60000).length / durations.length;
  const report = { project: testInfo.project.name, runs: durations.length, durationsMs: durations, medianMs, thresholdMs: 60000, successRate, requiredSuccessRate: .9, identified: ['implicated run', 'retained evidence', 'safe recovery action'] };
  expect(medianMs).toBeLessThanOrEqual(60000); expect(successRate).toBeGreaterThanOrEqual(.9);
  await attachJson(testInfo, 'alert-to-run-journey.json', report); console.log(`[operational-journey] ${JSON.stringify(report)}`);
});
