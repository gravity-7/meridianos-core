/**
 * agent-budget-panel — 009 Dashboard Modernization (US1/US4, FR-001/FR-009). Merges what used to be
 * two separate roster-driven grids on the legacy board — the read-only "compute budget" usage tiles
 * (`renderBudgetCards`/`budgetGrid`) and the editable "budget & limits" cap sliders
 * (`renderAgentBudgetControls`/`agentBudgetTiles`) — into one panel per agent, so usage and the
 * controls that affect it are co-located (US4) instead of split across distant sections.
 *
 * Follows settings-panels.mjs's established pattern: self-contained (fetches its own data, not
 * dependent on the legacy script's global `s`/`LEVERS`/`dirty` state), writes go through the
 * existing `POST /api/policy` path — the same mechanism every other lever uses, no parallel write
 * mechanism. Saving a cap requires `isAgentLeverPath()` (policy-write.mjs) to recognize the agent,
 * fixed alongside this panel (see that file's doc comment) since building this against the old
 * hardcoded claude/antigravity-only whitelist would have inherited the exact save failure this
 * panel exists to make visible and usable.
 */
import { registerPanel } from './settings-workspace.mjs';
import { esc as escapeHtml } from './dashboard-utils.mjs';

async function fetchJson(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

async function saveLever(update, statusEl) {
  statusEl.textContent = 'Saving…';
  try {
    await fetchJson('/api/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) });
    statusEl.textContent = 'Saved.';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
    return true;
  } catch (err) {
    statusEl.textContent = `Save failed: ${String(err.message ?? err)}`;
    return false;
  }
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

function stateColor(state) {
  if (state === 'over') return 'var(--fill-danger, #ef4444)';
  if (state === 'warn') return 'var(--text-warning, #d97706)';
  return 'var(--fill-accent, #3b82f6)';
}

function resetIn(ts) {
  if (!ts) return '';
  const ms = Date.parse(ts) - Date.now();
  if (ms <= 0) return ' · resetting…';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return ' · resets in ' + (h ? h + 'h ' : '') + m + 'm';
}

function usageTile(label, w, resetAt) {
  const pct = w && w.pct != null ? w.pct : '—';
  const barWidth = Math.min((w && w.pct) || 0, 100);
  const barColor = stateColor(w && w.state);
  const sub = w ? (fmt(w.used) + ' / ' + fmt(w.cap) + resetIn(resetAt)) : '— / —';
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary)">${label}</div>
    <div style="display:flex;align-items:baseline;gap:4px"><span style="font-size:18px;font-weight:500">${pct}</span><span style="font-size:11px;color:var(--text-muted)">%</span></div>
    <div class="meter"><span style="width:${barWidth}%;background:${barColor}"></span></div>
    <div class="mono" style="font-size:10px;color:var(--text-muted)">${sub}</div>
  </div>`;
}

function agentCardHtml(agent, model, w5, wk, resets, cap5, capW) {
  return `<div class="tile" data-agent="${escapeHtml(agent)}" style="margin-bottom:12px">
    <div style="font-size:13px;font-weight:500;margin-bottom:8px">${escapeHtml(agent)}${model ? ` <span class="model" style="font-size:11px">${escapeHtml(model)}</span>` : ''}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      ${usageTile('5h usage', w5, resets[agent + '_5h_at'])}
      ${usageTile('week usage', wk, resets[agent + '_week_at'])}
    </div>
    <div class="lev"><label>5h cap</label><input type="range" class="ws-agent-cap5" min="500000" max="5000000" step="100000" value="${cap5 || 2000000}" style="flex:1"><output class="ws-agent-out-cap5">${cap5 ? fmt(cap5) : '—'}</output></div>
    <div class="lev"><label>week cap</label><input type="range" class="ws-agent-capW" min="5000000" max="30000000" step="500000" value="${capW || 15000000}" style="flex:1"><output class="ws-agent-out-capW">${capW ? fmt(capW) : '—'}</output></div>
    <div class="workspace-panel-status ws-agent-status" style="font-size:11px;margin-top:4px"></div>
  </div>`;
}

function wireAgentCard(root, agent) {
  const card = root.querySelector(`[data-agent="${CSS.escape(agent)}"]`);
  if (!card) return;
  const cap5El = card.querySelector('.ws-agent-cap5'), out5 = card.querySelector('.ws-agent-out-cap5');
  const capWEl = card.querySelector('.ws-agent-capW'), outW = card.querySelector('.ws-agent-out-capW');
  const status = card.querySelector('.ws-agent-status');

  cap5El.addEventListener('input', () => { out5.textContent = fmt(+cap5El.value); });
  capWEl.addEventListener('input', () => { outW.textContent = fmt(+capWEl.value); });

  cap5El.addEventListener('change', () => saveLever({ [`agent_budget.${agent}.per_5h_tokens`]: +cap5El.value }, status));
  capWEl.addEventListener('change', () => saveLever({ [`agent_budget.${agent}.per_week_tokens`]: +capWEl.value }, status));
}

async function renderAgentBudget(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let body;
  try {
    body = await fetchJson('/api/status');
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Agent budget unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  const budget = body.budget || {};
  const policy = body.policy || {};
  const roster = Object.keys(budget.mayClaim || {});
  if (!roster.length) {
    el.innerHTML = '<div class="workspace-panel-empty">No agents in roster.</div>';
    return;
  }

  const resets = budget.resets || {};
  el.innerHTML = roster
    .map((agent) => {
      const windows = (budget[agent] && budget[agent].windows) || [];
      const w5 = windows.find((w) => w.window === '5h');
      const wk = windows.find((w) => w.window === 'week');
      const model = policy.agent_models?.[agent]?.default;
      const cap5 = policy.agent_budget?.[agent]?.per_5h_tokens;
      const capW = policy.agent_budget?.[agent]?.per_week_tokens;
      return agentCardHtml(agent, model, w5, wk, resets, cap5, capW);
    })
    .join('');

  for (const agent of roster) wireAgentCard(el, agent);
}

export function registerAgentBudgetPanel() {
  registerPanel('agent-budget', 'Agent Budget', renderAgentBudget);
}
