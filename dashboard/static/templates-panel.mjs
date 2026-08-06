/**
 * Project Templates browser (GET /api/projects/templates, per-user JWT auth via auth-client.mjs —
 * see requireAuth in dashboard/server.mjs). Rewritten from an original class-based version
 * authored against a `this.app.getAuthHeaders()`/`this.app.navigate()` SPA shell that doesn't
 * exist anywhere in this codebase — this follows the plain render()+init() function pattern used
 * by projects-panel.mjs instead. "Use Template" hands the template id to an `onUseTemplate`
 * callback (wired by admin-bootstrap.mjs to switch to the Projects sub-tab and open its Create
 * Project modal pre-filled) rather than a non-existent app router.
 */
import { authFetch } from './auth-client.mjs';

export function renderTemplatesPanel() {
  return `
    <div class="templates-panel">
      <div class="panel-header">
        <h2>Project Templates</h2>
        <button id="refresh-templates-btn" class="btn">Refresh</button>
      </div>

      <div id="templates-loading" class="loading">Loading templates...</div>
      <div id="templates-error" class="error-message" style="display: none;"></div>

      <div id="templates-grid" class="templates-grid" style="display: none;"></div>
    </div>
  `;
}

export function initTemplatesPanel(container, { onUseTemplate } = {}) {
  container.querySelector('#refresh-templates-btn').addEventListener('click', () => loadTemplates(container, onUseTemplate));
  loadTemplates(container, onUseTemplate);
}

async function loadTemplates(container, onUseTemplate) {
  const loading = container.querySelector('#templates-loading');
  const errorMsg = container.querySelector('#templates-error');
  const grid = container.querySelector('#templates-grid');

  loading.style.display = 'block';
  errorMsg.style.display = 'none';
  grid.style.display = 'none';

  try {
    const response = await authFetch('/api/projects/templates');
    if (!response) throw new Error('Your session expired — switch tabs and sign back in.');

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to load templates');
    }

    renderTemplateGrid(grid, data.templates || [], onUseTemplate);

    loading.style.display = 'none';
    grid.style.display = 'grid';
  } catch (error) {
    loading.style.display = 'none';
    errorMsg.textContent = error.message;
    errorMsg.style.display = 'block';
  }
}

function renderTemplateGrid(grid, templates, onUseTemplate) {
  if (templates.length === 0) {
    grid.innerHTML = '<div class="empty-state">No templates found.</div>';
    return;
  }

  grid.innerHTML = templates.map((template) => `
    <div class="template-card card" data-id="${template.id}">
      <h3>${escapeHtml(template.name)}</h3>
      <div class="template-meta">
        <span class="badge">${template.agentCount} Agents</span>
        <span class="badge">${template.categoryCount} Categories</span>
      </div>
      <div class="template-actions" style="margin-top: 15px;">
        <button class="btn btn-primary use-template-btn" data-id="${template.id}">Use Template</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.use-template-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      if (typeof onUseTemplate === 'function') onUseTemplate(id);
    });
  });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
