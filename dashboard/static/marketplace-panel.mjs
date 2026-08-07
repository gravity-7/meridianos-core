/**
 * Plugin Marketplace UI (T059/T060) — browse the 6 pre-built connectors (+ any community ones
 * seeded into the registry), install/configure/test them. Mirrors api-keys-panel.mjs's
 * render+init pattern: a pure render function returning an HTML string, and an init function
 * wiring DOM event listeners against the SAME per-boot dashboard token every other panel uses.
 */
import { esc as escapeHtml } from './dashboard-utils.mjs';

export function renderMarketplacePanel(plugins = []) {
  return `
    <div class="marketplace-panel">
      <div class="panel-header">
        <h2>Plugin Marketplace</h2>
      </div>
      <div class="marketplace-list">
        ${plugins.length === 0 ? renderEmptyState() : plugins.map(renderPluginCard).join('')}
      </div>

      <div id="plugin-config-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3 id="plugin-config-title">Configure Plugin</h3>
            <button class="modal-close">&times;</button>
          </div>
          <form id="plugin-config-form">
            <div id="plugin-config-fields"></div>
            <div id="plugin-test-result"></div>
            <div class="form-actions">
              <button type="button" id="plugin-test-btn" class="btn btn-secondary">Test Connection</button>
              <button type="submit" class="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `<div class="empty-state"><div class="empty-state-icon">🧩</div><h3>No plugins available</h3></div>`;
}

function renderPluginCard(plugin) {
  return `
    <div class="plugin-card" data-plugin-id="${plugin.id}">
      <div class="plugin-card-header">
        <h3>${escapeHtml(plugin.name)}</h3>
        <span class="badge">${plugin.is_installed ? (plugin.is_enabled ? 'Enabled' : 'Installed') : 'Not installed'}</span>
      </div>
      <p class="plugin-description">${escapeHtml(plugin.description ?? '')}</p>
      <div class="plugin-meta">
        <span class="plugin-author">by ${escapeHtml(plugin.author ?? 'Unknown')}</span>
        ${renderRating(plugin)}
        <span class="plugin-installs">${plugin.install_count ?? 0} installs</span>
      </div>
      <div class="plugin-actions">
        ${!plugin.is_installed ? `<button class="btn btn-primary action-install" data-plugin-id="${plugin.id}">Install</button>` : ''}
        ${plugin.is_installed ? `<button class="btn btn-secondary action-configure" data-plugin-id="${plugin.id}">Configure</button>` : ''}
        ${plugin.is_installed ? `<button class="btn btn-sm ${plugin.is_enabled ? 'btn-secondary action-disable' : 'btn-primary action-enable'}" data-plugin-id="${plugin.id}">${plugin.is_enabled ? 'Disable' : 'Enable'}</button>` : ''}
        ${plugin.is_installed ? `<button class="btn btn-sm btn-danger action-uninstall" data-plugin-id="${plugin.id}">Uninstall</button>` : ''}
      </div>
    </div>
  `;
}

/** Built-in plugins get a static rating display; community plugins (published via
 *  `node cli.mjs plugin publish`) get a clickable widget so a viewer can rate them
 *  (POST /api/plugins/:id/rate — see the rate-star handler in initMarketplacePanel). */
function renderRating(plugin) {
  if (plugin.built_in) {
    const stars = '★'.repeat(Math.round(plugin.rating ?? 0)) + '☆'.repeat(5 - Math.round(plugin.rating ?? 0));
    return `<span class="plugin-rating" title="${plugin.rating ?? 0} / 5">${stars}</span>`;
  }
  const widgetStars = [1, 2, 3, 4, 5].map((n) => `<span class="rate-star" data-plugin-id="${plugin.id}" data-stars="${n}">${n <= Math.round(plugin.rating ?? 0) ? '★' : '☆'}</span>`).join('');
  return `<span class="plugin-rating-widget" title="Rate this plugin">${widgetStars}</span>`;
}

function dashToken() {
  return (typeof AIOS_TOKEN !== 'undefined' && AIOS_TOKEN) || window.__AIOS_TOKEN__ || '';
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-aios-token': dashToken() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function reloadPanel() {
  const result = await api('/api/plugins');
  const panel = document.querySelector('.marketplace-panel');
  if (panel && result.ok) {
    panel.outerHTML = renderMarketplacePanel(result.plugins);
    wireModalClose();
  }
}

/** Fetch the plugin catalog and render+wire it into `container` — the entry point admin-bootstrap.mjs
 *  calls when the Marketplace sub-tab is selected. */
export async function mountMarketplacePanel(container) {
  const result = await api('/api/plugins');
  container.innerHTML = renderMarketplacePanel(result.ok ? result.plugins : []);
  initMarketplacePanel();
}

// Guards the document-level delegate below so re-mounting this panel (e.g. switching Admin
// sub-tabs away and back, or reloadPanel() re-rendering after an action) never binds a second
// delegate — each installed/enabled/etc. click would otherwise fire once per prior binding.
let _delegateWired = false;

export function initMarketplacePanel() {
  if (_delegateWired) return wireModalClose();
  _delegateWired = true;

  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('rate-star')) {
      const pluginId = e.target.dataset.pluginId;
      const stars = Number(e.target.dataset.stars);
      await api(`/api/plugins/${pluginId}/rate`, { method: 'POST', body: { stars } });
      await reloadPanel();
      return;
    }

    const id = e.target.dataset?.pluginId;
    if (!id) return;

    if (e.target.classList.contains('action-install')) {
      await api(`/api/plugins/${id}/install`, { method: 'POST' });
      await reloadPanel();
    } else if (e.target.classList.contains('action-uninstall')) {
      if (!confirm('Uninstall this plugin?')) return;
      await api(`/api/plugins/${id}/uninstall`, { method: 'POST' });
      await reloadPanel();
    } else if (e.target.classList.contains('action-enable')) {
      await api(`/api/plugins/${id}/enable`, { method: 'POST' });
      await reloadPanel();
    } else if (e.target.classList.contains('action-disable')) {
      await api(`/api/plugins/${id}/disable`, { method: 'POST' });
      await reloadPanel();
    } else if (e.target.classList.contains('action-configure')) {
      openConfigModal(id);
    }
  });

  wireModalClose();
}

function wireModalClose() {
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => document.getElementById('plugin-config-modal')?.classList.add('hidden'));
  });
}

async function openConfigModal(pluginId) {
  const modal = document.getElementById('plugin-config-modal');
  document.getElementById('plugin-config-title').textContent = `Configure ${pluginId}`;
  const { config } = await api(`/api/plugins/${pluginId}/config`);
  // Field values render into a double-quoted `value="..."` attribute below — escapeHtml (imported
  // from dashboard-utils.mjs) must escape `"`, not just `&`/`<`/`>`, or a config value containing a
  // literal quote breaks out of the attribute (010 US1 found this live, not hypothetical).
  const fieldsHtml = Object.entries(config ?? {}).map(([key, value]) => `
    <div class="form-group">
      <label for="cfg-${key}">${escapeHtml(key)}</label>
      <input type="text" id="cfg-${key}" name="${escapeHtml(key)}" value="${escapeHtml(value)}">
    </div>
  `).join('') || '<p>No fields configured yet — enter your credentials below.</p>';
  document.getElementById('plugin-config-fields').innerHTML = fieldsHtml;
  modal.dataset.pluginId = pluginId;
  modal.classList.remove('hidden');

  document.getElementById('plugin-test-btn').onclick = async () => {
    const resultEl = document.getElementById('plugin-test-result');
    resultEl.textContent = 'Testing...';
    const result = await api(`/api/plugins/${pluginId}/test`, { method: 'POST' });
    resultEl.textContent = result.success ? `✓ ${result.message}` : `✗ ${result.message ?? result.error}`;
    resultEl.className = result.success ? 'success' : 'error';
  };

  document.getElementById('plugin-config-form').onsubmit = async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.target));
    await api(`/api/plugins/${pluginId}/config`, { method: 'PUT', body: { values } });
    modal.classList.add('hidden');
  };
}
