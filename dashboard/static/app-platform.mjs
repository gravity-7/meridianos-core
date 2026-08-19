import { readApplicationStatus } from './app-boundary.mjs';
import { createOnboardingController } from './onboarding-flow.mjs';
import { actionButton, emptyState, feedback } from './ui-primitives.mjs';
import { resolveAppRoute, routeModule } from '/static/app/route-registry.mjs';
import { parseUrlScope, serializeUrlScope, inheritScope, presetScope } from '/static/app/shared/operational-scope.mjs';
import { createOperationsApi } from '/static/app/shared/operations-api.mjs';
import { createRealtimeCoordinator } from '/static/app/shared/realtime-coordinator.mjs';
import { make, notice } from '/static/app/shared/view-helpers.mjs';
import { applyThemePreference, parseThemePreference } from '/static/app/shared/theme-preference.mjs';

const themeKey = 'meridianos-ui-theme'; const realtimeKey = 'meridianos-operational-realtime';
const app = document.querySelector('#app'); const announcer = document.querySelector('#announcer'); const themeButton = document.querySelector('#theme'); const searchTrigger = document.querySelector('#search-trigger'); const sidebar = document.querySelector('#app-sidebar'); const sidebarToggle = document.querySelector('#sidebar-toggle'); const sidebarScrim = document.createElement('div'); sidebarScrim.className = 'sidebar-scrim'; sidebarScrim.setAttribute('aria-hidden', 'true'); document.querySelector('.app-layout').prepend(sidebarScrim); sidebarScrim.addEventListener('click', () => { sidebar?.classList.remove('is-open'); sidebarScrim.classList.remove('is-active'); sidebarScrim.classList.remove('is-active'); sidebarToggle?.setAttribute('aria-expanded', 'false'); });
let scope = parseUrlScope(location.href); let epoch = 0; let activeOnboarding = null; let pendingMutations = 0; let realtime = null; let disposers = [];
let realtimeScopeKey = null;
let restoreRouteFocus = false;
if (matchMedia('(max-width: 1024px) and (min-width: 761px)').matches) { sidebar?.classList.add('is-collapsed'); }
let scopeNotice = null;
let activeRouteId = null; let activeControls = null; let activeRoot = null;
const api = createOperationsApi({ token: window.AIOS_TOKEN, getScope: () => scope });

