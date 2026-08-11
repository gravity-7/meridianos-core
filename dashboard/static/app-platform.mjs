import { readApplicationStatus } from './app-boundary.mjs';
import { createOnboardingController } from './onboarding-flow.mjs';
import { actionButton, emptyState, feedback } from './ui-primitives.mjs';
import { resolveAppRoute, routeModule } from '/static/app/route-registry.mjs';
import { parseUrlScope, serializeUrlScope, inheritScope, presetScope } from '/static/app/shared/operational-scope.mjs';
import { createOperationsApi } from '/static/app/shared/operations-api.mjs';
import { createRealtimeCoordinator } from '/static/app/shared/realtime-coordinator.mjs';
import { make, notice } from '/static/app/shared/view-helpers.mjs';

const themeKey = 'meridianos-ui-theme'; const realtimeKey = 'meridianos-operational-realtime';
const app = document.querySelector('#app'); const announcer = document.querySelector('#announcer'); const themeButton = document.querySelector('#theme');
let scope = parseUrlScope(location.href); let epoch = 0; let activeOnboarding = null; let pendingMutations = 0; let realtime = null; let disposers = [];
let realtimeScopeKey = null;
let restoreRouteFocus = false;
const api = createOperationsApi({ token: window.AIOS_TOKEN, getScope: () => scope });

