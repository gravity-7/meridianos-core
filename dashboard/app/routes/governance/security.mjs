import { make, page, table, notice, badge, instant, formPanel } from '../../shared/view-helpers.mjs';
import { managementRequest } from '../../shared/management-actions.mjs';

const REPORT_TYPES = [
  { type: 'soc2', title: 'SOC2 Type 2 Audit Trail', desc: 'Generate SOC2 draft reports with access, authentication, and policy change logs.' },
  { type: 'gdpr', title: 'GDPR Data Flows', desc: 'Data processing map, provider transit regions, and telemetry retention policies.' },
  { type: 'cost-allocation', title: 'Cost Allocation', desc: 'Per-department and per-project compute and model spend breakdown.' },
  { type: 'model-usage', title: 'Model Usage Analytics', desc: 'Model invocation success rates, latency distribution, and cost efficiency.' }
];

export async function renderRoute(context) {
  const audit = await managementRequest('/api/management/audit').catch(() => ({ events: [] })); if (!context.isCurrent()) return;
  const view = page('Security Posture & Autonomous Governance', 'Server-authorized management controls, sensitive action levers, compliance reporting, and immutable correlated audit evidence.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  let policy = {};
  try {
    const pRes = await fetch('/api/policy');
    policy = await pRes.json();
  } catch {}

  // ─── Section 1: Sensitive Action Levers & Governance ──────────────────────
  const govForm = make('form', null, 'management-form governance-form');
  const govGrid = make('div', null, 'scheduling-grid');

  const sel = (label, path, current, options) => {
    const grp = make('div', null, 'lev-group');
    const hd = make('div', null, 'lev-head');
    hd.append(make('span', '🛡', 'lev-icon'), make('strong', label, 'lev-title'));
    const sl = make('select', null, 'lev-select');
    for (const [val, txt] of options) {
      const o = make('option', txt);
      o.value = val;
      if (val === current) o.selected = true;
      sl.append(o);
    }
    grp.append(hd, sl);
    return { grp, sl, path };
  };

  const deploy = sel('Deploy Action', 'sensitive_actions.deploy', policy?.sensitive_actions?.deploy ?? 'block_and_ask', [
    ['block_and_ask', 'Block & Ask for Approval'],
    ['notify_only', 'Notify Only (Non-blocking)'],
    ['allow', 'Allow Autonomous Execution']
  ]);

  const send = sel('External Send', 'sensitive_actions.external_send', policy?.sensitive_actions?.external_send ?? 'block_and_ask', [
    ['block_and_ask', 'Block & Ask for Approval'],
    ['notify_only', 'Notify Only (Non-blocking)'],
    ['allow', 'Allow Autonomous Execution']
  ]);

  const spend = sel('Spend Money', 'sensitive_actions.spend_money', policy?.sensitive_actions?.spend_money ?? 'block_and_ask', [
    ['block_and_ask', 'Block & Ask for Approval'],
    ['notify_only', 'Notify Only (Non-blocking)'],
    ['allow', 'Allow Autonomous Execution']
  ]);

  const schema = sel('Schema Change', 'sensitive_actions.schema_change', policy?.sensitive_actions?.schema_change ?? 'block_and_ask', [
    ['block_and_ask', 'Block & Ask for Approval'],
    ['notify_only', 'Notify Only (Non-blocking)'],
    ['allow', 'Allow Autonomous Execution']
  ]);

  const autoMerge = sel('Auto-Merge PRs', 'auto_merge', policy?.auto_merge ?? 'verifier_gated', [
    ['founder_only', 'Founder-only (Strict Manual Review)'],
    ['peer_agent_review', 'Peer-agent Review Required'],
    ['verifier_gated', 'Verifier-gated Auto-Merge']
  ]);

  const escChan = sel('Escalation Channel', 'escalation.channel', policy?.escalation?.channel ?? 'digest', [
    ['digest', 'Digest File Only (.ai/escalations/)'],
    ['push', 'Push Webhook Only'],
    ['push_digest', 'Push Webhook + Digest File']
  ]);

  // Work Stealing Toggle
  const wsGroup = make('div', null, 'lev-group');
  const wsHead = make('div', null, 'lev-head');
  wsHead.append(make('span', '🔄', 'lev-icon'), make('strong', 'Work Stealing', 'lev-title'));
  const wsDesc = make('p', 'Allow idle agents to claim queued tasks assigned to other agents.', 'lev-desc');
  const wsLabel = make('label', null, 'checkbox-label');
  const wsCheck = make('input', null, 'custom-checkbox'); wsCheck.type = 'checkbox';
  wsCheck.checked = !!policy?.work_stealing;
  wsLabel.append(wsCheck, make('span', 'Enable cross-agent work stealing', 'checkbox-text'));
  wsGroup.append(wsHead, wsDesc, wsLabel);

  govGrid.append(deploy.grp, send.grp, spend.grp, schema.grp, autoMerge.grp, escChan.grp, wsGroup);

  const govActions = make('div', null, 'management-actions-bar');
  const govSaveBtn = make('button', 'Save Governance Policies', 'btn-primary'); govSaveBtn.type = 'submit';
  govActions.append(govSaveBtn);
  govForm.append(govGrid, govActions);

  govForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    govSaveBtn.disabled = true;
    govSaveBtn.textContent = 'Saving…';
    try {
      const payload = {
        'sensitive_actions.deploy': deploy.sl.value,
        'sensitive_actions.external_send': send.sl.value,
        'sensitive_actions.spend_money': spend.sl.value,
        'sensitive_actions.schema_change': schema.sl.value,
        'auto_merge': autoMerge.sl.value,
        'escalation.channel': escChan.sl.value,
        'work_stealing': wsCheck.checked
      };
      const res = await fetch('/api/policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      feedback.replaceChildren(notice('Governance policy updated successfully in .ai/policy.yaml.'));
    } catch (err) {
      feedback.replaceChildren(notice(`Governance save failed: ${err.message}`, { error: true }));
    } finally {
      govSaveBtn.disabled = false;
      govSaveBtn.textContent = 'Save Governance Policies';
    }
  });

  const govPanel = formPanel(document, {
    title: 'Safety & Sensitive Action Boundaries',
    icon: 'shield-check',
    subtitle: 'Govern high-risk actions, automated PR merges, and cross-agent task stealing permissions.'
  }, govForm);

  view.node.append(govPanel);

  // ─── Section 2: Compliance & Audit Reports Generator ──────────────────────
  const compCard = make('div', null, 'compliance-reports-panel');
  const compHead = make('div', null, 'tenant-card-head');
  compHead.append(make('strong', 'Compliance & Regulatory Reports', 'tenant-card-title'), badge('Export Ready', 'info'));
  const compDesc = make('p', 'Generate on-demand audit packages for compliance certification and cost allocation audits.', 'tenant-card-desc');
  
  const compGrid = make('div', null, 'compliance-cards-grid');
  const previewDrawer = make('div', null, 'report-preview-drawer');
  previewDrawer.style.display = 'none';
  const previewTitle = make('strong', 'Generated Report Preview', 'preview-title');
  const previewPre = make('pre', null, 'report-code-pre');
  const closePreviewBtn = make('button', 'Close Preview', 'btn-secondary');
  closePreviewBtn.addEventListener('click', () => { previewDrawer.style.display = 'none'; });
  previewDrawer.append(previewTitle, previewPre, closePreviewBtn);

  for (const report of REPORT_TYPES) {
    const rCard = make('div', null, 'compliance-report-card');
    const rTitle = make('strong', report.title, 'report-type-title');
    const rDesc = make('p', report.desc, 'report-type-desc');
    const rBtns = make('div', null, 'report-actions-row');
    
    const genJsonBtn = make('button', 'Generate JSON', 'btn-primary');
    const genCsvBtn = make('button', 'Export CSV', 'btn-secondary');

    const handleGen = async (fmt) => {
      previewDrawer.style.display = 'block';
      previewPre.textContent = `Generating ${report.title} (${fmt.toUpperCase()})…`;
      try {
        const res = await fetch(`/api/compliance/reports/${report.type}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ format: fmt })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = fmt === 'json' ? await res.json() : await res.text();
        previewPre.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      } catch (err) {
        previewPre.textContent = `Report generation error: ${err.message}\n(Requires active compliance ledger permissions)`;
      }
    };

    genJsonBtn.addEventListener('click', () => handleGen('json'));
    genCsvBtn.addEventListener('click', () => handleGen('csv'));

    rBtns.append(genJsonBtn, genCsvBtn);
    rCard.append(rTitle, rDesc, rBtns);
    compGrid.append(rCard);
  }

  compCard.append(compHead, compDesc, compGrid, previewDrawer);
  view.node.append(compCard);

  // ─── Section 3: Authorized Security Posture & Correlated Audit Trail ───────
  const posture = [
    ['Authentication', 'Server-verified dashboard session or bearer identity'],
    ['Reauthentication', 'Five-minute session-bound grant for destructive actions'],
    ['API keys', 'One-time disclosure, bounded rotation, immediate revoke'],
    ['Scope', 'Tenant/project scope derived on the server']
  ];
  const evidence = audit.events.filter((event) => /key|reauth|policy|security/i.test(event.intent)).map((event) => [
    instant(event.timestamp),
    event.intent,
    badge(event.outcome, event.outcome === 'allowed' ? 'ok' : event.outcome === 'denied' ? 'denied' : 'info'),
    event.correlationId
  ]);
  
  view.node.append(
    table(['Control', 'Status'], posture, 'Authorized security posture'),
    evidence.length ? table(['Timestamp', 'Intent', 'Outcome', 'Correlation'], evidence, 'Correlated security evidence') : notice('No security evidence is available in this authorized scope.'),
    feedback
  );

  context.root.replaceChildren(view.node);
}