function applyTheme(theme) { const selected = applyThemePreference(theme); themeButton.textContent = `Theme: ${selected}`; themeButton.setAttribute('aria-label', `Change color theme; current ${selected}`); }
function currentTheme() { return parseThemePreference(localStorage.getItem(themeKey)); }
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
function updateNav() { for (const link of document.querySelectorAll('.app-header a, .app-sidebar a')) if (!link.pathname.startsWith('/app/setup') && !link.pathname.startsWith('/legacy')) { link.href = scopedDestination(link.pathname === '/app' ? '/' : link.pathname); const isActive = link.pathname === '/' ? location.pathname === '/' : location.pathname.startsWith(link.pathname); link.classList.toggle('is-active', isActive); link.setAttribute('aria-current', isActive ? 'page' : 'false'); } }
function announce(message) { announcer.textContent = ''; requestAnimationFrame(() => { announcer.textContent = message; }); }
let searchDialog = null; let searchInput = null; let searchResults = null; let searchStatus = null; let searchRestore = null; let searchTimer = null; let searchIndex = -1;
function closeSearch() { if (!searchDialog) return; if (typeof searchDialog.close === 'function' && searchDialog.open) searchDialog.close(); else searchDialog.removeAttribute('open'); searchDialog.remove(); searchDialog = null; searchInput = null; searchResults = null; searchStatus = null; searchIndex = -1; clearTimeout(searchTimer); searchRestore?.focus?.(); searchRestore = null; }
function renderSearchResults(items) {
  if (!searchResults || !searchStatus) return;
  searchResults.replaceChildren(); searchIndex = -1;
  searchStatus.textContent = `${items.length} result${items.length === 1 ? '' : 's'}. Use arrow keys and Enter to open.`; announce(searchStatus.textContent);
  for (const item of items) {
    const link = document.createElement('a'); link.href = item.href; link.className = 'search-result'; link.dataset.searchIndex = String(searchResults.children.length); link.setAttribute('role', 'option');
    const label = document.createElement('strong'); label.textContent = item.label; const detail = document.createElement('span'); detail.textContent = ` ${item.description || item.kind}`; link.append(label, detail);
    link.addEventListener('click', () => closeSearch()); searchResults.append(link);
  }
}
async function loadSearchResults(query) {
  if (!searchInput || query.trim().length === 0) { renderSearchResults([]); return; }
  searchStatus.textContent = 'Searching authorized records…';
  try { const data = await api.read('/search', { q: query }); if (searchInput?.value !== query) return; renderSearchResults(data.results ?? []); }
  catch (error) { if (!searchStatus) return; searchResults.replaceChildren(); searchStatus.textContent = error.code === 'SEARCH_QUERY_INVALID' ? 'Enter a shorter search.' : 'Search is unavailable. Continue with navigation.'; announce(searchStatus.textContent); }
}
function moveSearchFocus(delta) { const items = [...(searchResults?.querySelectorAll('a') ?? [])]; if (!items.length) return; searchIndex = (searchIndex + delta + items.length) % items.length; items[searchIndex].focus(); items.forEach((item, index) => item.setAttribute('aria-selected', String(index === searchIndex))); }
function openSearch() {
  if (searchDialog) { searchInput?.focus(); return; }
  searchRestore = document.activeElement; searchDialog = document.createElement('dialog'); searchDialog.className = 'search-dialog'; searchDialog.setAttribute('aria-labelledby', 'search-title'); searchDialog.setAttribute('aria-describedby', 'search-status');
  const title = document.createElement('h2'); title.id = 'search-title'; title.textContent = 'Search MeridianOS'; const close = document.createElement('button'); close.type = 'button'; close.className = 'search-close'; close.textContent = 'Close'; close.addEventListener('click', closeSearch);
  searchInput = document.createElement('input'); searchInput.type = 'search'; searchInput.placeholder = 'Search tasks, runs, providers, or routes'; searchInput.setAttribute('aria-label', 'Search routes and records');
  searchStatus = document.createElement('p'); searchStatus.id = 'search-status'; searchStatus.className = 'search-status'; searchStatus.setAttribute('role', 'status'); searchResults = document.createElement('div'); searchResults.className = 'search-results'; searchResults.setAttribute('role', 'listbox');
  const header = document.createElement('div'); header.className = 'search-header'; header.append(title, close); searchDialog.append(header, searchInput, searchStatus, searchResults); document.body.append(searchDialog);
  if (typeof searchDialog.showModal === 'function') searchDialog.showModal(); else searchDialog.setAttribute('open', '');
  searchInput.focus();
  searchInput.addEventListener('input', () => { clearTimeout(searchTimer); const query = searchInput.value; searchTimer = setTimeout(() => void loadSearchResults(query), 120); });
  searchDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); moveSearchFocus(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSearchFocus(-1); }
    else if (event.key === 'Tab') {
      const focusable = [close, searchInput, ...(searchResults?.querySelectorAll('a') ?? [])]; const current = focusable.indexOf(document.activeElement);
      if (current < 0 || (event.shiftKey ? current === 0 : current === focusable.length - 1)) { event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus(); }
    }
  });
}
function cleanupRoute() { for (const dispose of disposers.splice(0)) { try { dispose(); } catch (error) { console.error('Operational route cleanup failed.', error); } } }
function navigate(target, { replace = false } = {}) {
  const url = new URL(target, location.origin); const pathname = url.pathname === '/app' ? '/' : url.pathname; const destination = pathname.startsWith('/app/setup') ? `${pathname}${url.search}` : scopedDestination(`${pathname}${url.search}${url.hash}`);
  if (replace) history.replaceState({}, '', destination);
  else history.pushState({}, '', destination);
  restoreRouteFocus = true; void renderCurrent();
}
function scopeControls() {
  const form = make('form', null, 'scope-controls'); form.setAttribute('aria-label', 'Operational filters and time scope');
  const field = (labelText, name, value, type = 'text') => { const label = make('label', labelText); const input = make('input'); input.name = name; input.type = type; input.value = value ?? ''; label.append(input); return { label, input }; };
  
  const presetLabel = make('label', 'Time preset'); const preset = make('select'); preset.name = 'preset';
  for (const [value,label] of [['custom','Exact interval'],['1h','Last hour'],['24h','Last 24 hours'],['7d','Last 7 days'],['30d','Last 30 days']]) { const option = make('option', label); option.value = value; preset.append(option); }
  presetLabel.append(preset);
  const requestedPreset = new URL(location.href).searchParams.get('preset');
  preset.value = ['1h', '24h', '7d', '30d'].includes(requestedPreset) ? requestedPreset : 'custom';
  
  const project = field('Project', 'project', scope.project); project.input.placeholder = 'All projects';
  const provider = field('Provider', 'provider', scope.provider); provider.input.placeholder = 'All providers';
  const from = field('From (UTC)', 'from', scope.from.slice(0,16), 'datetime-local');
  const to = field('To (UTC, exclusive)', 'to', scope.to.slice(0,16), 'datetime-local');
  
  const row1 = make('div', null, 'scope-row-filters');
  row1.append(presetLabel, project.label, provider.label, from.label, to.label);
  
  const submit = make('button', 'Apply scope'); submit.type = 'submit'; submit.className = 'btn-primary';
  const refresh = make('button', 'Refresh now'); refresh.type = 'button';
  const realtimeLabel = make('label', '', 'realtime-label'); const checkbox = make('input'); checkbox.type = 'checkbox';
  checkbox.checked = localStorage.getItem(realtimeKey) === 'true';
  const demo = new URL(location.href).searchParams.get('demo') === 'true'; checkbox.disabled = demo;
  realtimeLabel.append(checkbox, document.createTextNode(demo ? ' Realtime disabled for demo data' : ' Use realtime updates'));
  const state = make('span', scopeNotice ?? 'Polling every 10 seconds.', 'realtime-state'); state.id = 'realtime-state'; state.setAttribute('role','status');
  
  const row2 = make('div', null, 'scope-row-actions');
  
  // MER-UI-023: Add "Reset" button
  const reset = make('button', 'Reset to default'); reset.type = 'button'; reset.className = 'btn-reset';
  reset.addEventListener('click', () => {
    scope = presetScope('24h', { timezone: 'UTC' });
    navigate(location.pathname);
  });
  
  row2.append(submit, reset, refresh, realtimeLabel, state);
  
  const toolbar = make('div', null, 'dashboard-toolbar');
  
  form.append(row1, row2);
  toolbar.append(form);
  
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const tempScope = presetScope(preset.value, { ...scope });
    from.input.value = tempScope.from.slice(0,16);
    to.input.value = tempScope.to.slice(0,16);
  });
  
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const next = { from: new Date(`${from.input.value}:00Z`).toISOString(), to: new Date(`${to.input.value}:00Z`).toISOString(), project: project.input.value.trim() || null, provider: provider.input.value.trim() || null, timezone: 'UTC' };
      if (Date.parse(next.from) >= Date.parse(next.to)) throw new Error('From must be before To.');
      scope = next; scopeNotice = 'Scope applied.';
      const params = serializeUrlScope(scope);
      if (preset.value !== 'custom') params.set('preset', preset.value);
      navigate(`${location.pathname}?${params}`);
    } catch (error) { announce(error.message); }
  });
  
  refresh.addEventListener('click', () => { void (async () => { refresh.disabled = true; state.textContent = 'Refreshing.'; try { const refreshed = await realtime?.refreshNow(); const target = document.querySelector('#realtime-state'); if (target) target.textContent = refreshed ? 'Refresh complete.' : 'Refresh is unavailable while updates are paused.'; announce(target?.textContent ?? 'Refresh complete.'); } catch { state.textContent = 'Refresh failed. Try again.'; announce(state.textContent); } finally { refresh.disabled = false; } })(); });
  checkbox.addEventListener('change', () => { localStorage.setItem(realtimeKey, String(checkbox.checked)); realtime?.setRealtime(checkbox.checked); });
  
  return toolbar;
}
function refreshButton(label) { const button = make('button', label); button.type = 'button'; button.addEventListener('click', () => void renderCurrent({ preserveView: true })); return button; }
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