function applyTheme(theme) { document.documentElement.dataset.theme = theme; themeButton.textContent = `Theme: ${theme}`; }
function currentTheme() { return localStorage.getItem(themeKey) || 'system'; }
function canonicalizeScope() {
  const url = new URL(location.href); const params = serializeUrlScope(scope); let changed = false;
  for (const [key,value] of params) if (url.searchParams.get(key) !== value) { url.searchParams.set(key,value); changed = true; }
  if (changed) history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
function scopedDestination(target) {
  const url = new URL(target, location.origin); const destination = new URL(inheritScope(`${url.pathname}${url.search}${url.hash}`, scope), location.origin);
  if (new URL(location.href).searchParams.get('demo') === 'true') destination.searchParams.set('demo', 'true');
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
function updateNav() { for (const link of document.querySelectorAll('.app-header a[href^="/app"]')) if (!link.pathname.startsWith('/app/setup')) link.href = scopedDestination(link.pathname); }
function announce(message) { announcer.textContent = ''; requestAnimationFrame(() => { announcer.textContent = message; }); }
function cleanupRoute() { for (const dispose of disposers.splice(0)) { try { dispose(); } catch (error) { console.error('Operational route cleanup failed.', error); } } }
function navigate(target, { replace = false } = {}) {
  const url = new URL(target, location.origin); const destination = url.pathname.startsWith('/app/setup') ? `${url.pathname}${url.search}` : scopedDestination(`${url.pathname}${url.search}${url.hash}`);
  if (replace) history.replaceState({}, '', destination);
  else history.pushState({}, '', destination);
  restoreRouteFocus = true; void renderCurrent();
}
function scopeControls() {
  const form = make('form', null, 'scope-controls'); form.setAttribute('aria-label', 'Operational filters and time scope');
  const presetLabel = make('label', 'Time preset'); const preset = make('select'); preset.name = 'preset';
  for (const [value,label] of [['custom','Exact interval'],['1h','Last hour'],['24h','Last 24 hours'],['7d','Last 7 days'],['30d','Last 30 days']]) { const option = make('option', label); option.value = value; preset.append(option); } presetLabel.append(preset);
  const field = (labelText, name, value, type = 'text') => { const label = make('label', labelText); const input = make('input'); input.name = name; input.type = type; input.value = value ?? ''; label.append(input); return { label, input }; };
  const project = field('Project', 'project', scope.project); const provider = field('Provider', 'provider', scope.provider); const from = field('From (UTC)', 'from', scope.from.slice(0,16), 'datetime-local'); const to = field('To (UTC, exclusive)', 'to', scope.to.slice(0,16), 'datetime-local');
  const submit = make('button', 'Apply scope'); submit.type = 'submit';
  preset.addEventListener('change', () => { if (preset.value === 'custom') return; scope = presetScope(preset.value, { ...scope }); navigate(`${location.pathname}?${serializeUrlScope(scope)}`); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try { const next = { from: new Date(`${from.input.value}:00Z`).toISOString(), to: new Date(`${to.input.value}:00Z`).toISOString(), project: project.input.value.trim() || null, provider: provider.input.value.trim() || null, timezone: 'UTC' }; if (Date.parse(next.from) >= Date.parse(next.to)) throw new Error('From must be before To.'); scope = next; navigate(`${location.pathname}?${serializeUrlScope(scope)}`); }
    catch (error) { announce(error.message); }
  });
  const live = make('div', null, 'refresh-controls'); const refresh = make('button', 'Refresh now'); refresh.type = 'button'; refresh.addEventListener('click', () => realtime?.refreshNow());
  const realtimeLabel = make('label'); const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = localStorage.getItem(realtimeKey) === 'true'; const demo = new URL(location.href).searchParams.get('demo') === 'true'; checkbox.disabled = demo;
  realtimeLabel.append(checkbox, document.createTextNode(demo ? ' Realtime disabled for demo data' : ' Use realtime updates'));
  checkbox.addEventListener('change', () => { localStorage.setItem(realtimeKey, String(checkbox.checked)); realtime?.setRealtime(checkbox.checked); });
  const state = make('span', 'Polling every 10 seconds.', 'realtime-state'); state.id = 'realtime-state'; state.setAttribute('role','status'); live.append(refresh, realtimeLabel, state);
  form.append(presetLabel, project.label, provider.label, from.label, to.label, submit, live); return form;
}
async function postLegacy(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aios-token': window.AIOS_TOKEN, 'x-correlation-id': crypto.randomUUID() }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})); if (!response.ok || value.ok === false) throw new Error(value.error?.message || value.error || 'The action failed.'); return value;
}
function refreshButton(label) { const button = make('button', label); button.type = 'button'; button.addEventListener('click', () => void renderCurrent()); return button; }
function forcedStatePanel(state) {
  const messages = { idle: 'Ready when you are.', pending: 'Your action is in progress…', disabled: 'This action is currently unavailable.', success: 'Your action completed successfully.', loading: 'Loading application information…', empty: 'There is nothing to show yet.', error: 'Unable to load this information.', fatal: 'This action cannot be completed. Check your access or contact an administrator.' };
  if (!messages[state]) return null;
  const panel = make('section', null, 'status'); panel.dataset.state = state; panel.setAttribute('role', state === 'error' || state === 'fatal' ? 'alert' : 'status'); panel.append(make('h2', state[0].toUpperCase() + state.slice(1)), make('p', messages[state]));
  if (state === 'error') panel.append(actionButton('Try again', { onClick: () => { const url = new URL(location.href); url.searchParams.delete('state'); history.replaceState({}, '', `${url.pathname}${url.search}`); void renderCurrent(); } }));
  return panel;
}
function renderBoundary(view) {
  if (view.state === 'empty') return emptyState('No application activity', view.message);
  if (view.state === 'error') {
    const region = feedback(view.message, { error: true }); region.dataset.recoverable = String(view.recoverable === true);
    if (view.recoverable) region.append(actionButton('Try again', { onClick: () => void renderCurrent() }));
    return region;
  }
  return make('p', `${view.data.activeRuns} active runs · ${view.data.queuedTasks} queued tasks`, 'status');
}

function missingDetailRecovery(error) {
  const recoveries = {
    TASK_NOT_FOUND: ['/app/operations/tasks', 'Return to task list'], RUN_NOT_FOUND: ['/app/operations/runs', 'Return to run list'],
    ALERT_NOT_FOUND: ['/app/observability/alerts', 'Return to alert list'], AUDIT_NOT_FOUND: ['/app/observability/alerts', 'Return to alert list'],
  };
  return recoveries[error?.code] ?? null;
}

async function renderCurrent() {
  const currentEpoch = ++epoch; cleanupRoute(); api.dispose(); activeOnboarding?.dispose(); activeOnboarding = null;
  scope = parseUrlScope(location.href); canonicalizeScope(); updateNav(); const url = new URL(location.href); const route = resolveAppRoute(url.pathname);
  if (!route) { const panel = make('section', null, 'card'); panel.append(make('h1', 'Page not found'), make('p', 'This application route is not available.')); const home = make('a', 'Return to overview'); home.href = inheritScope('/app', scope); panel.append(home); app.replaceChildren(panel); return; }
  document.title = `${route.id.replaceAll('-', ' ')} - MeridianOS`;
  if (route.id === 'setup' || route.id === 'setup-complete') { app.replaceChildren(); activeOnboarding = createOnboardingController({ root: app }); return activeOnboarding.render(); }
  if (route.id === 'foundation') {
    const card = make('section', null, 'card'); card.append(make('h1', 'Platform foundation'), make('p', 'Shared tokens, accessible primitives, typed boundaries, and action-state conventions support the operational application.'));
    app.replaceChildren(card); const status = await readApplicationStatus(); if (currentEpoch === epoch) card.append(renderBoundary(status)); return;
  }
  const controls = scopeControls(); const root = make('div', null, 'route-root'); root.setAttribute('aria-busy','true'); root.append(notice('Loading operational information…')); app.replaceChildren(controls, root);
  try {
    const modulePath = routeModule(route.id); if (!modulePath) throw new Error('This route has no application module.');
    const module = await import(modulePath); if (currentEpoch !== epoch) return;
    const context = {
      root, route, url, scope, api, navigate, announce, postLegacy,
      demo: url.searchParams.get('demo') === 'true',
      isCurrent: () => currentEpoch === epoch,
      setPending(value) { pendingMutations += value ? 1 : -1; pendingMutations = Math.max(0, pendingMutations); },
      registerDispose(dispose) { disposers.push(dispose); }, refresh: () => renderCurrent(), refreshButton,
    };
    await module.renderRoute(context); root.setAttribute('aria-busy','false'); const forced = forcedStatePanel(url.searchParams.get('state')); if (forced) root.append(forced);
    if (restoreRouteFocus) root.querySelector('h1')?.focus(); restoreRouteFocus = false;
  } catch (error) {
    if (currentEpoch !== epoch || error?.name === 'AbortError') return;
    root.setAttribute('aria-busy','false'); const panel = notice(error.message || 'Operational information is unavailable.', { error: true }); panel.append(make('p', 'Valid regions remain available after refresh; no mutation was applied by this failed read.'), refreshButton('Try again')); const recovery = missingDetailRecovery(error); if (recovery) { const destination = make('a', recovery[1]); destination.href = inheritScope(recovery[0], scope); panel.append(destination); } root.replaceChildren(panel);
  }
  const nextRealtimeScope = JSON.stringify(scope);
  if (realtimeScopeKey != null && realtimeScopeKey !== nextRealtimeScope) realtime?.setRealtime(localStorage.getItem(realtimeKey) === 'true');
  realtimeScopeKey = nextRealtimeScope;
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="/app"]'); if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(link.href);
});
addEventListener('popstate', () => { restoreRouteFocus = true; void renderCurrent(); });
themeButton.addEventListener('click', () => { const order=['system','light','dark']; const next=order[(order.indexOf(currentTheme())+1)%order.length]; localStorage.setItem(themeKey,next); applyTheme(next); });
addEventListener('beforeunload', () => { cleanupRoute(); api.dispose(); realtime?.stop(); });

applyTheme(currentTheme()); scope = parseUrlScope(location.href); canonicalizeScope();
realtime = createRealtimeCoordinator({
  url: () => `/api/operations/events?${serializeUrlScope(scope)}`,
  scopeKey: () => JSON.stringify(scope), refresh: () => renderCurrent(), hasPendingMutation: () => pendingMutations > 0,
  demo: new URL(location.href).searchParams.get('demo') === 'true',
  onState: ({ message }) => { const target = document.querySelector('#realtime-state'); if (target) target.textContent = message; announce(message); },
});
realtimeScopeKey = JSON.stringify(scope);
realtime.start({ realtime: localStorage.getItem(realtimeKey) === 'true' }); void renderCurrent();
