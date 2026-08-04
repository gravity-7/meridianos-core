/**
 * Community Plugins UI (T077) — the subset of the marketplace catalog NOT bundled with core
 * (`!plugin.built_in`), i.e. anything a developer published via `node cli.mjs plugin publish`.
 * Reuses the same `/api/plugins` data and install/enable/configure actions as marketplace-panel.mjs
 * (see that file) — this panel only differs in which plugins it shows and that it lets a viewer
 * leave a star rating.
 */
import { initMarketplacePanel } from './marketplace-panel.mjs';

export function renderCommunityPluginsPanel(plugins = []) {
  const community = plugins.filter((p) => !p.built_in);
  return `
    <div class="community-plugins-panel marketplace-panel">
      <div class="panel-header">
        <h2>Community Plugins</h2>
        <p class="panel-subtitle">Published by developers via <code>node cli.mjs plugin publish</code></p>
      </div>
      <div class="marketplace-list">
        ${community.length === 0 ? renderEmptyState() : community.map(renderCommunityCard).join('')}
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `<div class="empty-state"><div class="empty-state-icon">🌐</div><h3>No community plugins published yet</h3><p>Be the first — see docs/plugin-development.md.</p></div>`;
}

function renderCommunityCard(plugin) {
  const stars = [1, 2, 3, 4, 5].map((n) => `<span class="rate-star" data-plugin-id="${plugin.id}" data-stars="${n}">${n <= Math.round(plugin.rating ?? 0) ? '★' : '☆'}</span>`).join('');
  return `
    <div class="plugin-card" data-plugin-id="${plugin.id}">
      <div class="plugin-card-header">
        <h3>${escapeHtml(plugin.name)}</h3>
        <span class="badge">${plugin.is_installed ? (plugin.is_enabled ? 'Enabled' : 'Installed') : 'Not installed'}</span>
      </div>
      <p class="plugin-description">${escapeHtml(plugin.description ?? '')}</p>
      <div class="plugin-meta">
        <span class="plugin-author">by ${escapeHtml(plugin.author ?? 'Unknown')}</span>
        <span class="plugin-version">v${escapeHtml(plugin.version ?? '1.0.0')}</span>
        <span class="plugin-installs">${plugin.install_count ?? 0} installs</span>
      </div>
      <div class="plugin-rating-widget" title="Rate this plugin">${stars}</div>
      <div class="plugin-actions">
        ${!plugin.is_installed ? `<button class="btn btn-primary action-install" data-plugin-id="${plugin.id}">Install</button>` : ''}
        ${plugin.is_installed ? `<button class="btn btn-secondary action-configure" data-plugin-id="${plugin.id}">Configure</button>` : ''}
        ${plugin.is_installed ? `<button class="btn btn-sm btn-danger action-uninstall" data-plugin-id="${plugin.id}">Uninstall</button>` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function dashToken() {
  return (typeof AIOS_TOKEN !== 'undefined' && AIOS_TOKEN) || window.__AIOS_TOKEN__ || '';
}

/** Wires the shared install/configure/uninstall handlers (marketplace-panel.mjs) PLUS the
 *  star-rating widget this panel adds. */
export function initCommunityPluginsPanel() {
  initMarketplacePanel();

  document.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('rate-star')) return;
    const pluginId = e.target.dataset.pluginId;
    const stars = Number(e.target.dataset.stars);
    await fetch(`/api/plugins/${pluginId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-aios-token': dashToken() },
      body: JSON.stringify({ stars }),
    });
    const result = await (await fetch('/api/plugins', { headers: { 'x-aios-token': dashToken() } })).json();
    const panel = document.querySelector('.community-plugins-panel');
    if (panel && result.ok) {
      panel.outerHTML = renderCommunityPluginsPanel(result.plugins);
      initCommunityPluginsPanel();
    }
  });
}