async function renderCurrent({ preserveView = false } = {}) {
  const currentEpoch = ++epoch; cleanupRoute(); api.dispose(); activeOnboarding?.dispose(); activeOnboarding = null;
  scope = parseUrlScope(location.href); canonicalizeScope(); updateNav(); const url = new URL(location.href); const route = resolveAppRoute(url.pathname === '/' ? '/app' : url.pathname);
  if (!route) { activeRouteId = null; activeControls = null; activeRoot = null; const panel = make('section', null, 'card'); panel.append(make('h1', 'Page not found'), make('p', 'This application route is not available.')); const home = make('a', 'Return to overview'); home.href = inheritScope('/', scope); panel.append(home); app.replaceChildren(panel); return; }
  document.title = `${route.id.replaceAll('-', ' ')} - MeridianOS`;
  if (route.id === 'setup' || route.id === 'setup-complete') { activeRouteId = null; activeControls = null; activeRoot = null; app.replaceChildren(); activeOnboarding = createOnboardingController({ root: app }); return activeOnboarding.render(); }
  if (route.id === 'foundation') {
    activeRouteId = null; activeControls = null; activeRoot = null;
    const card = make('section', null, 'card'); card.append(make('h1', 'Platform foundation'), make('p', 'Shared tokens, accessible primitives, typed boundaries, and action-state conventions support the operational application.'));
    app.replaceChildren(card); const status = await readApplicationStatus(); if (currentEpoch === epoch) card.append(renderBoundary(status)); return;
  }
  const canReuseShell = preserveView && activeRouteId === route.id && activeControls?.isConnected && activeRoot?.isConnected && app.contains(activeRoot);
  const controls = canReuseShell ? activeControls : scopeControls();
  const root = canReuseShell ? activeRoot : make('div', null, 'route-root');
  const preservedScrollY = canReuseShell ? window.scrollY : null;
  root.setAttribute('aria-busy', 'true');
  if (!canReuseShell) { root.append(notice('Loading operational information…')); app.replaceChildren(controls, root); }
  try {
    const modulePath = routeModule(route.id); if (!modulePath) throw new Error('This route has no application module.');
    const module = await import(modulePath); if (currentEpoch !== epoch) return;
    const context = {
      root, route, url, scope, api, navigate, announce, postLegacy,
      demo: url.searchParams.get('demo') === 'true',
      isCurrent: () => currentEpoch === epoch,
      setPending(value) { pendingMutations += value ? 1 : -1; pendingMutations = Math.max(0, pendingMutations); },
      registerDispose(dispose) { disposers.push(dispose); }, refresh: () => renderCurrent({ preserveView: true }), refreshButton,
    };
    await module.renderRoute(context);
    if (preservedScrollY != null && window.scrollY !== preservedScrollY) window.scrollTo(0, preservedScrollY);
    root.setAttribute('aria-busy','false'); const forced = forcedStatePanel(url.searchParams.get('state')); if (forced) root.append(forced);
    if (restoreRouteFocus) root.querySelector('h1')?.focus(); restoreRouteFocus = false;
  } catch (error) {
    if (currentEpoch !== epoch || error?.name === 'AbortError') return;
    root.setAttribute('aria-busy','false'); const panel = notice(error.message || 'Operational information is unavailable.', { error: true }); panel.append(make('p', 'Valid regions remain available after refresh; no mutation was applied by this failed read.'), refreshButton('Try again')); const recovery = missingDetailRecovery(error); if (recovery) { const destination = make('a', recovery[1]); destination.href = inheritScope(recovery[0], scope); panel.append(destination); } root.replaceChildren(panel);
  }
  const nextRealtimeScope = JSON.stringify(scope);
  activeRouteId = route.id; activeControls = controls; activeRoot = root;
  if (realtimeScopeKey != null && realtimeScopeKey !== nextRealtimeScope) realtime?.setRealtime(localStorage.getItem(realtimeKey) === 'true');
  realtimeScopeKey = nextRealtimeScope;
  if (scopeNotice) { const target = document.querySelector('#realtime-state'); if (target) target.textContent = scopeNotice; announce(scopeNotice); scopeNotice = null; }
}

