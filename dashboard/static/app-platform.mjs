const routes = {
  '/app': { title: 'Application overview', text: 'The stable MeridianOS application foundation is ready.' },
  '/app/foundation': { title: 'Platform foundation', text: 'Shared tokens, accessible primitives, typed boundaries, and action-state conventions belong here.' },
};
const key = 'meridianos-ui-theme';
const app = document.querySelector('#app');
const themeButton = document.querySelector('#theme');
function applyTheme(theme) { document.documentElement.dataset.theme = theme; themeButton.textContent = `Theme: ${theme}`; }
function currentTheme() { return localStorage.getItem(key) || 'system'; }
function render() { const route = routes[location.pathname]; const view = route || { title: 'Page not found', text: 'This application route is not available. Return to the application overview.' }; app.innerHTML = `<section class="card"><h1>${view.title}</h1><p>${view.text}</p>${route ? '' : '<p><a href="/app">Go to overview</a></p>'}</section>`; }
document.addEventListener('click', (event) => { const link = event.target.closest('a[href^="/app"]'); if (!link || event.metaKey || event.ctrlKey) return; event.preventDefault(); history.pushState({}, '', link.href); render(); });
addEventListener('popstate', render);
themeButton.addEventListener('click', () => { const order=['system','light','dark']; const next=order[(order.indexOf(currentTheme())+1)%order.length]; localStorage.setItem(key,next); applyTheme(next); });
applyTheme(currentTheme()); render();
