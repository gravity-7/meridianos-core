import { readApplicationStatus } from './app-boundary.mjs';
import { actionButton, emptyState, feedback } from './ui-primitives.mjs';

const routes = {
  '/app': { title: 'Application overview', text: 'The stable MeridianOS application foundation is ready.' },
  '/app/foundation': { title: 'Platform foundation', text: 'Shared tokens, accessible primitives, typed boundaries, and action-state conventions belong here.' },
};
const themeKey = 'meridianos-ui-theme';
const app = document.querySelector('#app');
const themeButton = document.querySelector('#theme');
const make = (tag, text) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text });
function applyTheme(theme) { document.documentElement.dataset.theme = theme; themeButton.textContent = `Theme: ${theme}`; }
function currentTheme() { return localStorage.getItem(themeKey) || 'system'; }
function actionState() { return new URLSearchParams(location.search).get('state') || 'content'; }
function status(state) {
  const messages = { idle: 'Ready when you are.', pending: 'Your action is in progress…', disabled: 'This action is currently unavailable.', success: 'Your action completed successfully.', loading: 'Loading application information…', empty: 'There is nothing to show yet.', error: 'Unable to load this information.' };
  if (!messages[state]) return null;
  const panel = make('section'); panel.className = 'status'; panel.dataset.state = state; panel.setAttribute('role', state === 'error' ? 'alert' : 'status');
  panel.append(make('h2', state[0].toUpperCase() + state.slice(1)), make('p', messages[state]));
  if (state === 'error') { const retry = actionButton('Try again', { onClick: () => { history.replaceState({}, '', location.pathname); render(); } }); panel.append(retry); }
  return panel;
}
function renderBoundary(view) {
  if (view.state === 'empty') return emptyState('No application activity', view.message);
  if (view.state === 'error') return feedback(view.message, { error: true });
  const detail = make('p', `${view.data.activeRuns} active runs · ${view.data.queuedTasks} queued tasks`); detail.className = 'status'; return detail;
}
async function render() {
  const pathname = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, '') : location.pathname;
  const route = routes[pathname];
  const view = route || { title: 'Page not found', text: 'This application route is not available. Return to the application overview.' };
  document.title = `${view.title} - MeridianOS`;
  const card = make('section'); card.className = 'card'; card.append(make('h1', view.title), make('p', view.text));
  if (!route) { const link = make('a', 'Go to overview'); link.href = '/app'; card.append(link); }
  app.replaceChildren(card); const forcedState = status(actionState());
  if (forcedState) return app.append(forcedState);
  const loading = status('loading'); app.append(loading);
  const requestedPath = location.pathname;
  const statusView = await readApplicationStatus();
  if (location.pathname === requestedPath) app.replaceChildren(card, renderBoundary(statusView));
}
document.addEventListener('click', (event) => { const link = event.target.closest('a[href^="/app"]'); if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); history.pushState({}, '', link.href); render(); });
addEventListener('popstate', render);
themeButton.addEventListener('click', () => { const order=['system','light','dark']; const next=order[(order.indexOf(currentTheme())+1)%order.length]; localStorage.setItem(themeKey,next); applyTheme(next); });
applyTheme(currentTheme()); render();
