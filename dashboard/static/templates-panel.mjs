export class TemplatesPanel {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.templates = [];
  }

  async render() {
    this.container.innerHTML = `
      <div class="templates-panel">
        <div class="header-actions">
          <h2>Project Templates</h2>
          <button id="refresh-templates-btn" class="btn">Refresh</button>
        </div>
        
        <div id="templates-loading" class="loading">Loading templates...</div>
        <div id="templates-error" class="error-message" style="display: none;"></div>
        
        <div id="templates-grid" class="templates-grid" style="display: none;">
          <!-- Template cards will be inserted here -->
        </div>
      </div>
    `;

    this.container.querySelector('#refresh-templates-btn').addEventListener('click', () => this.loadTemplates());

    await this.loadTemplates();
  }

  async loadTemplates() {
    const loading = this.container.querySelector('#templates-loading');
    const errorMsg = this.container.querySelector('#templates-error');
    const grid = this.container.querySelector('#templates-grid');

    loading.style.display = 'block';
    errorMsg.style.display = 'none';
    grid.style.display = 'none';

    try {
      const response = await fetch('/api/projects/templates', {
        headers: this.app.getAuthHeaders()
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load templates');
      }

      this.templates = data.templates || [];
      this.renderTemplateGrid();
      
      loading.style.display = 'none';
      grid.style.display = 'grid';
    } catch (error) {
      loading.style.display = 'none';
      errorMsg.textContent = error.message;
      errorMsg.style.display = 'block';
    }
  }

  renderTemplateGrid() {
    const grid = this.container.querySelector('#templates-grid');
    
    if (this.templates.length === 0) {
      grid.innerHTML = '<div class="empty-state">No templates found.</div>';
      return;
    }

    grid.innerHTML = this.templates.map(template => `
      <div class="template-card card" data-id="${template.id}">
        <h3>${this.escapeHtml(template.name)}</h3>
        <div class="template-meta">
          <span class="badge">${template.agentCount} Agents</span>
          <span class="badge">${template.categoryCount} Categories</span>
        </div>
        <div class="template-actions" style="margin-top: 15px;">
          <button class="btn btn-primary use-template-btn" data-id="${template.id}">Use Template</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.use-template-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        this.useTemplate(id);
      });
    });
  }

  useTemplate(templateId) {
    // Navigate to projects panel and open create modal with this template selected
    this.app.navigate('projects', { action: 'create', templateId });
  }

  escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
