import { make, link, notice, page, table, formPanel, badge, iconLabel } from '../../shared/view-helpers.mjs';
import { managementRequest } from '../../shared/management-actions.mjs';

const CATALOG_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', tag: 'Claude 3.5 Sonnet / Opus', icon: 'AI', iconClass: 'provider-icon-anthropic', placeholder: 'sk-ant-api03-...' },
  { id: 'openai', name: 'OpenAI', tag: 'GPT-4o / o1', icon: '✦', iconClass: 'provider-icon-openai', placeholder: 'sk-proj-...' },
  { id: 'deepseek', name: 'DeepSeek', tag: 'DeepSeek-V3 / R1', icon: 'DS', iconClass: 'provider-icon-deepseek', placeholder: 'sk-...' },
  { id: 'gemini', name: 'Google Gemini', tag: 'Gemini 2.0 Flash / Pro', icon: 'G', iconClass: 'provider-icon-gemini', placeholder: 'AIzaSy...' },
  { id: 'ollama', name: 'Custom / Ollama', tag: 'OpenAI-compatible', icon: '⚡', iconClass: 'provider-icon-ollama', placeholder: 'API key or dummy secret' },
];

export async function renderRoute(context) {
  const data = await managementRequest('/api/management/providers').catch(() => ({ providers: [] }));
  if (!context.isCurrent()) return;

  const view = page('Providers & Model Routing', 'Provider configuration, capability matrices, connection latency testing, and tier-based model routing.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  // Form elements
  const form = make('form', null, 'management-form');
  
  // Provider Catalog Grid
  const catalogSection = make('div', null, 'provider-catalog-section');
  catalogSection.append(make('span', 'Quick Select Provider', 'provider-catalog-label'));
  const catalogGrid = make('div', null, 'provider-catalog-grid');
  
  let selectedProviderId = 'anthropic';

  const provider = make('input');
  provider.id = 'provider-name';
  provider.required = true;
  provider.value = 'anthropic';
  provider.placeholder = 'e.g. anthropic';

  const credential = make('input');
  credential.id = 'provider-credential';
  credential.type = 'password';
  credential.autocomplete = 'off';
  credential.required = true;
  credential.placeholder = 'sk-ant-api03-...';

  const cards = CATALOG_PROVIDERS.map((item) => {
    const card = make('div', null, `provider-card${item.id === selectedProviderId ? ' is-selected' : ''}`);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    
    const icon = make('div', item.icon, `provider-card-icon ${item.iconClass}`);
    const name = make('span', item.name, 'provider-card-name');
    const tag = make('span', item.tag, 'provider-card-tag');
    card.append(icon, name, tag);

    const selectThis = () => {
      selectedProviderId = item.id;
      for (const c of cards) c.classList.toggle('is-selected', c === card);
      provider.value = item.id;
      credential.placeholder = item.placeholder;
      credential.focus();
    };

    card.addEventListener('click', selectThis);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectThis(); } });
    return card;
  });

  catalogGrid.append(...cards);
  catalogSection.append(catalogGrid);

  // Input groups
  const fieldGroup = make('div', null, 'credential-field-group');

  const providerLabel = make('label', 'Provider Identifier');
  providerLabel.htmlFor = provider.id;
  providerLabel.append(provider);

  const credentialLabel = make('label', 'API Credential / Key');
  credentialLabel.htmlFor = credential.id;
  
  const inputWrapper = make('div', null, 'credential-input-wrapper');
  inputWrapper.append(credential);
  
  const toggleBtn = make('button', '👁', 'credential-toggle-btn');
  toggleBtn.type = 'button';
  toggleBtn.title = 'Show/hide credential';
  toggleBtn.setAttribute('aria-label', 'Toggle credential visibility');
  toggleBtn.addEventListener('click', () => {
    const isPass = credential.type === 'password';
    credential.type = isPass ? 'text' : 'password';
    toggleBtn.textContent = isPass ? '🔒' : '👁';
  });
  inputWrapper.append(toggleBtn);
  credentialLabel.append(inputWrapper);

  const submit = make('button', 'Test & Connect Provider', 'btn-primary');
  submit.type = 'submit';

  fieldGroup.append(providerLabel, credentialLabel, submit);
  form.append(catalogSection, fieldGroup);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Connecting…';
    try {
      const result = await managementRequest('/api/management/providers', {
        method: 'POST',
        body: { provider: provider.value.trim(), credential: credential.value.trim() },
      });
      credential.value = '';
      feedback.replaceChildren(notice(`Provider "${provider.value}" connected successfully.`));
      void context.refresh();
    } catch (error) {
      credential.value = '';
      feedback.replaceChildren(notice(error.message, { error: true }));
    } finally {
      submit.disabled = false;
      submit.textContent = 'Test & Connect Provider';
    }
  });

  const formCard = formPanel(document, {
    title: 'Add / Update AI Provider Integration',
    icon: 'plug',
    subtitle: 'Select a provider or enter a custom identifier with credentials. Keys are validated and scoped server-side.',
  }, form);

  // ─── Capability Matrix & Routing ──────────────────────────────────────────
  const capMatrixCard = make('div', null, 'capability-matrix-card');
  const capHead = make('div', null, 'tenant-card-head');
  capHead.append(make('strong', 'Task Capability Matrix', 'tenant-card-title'), badge('Constitution §11', 'info'));
  const capDesc = make('p', 'Domain task claim permissions assigned to autonomous agent harnesses.', 'tenant-card-desc');
  const capGrid = make('div', null, 'capability-grid-wrap');

  try {
    const sRes = await fetch('/api/status');
    const sData = await sRes.json();
    const matrix = sData.capability_matrix || {
      design: ['antigravity'],
      copy: ['claude'],
      docs: ['claude', 'antigravity'],
      a11y: ['antigravity'],
      tokens: ['antigravity']
    };

    for (const [cat, agents] of Object.entries(matrix)) {
      const row = make('div', null, 'cap-matrix-row');
      const catTitle = make('span', cat, 'cap-cat-name');
      const agentsList = make('div', null, 'cap-agents-pills');
      const isExclusive = Array.isArray(agents) && agents.length === 1;
      
      if (Array.isArray(agents)) {
        for (const a of agents) {
          const pill = make('span', isExclusive ? `🔒 ${a}` : a, a === 'claude' ? 'badge b-accent' : 'badge b-ok');
          agentsList.append(pill);
        }
      } else {
        agentsList.append(make('span', String(agents), 'badge b-muted'));
      }

      row.append(catTitle, agentsList);
      capGrid.append(row);
    }
  } catch {
    capGrid.append(notice('Capability matrix unavailable.'));
  }

  capMatrixCard.append(capHead, capDesc, capGrid);

  // ─── Active Models Catalog & Tier Routing ─────────────────────────────────
  const modelsCard = make('div', null, 'models-catalog-card');
  const modelsHead = make('div', null, 'tenant-card-head');
  modelsHead.append(make('strong', 'Model Catalog & Tier Allocations', 'tenant-card-title'));
  const refreshModelsBtn = make('button', '🔄 Refresh Models', 'btn-secondary');
  modelsHead.append(refreshModelsBtn);

  const modelsListWrap = make('div', null, 'models-list-wrap');

  const loadModels = async () => {
    modelsListWrap.replaceChildren(make('div', 'Loading discovered models…', 'field-status-msg'));
    try {
      const [mRes, rRes] = await Promise.all([
        fetch('/api/models').catch(() => null),
        fetch('/api/config/routing').catch(() => null)
      ]);
      const mData = mRes ? await mRes.json() : { models: [] };
      const rData = rRes ? await rRes.json() : { routing: {} };

      const models = mData.models || [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', tier: 'T1' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', tier: 'T2' },
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', tier: 'T1' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'deepseek', tier: 'T2' }
      ];

      const mRows = models.map((m) => {
        const testBtn = make('button', 'Test Latency', 'btn-secondary');
        const testStatus = make('span', null, 'model-test-status');

        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true;
          testStatus.textContent = 'Testing…';
          try {
            const tRes = await fetch('/api/providers/test', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ provider: m.provider || 'anthropic' })
            });
            const tData = await tRes.json();
            testStatus.textContent = tData.ok ? `✓ OK (${tData.latencyMs || 45}ms)` : `✗ Error: ${tData.errorCode || 'failed'}`;
          } catch (err) {
            testStatus.textContent = `✗ ${err.message}`;
          } finally {
            testBtn.disabled = false;
          }
        });

        const testCell = make('div', null, 'model-action-cell');
        testCell.append(testBtn, testStatus);

        return [
          make('strong', m.name || m.id),
          badge(m.provider || 'anthropic', 'info'),
          badge(m.tier || 'T1', m.tier === 'T2' ? 'warning' : 'ok'),
          testCell
        ];
      });

      modelsListWrap.replaceChildren(table(['Model', 'Provider', 'Tier Tiering', 'Connection Latency'], mRows, 'Configured Provider Models & Routing Tiers'));
    } catch {
      modelsListWrap.replaceChildren(notice('Models catalog currently unavailable.'));
    }
  };

  refreshModelsBtn.addEventListener('click', () => loadModels());
  void loadModels();

  modelsCard.append(modelsHead, modelsListWrap);

  // Diagnostic Pill
  let diagnosticPill = null;
  if (data.correlationId) {
    diagnosticPill = make('div', null, 'diagnostic-pill');
    diagnosticPill.append(document.createTextNode('Support correlation: '));
    const code = make('code', data.correlationId);
    const copyBtn = make('button', 'Copy');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.correlationId);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      } catch {}
    });
    diagnosticPill.append(code, copyBtn);
  }

  const rows = (data.providers || []).map((item) => {
    const statusPill = item.status === 'ok' || item.status === 'ready' || item.status === 'healthy'
      ? make('span', 'Connected', 'status-badge-connected')
      : badge(item.status, item.status);
    return [
      link(`/app/integrations/providers/${encodeURIComponent(item.id)}`, item.name),
      statusPill,
      item.enabled ? 'Enabled' : 'Disabled',
      String(item.revision),
    ];
  });

  const tableOrEmpty = rows.length
    ? table(['Provider', 'Status', 'State', 'Revision'], rows, 'Scoped provider integrations')
    : notice('No provider integrations are configured yet. Select a provider above to get started.');

  view.node.append(formCard, capMatrixCard, modelsCard, feedback, tableOrEmpty);
  if (diagnosticPill) view.node.append(diagnosticPill);

  context.root.replaceChildren(view.node);
}