document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || link.origin !== location.origin || link.hasAttribute('download') || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.pathname.startsWith('/legacy') || link.pathname.startsWith('/app/setup')) return;
    event.preventDefault(); navigate(link.href);
});
searchTrigger?.addEventListener('click', openSearch);
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } });
addEventListener('popstate', () => { restoreRouteFocus = true; void renderCurrent(); });
themeButton.addEventListener('click', () => { const order=['system','light','dark']; const next=order[(order.indexOf(currentTheme())+1)%order.length]; applyTheme(next); announce(`Theme changed to ${next}.`); });
function syncSidebarDisclosure() { if (matchMedia('(max-width: 760px)').matches) sidebarToggle?.setAttribute('aria-expanded', String(sidebar?.classList.contains('is-open') === true)); else sidebarToggle?.setAttribute('aria-expanded', 'true'); }
syncSidebarDisclosure(); addEventListener('resize', syncSidebarDisclosure);
sidebarToggle?.addEventListener('click', () => { const expanded = sidebarToggle.getAttribute('aria-expanded') === 'true'; sidebarToggle.setAttribute('aria-expanded', String(!expanded)); if (matchMedia('(max-width: 760px)').matches) { const open = !expanded; sidebar?.classList.toggle('is-open', open); sidebarScrim.classList.toggle('is-active', open); } else { sidebar?.classList.toggle('is-collapsed', expanded); } });
sidebar?.addEventListener('click', (event) => { const link = event.target.closest('a'); if (!link) return; if (matchMedia('(max-width: 760px)').matches) { sidebar?.classList.remove('is-open'); sidebarToggle?.setAttribute('aria-expanded', 'false'); } });
sidebar?.addEventListener('keydown', (event) => { if (event.key === 'Escape' && matchMedia('(max-width: 760px)').matches) { sidebar?.classList.remove('is-open'); sidebarToggle?.setAttribute('aria-expanded', 'false'); sidebarToggle?.focus(); } });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && matchMedia('(max-width: 760px)').matches && sidebar?.classList.contains('is-open')) { sidebar.classList.remove('is-open'); sidebarScrim.classList.remove('is-active'); sidebarToggle?.setAttribute('aria-expanded', 'false'); sidebarToggle?.focus(); } });
addEventListener('beforeunload', () => { cleanupRoute(); api.dispose(); realtime?.stop(); });

applyTheme(currentTheme()); scope = parseUrlScope(location.href); canonicalizeScope();
realtime = createRealtimeCoordinator({
  url: () => `/api/operations/events?${serializeUrlScope(scope)}`,
  scopeKey: () => JSON.stringify(scope), refresh: () => renderCurrent({ preserveView: true }), hasPendingMutation: () => pendingMutations > 0,
  demo: new URL(location.href).searchParams.get('demo') === 'true',
  onState: ({ message }) => { const target = document.querySelector('#realtime-state'); if (target) target.textContent = message; announce(message); },
});
realtimeScopeKey = JSON.stringify(scope);
realtime.start({ realtime: localStorage.getItem(realtimeKey) === 'true' }); void renderCurrent();
