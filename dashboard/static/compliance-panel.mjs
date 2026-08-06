/**
 * Compliance & Reports panel — SOC2/GDPR/cost-allocation/model-usage report generation
 * (POST /api/compliance/reports/{type}, both require the per-user JWT session auth-client.mjs
 * already provides, see requireAuth in dashboard/server.mjs). Rewritten from an original
 * class-based version authored against a `this.app.getAuthHeaders()`/`this.app.navigate()` SPA
 * shell that doesn't exist anywhere in this codebase (index.html has no router/app object) — this
 * follows the plain render()+init() function pattern used by projects-panel.mjs / api-keys-panel.mjs
 * instead, and fixes an escaped `\${type}` template literal that meant every report request went
 * to the literal URL `/api/compliance/reports/${type}` instead of the actual report type.
 */
import { authFetch } from './auth-client.mjs';

const REPORT_TYPES = [
  { type: 'soc2', title: 'SOC2 Audit Trail', description: 'Generate SOC2 Type 2 draft reports with access, authentication, and change logs.' },
  { type: 'gdpr', title: 'GDPR Data Flows', description: 'Data processing map, provider regions, and retention policies.' },
  { type: 'cost-allocation', title: 'Cost Allocation', description: 'Per-department and per-project compute and model spend.' },
  { type: 'model-usage', title: 'Model Usage Analytics', description: 'Model invocation success rates, latency, and cost efficiency.' },
];

export function renderCompliancePanel() {
  return `
    <div class="compliance-panel">
      <div class="panel-header">
        <h2>Compliance &amp; Reports</h2>
      </div>

      <div class="grid-2col">
        ${REPORT_TYPES.map((r) => `
          <div class="card">
            <h3>${r.title}</h3>
            <p>${r.description}</p>
            <div class="form-group" style="margin-top: 15px;">
              <button class="btn btn-primary" data-report-type="${r.type}" data-report-format="json">Generate JSON</button>
              <button class="btn" data-report-type="${r.type}" data-report-format="csv">Export CSV</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div id="report-output-container" class="card" style="margin-top: 20px; display: none;">
        <h3>Report Output</h3>
        <pre id="report-output" style="background: var(--surface-0); padding: 15px; overflow-x: auto; font-size: 12px;"></pre>
      </div>
    </div>
  `;
}

export function initCompliancePanel(container) {
  container.querySelectorAll('[data-report-type]').forEach((btn) => {
    btn.addEventListener('click', () => generateReport(container, btn.dataset.reportType, btn.dataset.reportFormat));
  });
}

async function generateReport(container, type, format) {
  try {
    const response = await authFetch(`/api/compliance/reports/${type}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format }),
    });
    if (!response) return alert('Your session expired — switch tabs and sign back in.');

    if (format === 'csv') {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await response.json();
      if (!data.success) return alert('Failed to generate report: ' + (data.error || 'unknown error'));
      container.querySelector('#report-output-container').style.display = 'block';
      container.querySelector('#report-output').textContent = JSON.stringify(data.report, null, 2);
    }
  } catch (err) {
    alert('Failed to generate report: ' + err.message);
  }
}
