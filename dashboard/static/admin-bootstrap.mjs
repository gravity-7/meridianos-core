/**
 * admin-bootstrap — wires the six previously-dangling admin panel modules (Projects, Templates,
 * API Keys, Billing, Compliance, Marketplace) into a single Admin workspace with an internal
 * sub-tab strip, following the same lazy-load-on-first-open pattern as team-bootstrap.mjs /
 * settings-workspace-bootstrap.mjs. Loaded lazily by index.html's showAdminWorkspace() the first
 * time the operator opens the Admin tab.
 *
 * Projects/Templates/API Keys/Billing/Compliance all require the same per-user JWT session as
 * the Team workspace (auth-client.mjs) — Marketplace does not (it's gated by the dashboard-wide
 * x-aios-token instead, see marketplace-panel.mjs), but it lives here too since it's the same
 * kind of admin surface and gating the whole tab behind sign-in keeps this module simple.
 */
import { renderLoginPrompt, verifySession, clearSession } from './auth-client.mjs';
import { renderProjectsPanel, initProjectsPanel, loadProjects, openCreateModalWithTemplate } from './projects-panel.mjs';
import { renderTemplatesPanel, initTemplatesPanel } from './templates-panel.mjs';
import { renderApiKeysPanel, initApiKeysPanel, loadApiTokens } from './api-keys-panel.mjs';
import { renderBillingPanel, initBillingPanel } from './billing-panel.mjs';
import { renderCompliancePanel, initCompliancePanel } from './compliance-panel.mjs';
import { mountMarketplacePanel } from './marketplace-panel.mjs';
import { esc as escapeHtml } from './dashboard-utils.mjs';

const TABS = [
  { id: 'projects', label: '📁 Projects' },
  { id: 'templates', label: '📄 Templates' },
  { id: 'apiKeys', label: '🔑 API Keys' },
  { id: 'billing', label: '💰 Billing' },
  { id: 'compliance', label: '📋 Compliance' },
  { id: 'marketplace', label: '🧩 Marketplace' },
];

let container = null;
let activeTab = 'projects';

export async function initAdminWorkspace(root) {
  container = root;
  const user = await verifySession();
  if (!user) {
    renderLoginPrompt(container, () => initAdminWorkspace(root));
    return;
  }
  renderShell(user);
}

function renderShell(user) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      ${TABS.map((t) => `<button class="admin-tab-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}" style="font-size:12px;padding:6px 12px">${t.label}</button>`).join('')}
      <span style="flex:1"></span>
      <span style="font-size:12px;color:var(--text-muted)">signed in as ${escapeHtml(user.email)}</span>
      <button id="adminSignOutBtn" class="btn btn-sm">Sign out</button>
    </div>
    <div id="adminTabContent"></div>
  `;

  container.querySelector('#adminSignOutBtn').addEventListener('click', () => {
    clearSession();
    initAdminWorkspace(container);
  });

  container.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });

  selectTab(activeTab);
}

async function selectTab(id) {
  activeTab = id;
  container.querySelectorAll('.admin-tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === id));

  const content = container.querySelector('#adminTabContent');
  content.innerHTML = '';

  switch (id) {
    case 'projects':
      content.innerHTML = renderProjectsPanel([]);
      initProjectsPanel();
      await loadProjects();
      break;
    case 'templates':
      content.innerHTML = renderTemplatesPanel();
      initTemplatesPanel(content, {
        onUseTemplate: async (templateId) => {
          await selectTab('projects');
          await openCreateModalWithTemplate(templateId);
        },
      });
      break;
    case 'apiKeys':
      content.innerHTML = renderApiKeysPanel([]);
      initApiKeysPanel();
      await loadApiTokens();
      break;
    case 'billing':
      content.innerHTML = renderBillingPanel();
      initBillingPanel();
      break;
    case 'compliance':
      content.innerHTML = renderCompliancePanel();
      initCompliancePanel(content);
      break;
    case 'marketplace':
      await mountMarketplacePanel(content);
      break;
  }
}
