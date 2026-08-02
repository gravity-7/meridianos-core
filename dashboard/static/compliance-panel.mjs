export class CompliancePanel {
  constructor(container, app) {
    this.container = container;
    this.app = app;
  }

  async render() {
    this.container.innerHTML = `
      <div class="compliance-panel">
        <div class="header-actions">
          <h2>Compliance & Reports</h2>
        </div>
        
        <div class="grid-2col">
          <div class="card">
            <h3>SOC2 Audit Trail</h3>
            <p>Generate SOC2 Type 2 draft reports with access, authentication, and change logs.</p>
            <div class="form-group" style="margin-top: 15px;">
              <button class="btn btn-primary" onclick="window.generateReport('soc2', 'json')">Generate JSON</button>
              <button class="btn" onclick="window.generateReport('soc2', 'csv')">Export CSV</button>
            </div>
          </div>
          
          <div class="card">
            <h3>GDPR Data Flows</h3>
            <p>Data processing map, provider regions, and retention policies.</p>
            <div class="form-group" style="margin-top: 15px;">
              <button class="btn btn-primary" onclick="window.generateReport('gdpr', 'json')">Generate JSON</button>
              <button class="btn" onclick="window.generateReport('gdpr', 'csv')">Export CSV</button>
            </div>
          </div>
          
          <div class="card">
            <h3>Cost Allocation</h3>
            <p>Per-department and per-project compute and model spend.</p>
            <div class="form-group" style="margin-top: 15px;">
              <button class="btn btn-primary" onclick="window.generateReport('cost-allocation', 'json')">Generate JSON</button>
              <button class="btn" onclick="window.generateReport('cost-allocation', 'csv')">Export CSV</button>
            </div>
          </div>
          
          <div class="card">
            <h3>Model Usage Analytics</h3>
            <p>Model invocation success rates, latency, and cost efficiency.</p>
            <div class="form-group" style="margin-top: 15px;">
              <button class="btn btn-primary" onclick="window.generateReport('model-usage', 'json')">Generate JSON</button>
              <button class="btn" onclick="window.generateReport('model-usage', 'csv')">Export CSV</button>
            </div>
          </div>
        </div>
        
        <div id="report-output-container" class="card" style="margin-top: 20px; display: none;">
          <h3>Report Output</h3>
          <pre id="report-output" style="background: var(--surface-0); padding: 15px; overflow-x: auto; font-size: 12px;"></pre>
        </div>
      </div>
    `;

    window.generateReport = async (type, format) => {
      try {
        const response = await fetch(`/api/compliance/reports/\${type}`, {
          method: 'POST',
          headers: {
            ...this.app.getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ format })
        });
        
        if (format === 'csv') {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `\${type}-report.csv`;
          a.click();
        } else {
          const data = await response.json();
          document.getElementById('report-output-container').style.display = 'block';
          document.getElementById('report-output').textContent = JSON.stringify(data.report, null, 2);
        }
      } catch (err) {
        alert('Failed to generate report: ' + err.message);
      }
    };
  }
}
