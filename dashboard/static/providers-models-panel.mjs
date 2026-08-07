/**
 * providers-models-panel — 009 Dashboard Modernization (US2/FR-004). Ports the legacy board's
 * capability matrix, providers list (+ add-provider form, connection test), and models list
 * (+ refresh) into one Settings & Observability workspace panel. Each section keeps fetching its
 * own endpoint independently (`/api/providers`, `/api/models`, `/api/status` for the capability
 * matrix) exactly as the legacy functions did — this is a mechanical port of self-contained
 * fetch+render logic, not a re-architecture; no shared LEVERS/task-modal coupling like
 * task-workflow-panel.mjs had to work around.
 */
import { registerPanel } from './settings-workspace.mjs';

async function fetchJson(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function escapeHtml(unsafe) {
  return (unsafe ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Capability matrix ───────────────────────────────────────────────────────

async function renderCapabilityMatrix(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let body;
  try {
    body = await fetchJson('/api/status');
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Capability matrix unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }
  const matrix = body.capability_matrix;
  const workStealing = body.work_stealing;
  if (!matrix || typeof matrix !== 'object') { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no capability_matrix in policy.yaml</div>'; return; }
  const entries = Object.entries(matrix);
  if (!entries.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">matrix is empty</div>'; return; }
  const agentPill = (name) => name === 'claude'
    ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;padding:3px 8px;border-radius:999px;background:var(--bg-accent);color:var(--text-accent);border:1px solid rgba(59,130,246,0.2)">claude</span>'
    : '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;padding:3px 8px;border-radius:999px;background:var(--bg-success);color:var(--text-success);border:1px solid rgba(22,163,74,0.2)">antigravity</span>';
  const lockIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);flex:none"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  let htm = '<div style="display:grid;grid-template-columns:minmax(100px,auto) 1fr;gap:6px 16px;align-items:center">';
  for (const [cat, agents] of entries) {
    const isExclusive = Array.isArray(agents) && agents.length === 1;
    const pills = Array.isArray(agents) ? agents.map(agentPill).join(' ') : escapeHtml(String(agents));
    htm += `<div style="font-size:13px;font-weight:500;color:var(--text-secondary);display:flex;align-items:center;gap:4px">${isExclusive ? lockIcon : ''}${escapeHtml(cat)}</div>`;
    htm += `<div style="display:flex;flex-wrap:wrap;gap:4px">${pills}</div>`;
  }
  htm += '</div>';
  htm += `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text-secondary)">work stealing</span><span class="badge ${workStealing ? 'b-ok' : 'b-muted'}">${workStealing ? 'on' : 'off'}</span><span style="font-size:11px;color:var(--text-muted)">${workStealing ? "idle agent may claim the other's eligible tasks" : 'agents only claim their own tasks'}</span></div>`;
  el.innerHTML = htm;
}

// ─── Providers ────────────────────────────────────────────────────────────────

const KNOWN_PROVIDERS = [
  { name: 'anthropic', display: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY' },
  { name: 'openai', display: 'OpenAI', keyEnv: 'OPENAI_API_KEY' },
  { name: 'deepseek', display: 'DeepSeek', keyEnv: 'DEEPSEEK_KEY' },
  { name: 'openrouter', display: 'OpenRouter', keyEnv: 'OPENROUTER_KEY' },
  { name: 'ollama', display: 'Ollama', keyEnv: 'OLLAMA_HOST' },
  { name: 'groq', display: 'Groq', keyEnv: 'GROQ_API_KEY' },
  { name: 'together', display: 'Together', keyEnv: 'TOGETHER_API_KEY' },
  { name: 'fireworks', display: 'Fireworks', keyEnv: 'FIREWORKS_API_KEY' },
  { name: 'google-ai', display: 'Google Gemini', keyEnv: 'GOOGLE_AI_API_KEY' },
  { name: 'mistral', display: 'Mistral', keyEnv: 'MISTRAL_API_KEY' },
  { name: 'cohere', display: 'Cohere', keyEnv: 'COHERE_API_KEY' },
  { name: 'perplexity', display: 'Perplexity', keyEnv: 'PPLX_API_KEY' },
  { name: 'xai', display: 'xAI', keyEnv: 'XAI_API_KEY' },
  { name: 'azure-openai', display: 'Azure OpenAI', keyEnv: 'AZURE_OPENAI_API_KEY' },
  { name: 'aws-bedrock', display: 'AWS Bedrock', keyEnv: 'AWS_ACCESS_KEY_ID' },
];

async function testProvider(name, root) {
  try {
    const j = await fetchJson('/api/providers/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: name }) });
    const status = j.ok ? '✓ OK' : '✗ FAILED';
    const detail = j.errorCode ? ` [${j.errorCode}] ${j.errorMessage || ''}` : '';
    alert(`${name}: ${status} (${j.latencyMs}ms)${detail}`);
  } catch (err) {
    alert(`${name}: Test failed — ${err.message}`);
  }
}

function providersListHtml(providers) {
  if (!providers || !providers.length) {
    return '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no providers configured — run <code>node gateway/cli.mjs provider add --auto</code> to auto-detect</div>';
  }
  const healthDot = (status) => {
    const color = status === 'ok' ? 'var(--text-success)' : status === 'degraded' ? 'var(--text-warning)' : status === 'down' ? 'var(--text-danger)' : 'var(--text-muted)';
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px" title="${escapeHtml(status)}"></span>`;
  };
  let htm = '<div style="display:grid;grid-template-columns:auto">';
  for (const p of providers) {
    const h = p.health || {};
    const status = h.status || 'unknown';
    const latency = h.latencyMs != null ? h.latencyMs + 'ms' : '—';
    htm += `<div class="row" style="align-items:center">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${healthDot(status)}
          <span style="font-size:13px;font-weight:500">${escapeHtml(p.displayName || p.name)}</span>
          <span class="model" style="font-size:10px">${escapeHtml(p.wire)}</span>
          <span class="badge ${status === 'ok' ? 'b-ok' : status === 'degraded' ? 'b-warn' : status === 'down' ? 'b-danger' : 'b-muted'}">${escapeHtml(status)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(p.baseUrl || 'local')} · latency: ${latency}</div>
      </div>
      <button class="pm-test-provider" data-name="${escapeHtml(p.name)}" style="font-size:11px;padding:4px 8px;margin-left:8px">Test Connection</button>
    </div>`;
  }
  htm += '</div>';
  return htm;
}

async function refreshProviders(root) {
  const list = root.querySelector('.pm-providers-list');
  try {
    const j = await fetchJson('/api/providers');
    list.innerHTML = providersListHtml(j.ok ? j.providers : null);
    if (!j.ok) list.innerHTML = '<div style="font-size:12px;color:var(--text-danger)">Failed to load providers</div>';
  } catch (err) {
    list.innerHTML = `<div style="font-size:12px;color:var(--text-danger)">Failed to load providers: ${escapeHtml(err.message)}</div>`;
  }
  list.querySelectorAll('.pm-test-provider').forEach((btn) => {
    btn.addEventListener('click', () => testProvider(btn.dataset.name, root));
  });
}

function renderProvidersSection(root) {
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:500;color:var(--text-secondary);flex:1">managed via policy.yaml</div>
      <button class="pm-toggle-add-provider" style="font-size:11px;padding:4px 8px">＋ Add Provider</button>
    </div>
    <div class="pm-add-provider-form" style="display:none;padding:.6rem;margin-bottom:.4rem;background:var(--bg-secondary);border-radius:6px">
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:140px">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Provider</label>
          <select class="pm-add-prov-select" style="width:100%;padding:4px 6px;font-size:12px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
            <option value="">— select provider —</option>
            ${KNOWN_PROVIDERS.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.display)} (${escapeHtml(p.keyEnv)})</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;min-width:140px">
          <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">API Key</label>
          <input class="pm-add-prov-key" type="password" placeholder="sk-…" style="width:100%;padding:4px 6px;font-size:12px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
        </div>
        <button class="pm-submit-add-provider" style="font-size:11px;padding:6px 12px;white-space:nowrap">Save</button>
        <button class="pm-cancel-add-provider" style="font-size:11px;padding:6px 8px;white-space:nowrap;background:var(--bg)">Cancel</button>
      </div>
      <div class="pm-add-prov-msg" style="font-size:11px;margin-top:4px;display:none"></div>
    </div>
    <div class="pm-providers-list" style="font-size:12px;color:var(--text-muted);padding:.4rem 0">loading…</div>
  `;

  const form = root.querySelector('.pm-add-provider-form');
  const toggleForm = () => {
    const visible = form.style.display !== 'none';
    form.style.display = visible ? 'none' : 'block';
    if (!visible) {
      root.querySelector('.pm-add-prov-key').value = '';
      root.querySelector('.pm-add-prov-msg').style.display = 'none';
    }
  };
  root.querySelector('.pm-toggle-add-provider').addEventListener('click', toggleForm);
  root.querySelector('.pm-cancel-add-provider').addEventListener('click', toggleForm);
  root.querySelector('.pm-submit-add-provider').addEventListener('click', async () => {
    const name = root.querySelector('.pm-add-prov-select').value;
    const apiKey = root.querySelector('.pm-add-prov-key').value;
    const msg = root.querySelector('.pm-add-prov-msg');
    if (!name) { msg.style.display = 'block'; msg.style.color = 'var(--text-danger)'; msg.textContent = 'Select a provider'; return; }
    if (!apiKey) { msg.style.display = 'block'; msg.style.color = 'var(--text-danger)'; msg.textContent = 'API key required'; return; }
    msg.style.display = 'block'; msg.style.color = 'var(--text-accent)'; msg.textContent = 'Saving…';
    try {
      const provider = KNOWN_PROVIDERS.find((p) => p.name === name);
      const j = await fetchJson('/api/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, keyEnv: provider?.keyEnv || '', apiKey, source: 'dashboard' }),
      });
      if (j.ok) {
        msg.style.color = 'var(--text-success)'; msg.textContent = `✓ ${j.provider?.displayName || name} added`;
        setTimeout(() => { toggleForm(); refreshProviders(root); }, 1200);
      } else {
        msg.style.color = 'var(--text-danger)'; msg.textContent = '✗ ' + (j.error || 'Unknown error');
      }
    } catch (err) {
      msg.style.color = 'var(--text-danger)'; msg.textContent = '✗ ' + err.message;
    }
  });

  refreshProviders(root);
}

// ─── Models ─────────────────────────────────────────────────────────────────

// 009 — Dashboard Modernization (US6/FR-013): client-side filter over the already-loaded
// /api/models response — no new endpoint, no re-fetch on every keystroke.
function filterModels(models, { provider, maxPrice, minContext }) {
  return models.filter((m) => {
    if (provider && !String(m.provider || '').toLowerCase().includes(provider.toLowerCase()) && !String(m.model_id || '').toLowerCase().includes(provider.toLowerCase())) return false;
    if (maxPrice != null && m.pricing_input_per_m != null && Number(m.pricing_input_per_m) > maxPrice) return false;
    if (minContext != null && m.context_window != null && Number(m.context_window) < minContext) return false;
    return true;
  });
}

function modelsListHtml(models, emptyMessage = 'no models discovered — click "Refresh Models" to discover from configured providers') {
  if (!models || !models.length) {
    return `<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">${escapeHtml(emptyMessage)}</div>`;
  }
  const grouped = {};
  for (const m of models) {
    const prov = m.provider || 'unknown';
    (grouped[prov] ??= []).push(m);
  }
  let htm = '';
  for (const [provider, providerModels] of Object.entries(grouped)) {
    htm += `<div style="font-weight:600;font-size:13px;margin:12px 0 6px;color:var(--text-primary)">${escapeHtml(provider)} <span style="font-weight:400;color:var(--text-muted);font-size:11px">(${providerModels.length} models)</span></div>`;
    for (const m of providerModels) {
      const tier = m.tier_assigned ? `<span class="badge ${m.tier_assigned === 'best' ? 'b-ok' : m.tier_assigned === 'medium' ? 'b-accent' : 'b-muted'}">${escapeHtml(m.tier_assigned)}</span>` : '';
      const ctx = m.context_window != null ? `${(m.context_window / 1000).toFixed(0)}k` : '—';
      const inp = m.pricing_input_per_m != null ? `$${Number(m.pricing_input_per_m).toFixed(1)}` : '—';
      const out = m.pricing_output_per_m != null ? `$${Number(m.pricing_output_per_m).toFixed(1)}` : '—';
      const dep = m.deprecated ? '<span class="badge b-warn" style="font-size:10px">deprecated</span>' : '';
      htm += `<div class="row" style="align-items:center">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="mono" style="font-size:12px">${escapeHtml(m.model_id)}</span>
            ${dep}
            ${tier}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ctx: ${ctx} · in: ${inp}/M · out: ${out}/M
            ${m.pricing_source ? ` · src: ${escapeHtml(m.pricing_source)}` : ''}
          </div>
        </div>
      </div>`;
    }
  }
  return htm;
}

function currentFilters(root) {
  return {
    provider: root.querySelector('.pm-model-filter-text')?.value.trim() || '',
    maxPrice: (() => { const v = root.querySelector('.pm-model-filter-price')?.value; return v ? Number(v) : null; })(),
    minContext: (() => { const v = root.querySelector('.pm-model-filter-ctx')?.value; return v ? Number(v) * 1000 : null; })(),
  };
}

function applyModelFilters(root) {
  const raw = root._pmModelsRaw;
  const list = root.querySelector('.pm-models-list');
  if (!raw) return;
  const filters = currentFilters(root);
  const isFiltering = !!(filters.provider || filters.maxPrice != null || filters.minContext != null);
  const filtered = isFiltering ? filterModels(raw, filters) : raw;
  list.innerHTML = modelsListHtml(filtered, isFiltering ? 'no models match this filter' : undefined);
}

async function refreshModels(root) {
  const list = root.querySelector('.pm-models-list');
  try {
    const j = await fetchJson('/api/models');
    root._pmModelsRaw = j.ok ? j.models : [];
    if (!j.ok) { list.innerHTML = '<div style="font-size:12px;color:var(--text-danger)">Failed to load models</div>'; return; }
    applyModelFilters(root);
  } catch (err) {
    list.innerHTML = `<div style="font-size:12px;color:var(--text-danger)">Failed to load models: ${escapeHtml(err.message)}</div>`;
  }
}

function renderModelsSection(root) {
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:500;color:var(--text-secondary);flex:1">auto-discovered</div>
      <button class="pm-refresh-models" style="font-size:11px;padding:4px 8px">⟳ Refresh Models</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input class="pm-model-filter-text" type="text" placeholder="filter by provider or model id…" style="flex:1;min-width:160px;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
      <input class="pm-model-filter-price" type="number" min="0" step="0.1" placeholder="max $/M input" style="width:130px;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
      <input class="pm-model-filter-ctx" type="number" min="0" step="1" placeholder="min ctx (k)" style="width:110px;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
    </div>
    <div class="pm-models-list" style="font-size:12px;color:var(--text-muted);padding:.4rem 0">loading…</div>
  `;
  ['.pm-model-filter-text', '.pm-model-filter-price', '.pm-model-filter-ctx'].forEach((sel) => {
    root.querySelector(sel).addEventListener('input', () => applyModelFilters(root));
  });
  root.querySelector('.pm-refresh-models').addEventListener('click', async () => {
    const list = root.querySelector('.pm-models-list');
    try {
      const j = await fetchJson('/api/models/refresh', { method: 'POST' });
      if (j.ok) {
        list.innerHTML = '<div style="font-size:12px;color:var(--text-accent);padding:.4rem 0">Model refresh started… this may take up to 60 seconds. Models will appear here when done.</div>';
        setTimeout(() => refreshModels(root), 15000);
        setTimeout(() => refreshModels(root), 30000);
        setTimeout(() => refreshModels(root), 60000);
      }
    } catch (err) {
      alert('Model refresh failed: ' + err.message);
    }
  });
  refreshModels(root);
}

// ─── Panel shell ─────────────────────────────────────────────────────────────

async function renderProvidersModels(el) {
  el.innerHTML = `
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px">capability matrix <span style="font-weight:400;color:var(--text-muted)">· read-only · edit policy.yaml to change</span></div><div class="pm-capmatrix"></div></div>
    <div style="margin-bottom:14px;border-top:1px solid var(--border);padding-top:10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px">providers</div><div class="pm-providers"></div></div>
    <div style="border-top:1px solid var(--border);padding-top:10px"><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px">models</div><div class="pm-models"></div></div>
  `;
  await renderCapabilityMatrix(el.querySelector('.pm-capmatrix'));
  renderProvidersSection(el.querySelector('.pm-providers'));
  renderModelsSection(el.querySelector('.pm-models'));
}

export function registerProvidersModelsPanel() {
  registerPanel('providers-models', 'Providers & Models', renderProvidersModels);
}
