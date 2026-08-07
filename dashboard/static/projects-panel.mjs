/**
 * Projects Panel UI
 * Displays project cards with status indicators and action buttons
 */
import { esc as escapeHtml } from './dashboard-utils.mjs';

// Guards the document-level action-button click delegate below so re-mounting this panel (e.g.
// switching Admin sub-tabs away and back) never binds a second delegate and double-fires actions.
let _actionListenerWired = false;

export function renderProjectsPanel(projects = []) {
  return `
    <div class="projects-panel">
      <div class="panel-header">
        <h2>Projects</h2>
        <button id="create-project-btn" class="btn btn-primary">
          <span class="icon">+</span> Create Project
        </button>
      </div>

      <div class="projects-grid">
        ${projects.length === 0 ? renderEmptyState() : projects.map(renderProjectCard).join('')}
      </div>

      <div id="create-project-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Create New Project</h3>
            <button class="modal-close">&times;</button>
          </div>
          <form id="create-project-form">
            <div class="form-group">
              <label for="project-name">Project Name</label>
              <input type="text" id="project-name" name="name" required
                     pattern="[a-zA-Z0-9_-]{1,100}"
                     title="1-100 characters, alphanumeric, hyphens, and underscores only">
              <small>1-100 characters, alphanumeric, hyphens, and underscores</small>
            </div>

            <div class="form-group">
              <label for="project-template">Template</label>
              <select id="project-template" name="template">
                <option value="">No template</option>
              </select>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Project</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">📁</div>
      <h3>No Projects Yet</h3>
      <p>Create your first project to get started with MeridianOS.</p>
      <button id="create-first-project-btn" class="btn btn-primary">
        Create Your First Project
      </button>
    </div>
  `;
}

function renderProjectCard(project) {
  const statusClass = getStatusClass(project.status);
  const healthClass = getHealthClass(project.health_status);
  const statusIcon = getStatusIcon(project.status);
  const healthIcon = getHealthIcon(project.health_status);

  return `
    <div class="project-card" data-project-id="${project.id}">
      <div class="project-header">
        <h3 class="project-name">${escapeHtml(project.name)}</h3>
        <div class="project-badges">
          <span class="badge status ${statusClass}" title="Status: ${project.status}">
            ${statusIcon} ${capitalize(project.status)}
          </span>
          <span class="badge health ${healthClass}" title="Health: ${project.health_status}">
            ${healthIcon} ${capitalize(project.health_status)}
          </span>
        </div>
      </div>

      <div class="project-details">
        <div class="detail-row">
          <span class="label">Port:</span>
          <span class="value">${project.port}</span>
        </div>
        <div class="detail-row">
          <span class="label">Template:</span>
          <span class="value">${project.template || 'Blank'}</span>
        </div>
        <div class="detail-row">
          <span class="label">Created:</span>
          <span class="value">${formatDate(project.created_at)}</span>
        </div>
        ${project.restart_count > 0 ? `
          <div class="detail-row warning">
            <span class="label">Restarts:</span>
            <span class="value">${project.restart_count}</span>
          </div>
        ` : ''}
      </div>

      <div class="project-actions">
        ${project.status === 'stopped' ? `
          <button class="btn btn-sm btn-success action-start" data-project-id="${project.id}">
            ▶ Start
          </button>
        ` : ''}
        ${project.status === 'running' ? `
          <button class="btn btn-sm btn-warning action-stop" data-project-id="${project.id}">
            ⏸ Stop
          </button>
          <button class="btn btn-sm btn-info action-restart" data-project-id="${project.id}">
            🔄 Restart
          </button>
        ` : ''}
        ${project.status === 'error' ? `
          <button class="btn btn-sm btn-warning action-restart" data-project-id="${project.id}">
            🔄 Restart
          </button>
        ` : ''}
        <button class="btn btn-sm btn-secondary action-health" data-project-id="${project.id}">
          💓 Health
        </button>
        <button class="btn btn-sm btn-danger action-delete" data-project-id="${project.id}"
                ${project.status === 'running' ? 'disabled' : ''}>
          🗑 Delete
        </button>
      </div>
    </div>
  `;
}

function getStatusClass(status) {
  const classes = {
    running: 'success',
    stopped: 'secondary',
    error: 'danger',
    restarting: 'warning'
  };
  return classes[status] || 'secondary';
}

function getHealthClass(health) {
  const classes = {
    healthy: 'success',
    degraded: 'warning',
    down: 'danger',
    unknown: 'secondary'
  };
  return classes[health] || 'secondary';
}

function getStatusIcon(status) {
  const icons = {
    running: '▶',
    stopped: '⏸',
    error: '⚠',
    restarting: '🔄'
  };
  return icons[status] || '•';
}

