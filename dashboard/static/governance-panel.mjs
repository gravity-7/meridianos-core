/**
 * governance-panel — 009 Dashboard Modernization (US4/FR-009). Merges "needs you · action required"
 * (escalation status) with "safety & governance" (the policy levers that gate what produces those
 * escalations) into one panel — a blocked item and the lever that's blocking it are now visible
 * together instead of at opposite ends of the legacy board.
 *
 * The escalation action buttons (Approve/Snooze/Skip/Open task/Dismiss) call `openSpec`/
 * `unblockEsc`/`snoozeEsc`/`skipEsc`/`actEsc` — these stay defined in dashboard/index.html's classic
 * script (deeply tied to the task-modal system, out of scope to re-migrate here) and are reached via
 * plain `onclick="..."` attributes exactly like the legacy markup already did: a top-level
 * `function` declaration in a classic script is a `window` property, so an attribute-based handler
 * resolves it correctly regardless of which module rendered the HTML. This module does not
 * reimplement that logic — duplicating it would risk behavioral drift from the task-modal system.
 * The governance levers are new here: save via the same `saveLever()`-over-`POST /api/policy`
 * pattern settings-panels.mjs/agent-budget-panel.mjs already established, not the legacy shared
 * LEVERS/dirty/save() mechanism.
 */
import { registerPanel } from './settings-workspace.mjs';
import { esc as escapeHtml, relTime } from './dashboard-utils.mjs';

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

function escalationsHtml(escList) {
  if (!escList || !escList.length) {
    return '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0;text-align:center">you\'re all caught up</div>';
  }
  return escList
    .map((e) => {
      const sevColor = e.severity === 'info' ? 'var(--text-accent)' : e.severity === 'warn' ? 'var(--text-warning)' : 'var(--text-danger)';
      const t = e.ts ? relTime(e.ts) + ' ago' : '—';
      let btn = '';
      if (e.task) {
        const open = `<button onclick="openSpec('${escapeHtml(e.task)}', defaultSpecPath('${escapeHtml(e.task)}'), '${escapeHtml(e.detail || '')}', '${escapeHtml(e.status || '')}', '${escapeHtml(e.owner || '')}')" style="font-size:11px;padding:4px 8px">Open task</button>`;
        let controls = '';
        if (e.kind === 'task_blocked') {
          controls =
            ` <button onclick="unblockEsc('${escapeHtml(e.task)}')" style="font-size:11px;padding:4px 8px;color:var(--text-success);border-color:var(--text-success)">Approve</button>` +
            ` <select onchange="if(this.value) snoozeEsc('${escapeHtml(e.task)}', this.value, this)" style="font-size:11px;padding:3px 4px" title="Snooze for…">
              <option value="">Snooze…</option>
              <option value="1">1d</option>
              <option value="7">7d</option>
              <option value="30">30d</option>
            </select>` +
            ` <button onclick="skipEsc('${escapeHtml(e.task)}')" style="font-size:11px;padding:4px 8px">Skip</button>`;
        }
        btn = open + controls;
      } else if (e.action && e.action.endpoint) {
        const ep = encodeURIComponent(e.action.endpoint);
        const pay = e.action.payload ? encodeURIComponent(JSON.stringify(e.action.payload)) : '';
        btn = `<button onclick="actEsc('${escapeHtml(e.id)}', '${ep}', '${pay}')" style="font-size:11px;padding:4px 8px">${escapeHtml(e.action.label)}</button>`;
      } else {
        btn = `<button onclick="actEsc('${escapeHtml(e.id)}', '', '')" style="font-size:11px;padding:4px 8px">Dismiss</button>`;
      }
      return `<div class="row" style="border-left:3px solid ${sevColor}; padding-left:12px; align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:500">${escapeHtml(e.title)}</span>
          <span class="mono" style="font-size:11px;color:var(--text-muted)">${t}</span>
          ${e.task ? `<span class="model">${escapeHtml(e.task)}</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${escapeHtml(e.detail)}</div>
      </div>
      <div style="margin-left:12px">${btn}</div>
    </div>`;
    })
    .join('');
}

// escalationsHtml()'s "Open task" button references `defaultSpecPath(...)` inside its onclick
// attribute string, resolved at click time against the browser's real global scope — where
// dashboard/index.html's own top-level `function defaultSpecPath(id){...}` declaration already
// lives (a classic-script top-level function IS a `window` property). No local copy needed here.

function governanceLeversHtml(policy) {
  const sel = (id, current, options) =>
    `<select class="ws-gov-lever" data-path="${id}" style="flex:1">${options
      .map(([v, label]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`)
      .join('')}</select>`;

  return `
    <div class="lev g"><label>deploy</label>${sel('sensitive_actions.deploy', policy?.sensitive_actions?.deploy, [['block_and_ask', 'block & ask'], ['notify_only', 'notify only'], ['allow', 'allow']])}</div>
    <div class="lev g"><label>external send</label>${sel('sensitive_actions.external_send', policy?.sensitive_actions?.external_send, [['block_and_ask', 'block & ask'], ['notify_only', 'notify only'], ['allow', 'allow']])}</div>
    <div class="lev g"><label>spend money</label>${sel('sensitive_actions.spend_money', policy?.sensitive_actions?.spend_money, [['block_and_ask', 'block & ask'], ['notify_only', 'notify only'], ['allow', 'allow']])}</div>
    <div class="lev g"><label>schema change</label>${sel('sensitive_actions.schema_change', policy?.sensitive_actions?.schema_change, [['block_and_ask', 'block & ask'], ['notify_only', 'notify only'], ['allow', 'allow']])}</div>
    <div class="lev g"><label>auto-merge PRs</label>${sel('auto_merge', policy?.auto_merge, [['founder_only', 'founder-only'], ['peer_agent_review', 'peer-agent review'], ['verifier_gated', 'verifier-gated']])}</div>
    <div class="lev g"><label>escalation channel</label>${sel('escalation.channel', policy?.escalation?.channel, [['digest', 'digest file only'], ['push', 'push only'], ['push_digest', 'push + digest']])}</div>
    <div class="lev g"><label>webhook URL</label><span style="flex:1;font-size:11px;color:var(--text-muted)">secret — set via <code>AIOS_ESCALATION_WEBHOOK</code> env or <code>.ai/secrets/escalation-webhook</code> (never stored in policy.yaml)</span></div>
    <div class="lev g"><label>work stealing</label><span class="sw"><input type="checkbox" class="ws-gov-worksteal" ${policy?.work_stealing ? 'checked' : ''}><i></i></span><span style="font-size:11px;color:var(--text-muted);margin-left:4px">idle agent may claim the other's tasks</span></div>
    <div class="workspace-panel-status ws-gov-status" style="font-size:11px;margin-top:4px"></div>
  `;
}

async function renderGovernance(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let body;
  try {
    body = await fetchJson('/api/status');
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Governance unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">needs you</div>
      <div class="ws-gov-escalations">${escalationsHtml(body.escalations)}</div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:10px">
      <div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">safety & governance</div>
      ${governanceLeversHtml(body.policy || {})}
    </div>
  `;

  const status = el.querySelector('.ws-gov-status');
  el.querySelectorAll('.ws-gov-lever').forEach((sel) => {
    sel.addEventListener('change', () => saveLever({ [sel.dataset.path]: sel.value }, status));
  });
  const workSteal = el.querySelector('.ws-gov-worksteal');
  workSteal.addEventListener('change', () => saveLever({ work_stealing: workSteal.checked }, status));
}

export function registerGovernancePanel() {
  registerPanel('governance', 'Safety & Governance', renderGovernance);
}