function getHealthIcon(health) {
  const icons = {
    healthy: '💚',
    degraded: '💛',
    down: '❤',
    unknown: '⚪'
  };
  return icons[health] || '⚪';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/** Populates the Create Project modal's template <select> from the real template catalog
 *  (GET /api/projects/templates) — this used to be a hardcoded list of template ids
 *  (saas-web-app, mobile-app, ...) that didn't match any file the template loader actually
 *  serves, so picking one silently created a blank project instead of applying it. */
async function populateTemplateOptions() {
  const select = document.getElementById('project-template');
  if (!select) return;
  try {
    const response = await fetch('/api/projects/templates', {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const result = await response.json();
    if (!result.success) return;
    const templates = result.templates || [];
    select.innerHTML = '<option value="">No template</option>' +
      templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  } catch (error) {
    console.error('Failed to load templates for the create-project select:', error);
  }
}

/**
 * Initialize projects panel event handlers
 */
export function initProjectsPanel() {
  // Populated on-demand by the two "Create Project" buttons below and by
  // openCreateModalWithTemplate(), not unconditionally here — initProjectsPanel() runs twice per
  // tab-open (once synchronously, once again inside loadProjects() once real data arrives), and
  // firing the fetch both times let the two in-flight populate calls race: whichever resolved
  // last would reset the <select> and silently wipe out a value set by openCreateModalWithTemplate.

  // Create project button
  document.getElementById('create-project-btn')?.addEventListener('click', async () => {
    await populateTemplateOptions();
    document.getElementById('create-project-modal').classList.remove('hidden');
  });

  document.getElementById('create-first-project-btn')?.addEventListener('click', async () => {
    await populateTemplateOptions();
    document.getElementById('create-project-modal').classList.remove('hidden');
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('create-project-modal').classList.add('hidden');
    });
  });

  // Create project form
  document.getElementById('create-project-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.success) {
        document.getElementById('create-project-modal').classList.add('hidden');
        e.target.reset();
        loadProjects(); // Reload projects
        showNotification('Project created successfully', 'success');
      } else {
        showNotification(result.error || 'Failed to create project', 'error');
      }
    } catch (error) {
      showNotification('Failed to create project: ' + error.message, 'error');
    }
  });

  if (_actionListenerWired) return;
  _actionListenerWired = true;

  // Project action buttons
  document.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-project-id]');
    if (!actionBtn) return;

    const projectId = actionBtn.dataset.projectId;
    const action = actionBtn.classList.contains('action-start') ? 'start' :
                   actionBtn.classList.contains('action-stop') ? 'stop' :
                   actionBtn.classList.contains('action-restart') ? 'restart' :
                   actionBtn.classList.contains('action-delete') ? 'delete' :
                   actionBtn.classList.contains('action-health') ? 'health' : null;

    if (!action) return;

    e.preventDefault();

    try {
      let url, method;
      if (action === 'health') {
        url = `/api/projects/${projectId}/health`;
        method = 'GET';
      } else if (action === 'delete') {
        url = `/api/projects/${projectId}`;
        method = 'DELETE';
      } else {
        url = `/api/projects/${projectId}/${action}`;
        method = 'POST';
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });

      const result = await response.json();

      if (result.success) {
        if (action === 'health') {
          showNotification(`Health: ${result.status}`, 'info');
        } else {
          showNotification(`Project ${action}ed successfully`, 'success');
          loadProjects(); // Reload projects
        }
      } else {
        showNotification(result.error || `Failed to ${action} project`, 'error');
      }
    } catch (error) {
      showNotification(`Failed to ${action} project: ` + error.message, 'error');
    }
  });
}

/** Opens the Create Project modal with a template pre-selected (used by templates-panel.mjs's
 *  "Use Template" button, wired through admin-bootstrap.mjs since the two panels are separate
 *  Admin sub-tabs and don't share a container at the time the button is clicked). Re-populates
 *  the select itself rather than trusting initProjectsPanel()'s own (un-awaited, and possibly
 *  still in-flight from the tab switch that just happened) populateTemplateOptions() call — a
 *  <select>.value assignment to an id with no matching <option> yet silently no-ops instead of
 *  throwing, so a race here would look like "Use Template" just does nothing. */
export async function openCreateModalWithTemplate(templateId) {
  await populateTemplateOptions();
  const select = document.getElementById('project-template');
  if (select) select.value = templateId;
  document.getElementById('create-project-modal')?.classList.remove('hidden');
}

/**
 * Load projects from API
 */
export async function loadProjects() {
  try {
    const response = await fetch('/api/projects', {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });

    const result = await response.json();

    if (result.success) {
      const panel = document.querySelector('.projects-panel');
      if (panel) {
        panel.innerHTML = renderProjectsPanel(result.projects);
        initProjectsPanel();
      }
    }
  } catch (error) {
    console.error('Failed to load projects:', error);
  }
}

/**
 * Get auth token from localStorage
 */
function getAuthToken() {
  return localStorage.getItem('meridianos_token');
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}