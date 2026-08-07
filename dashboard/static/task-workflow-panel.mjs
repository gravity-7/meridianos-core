/**
 * task-workflow-panel — 009 Dashboard Modernization (US2/FR-004, US4/FR-009). Ports the legacy
 * board's task/agent workflow status displays — active now, next in queue, recent runs, system
 * health, verification queue, planner & backlog, and runner & schedule — into one Settings &
 * Observability workspace panel.
 *
 * Interactive elements (queue/run rows opening the spec modal, verification approve/reject, the
 * "Run now" button) reuse `openSpec`/`copySession`/`postAction`/`defaultSpecPath` from
 * dashboard/index.html's classic script via plain `onclick` attributes — top-level `function`
 * declarations in a classic script are `window` properties, reachable from any module's generated
 * HTML — rather than reimplementing the task-modal system those functions are coupled to.
 *
 * Scope note (T024 revised): "work & scheduling" (max parallel/WIP/priority/lease-TTL/cadence/quiet
 * hours) is NOT ported here despite the original task wording pairing it with runner status. Those
 * controls are wired to the legacy page's shared `LEVERS`/`dirty`/`save()` batch-save mechanism,
 * whose listener-attachment (`['ctrls','work'].forEach(...)`) runs unconditionally at page load —
 * before this panel (lazy-rendered on first Settings-tab open) would even exist in the DOM. Moving
 * them here would either break that eager listener attachment (the exact null-deref class of bug
 * fixed alongside T023) or require converting a deliberate batch-save control group to per-field
 * immediate saves — a real behavior change, not a safe mechanical port. Runner status (read-only,
 * no LEVERS coupling) moves here; its controls stay in the legacy board's "work & scheduling" card.
 * Live refresh: registers with poll-dispatcher.mjs (US3) rather than inventing a second timer, so
 * this panel updates on the same cadence as the rest of the page and gets the same per-handler
 * error isolation/reporting for free.
 */
import { registerPanel } from './settings-workspace.mjs';
import { registerPollHandler } from './poll-dispatcher.mjs';
import { reportError } from './client-error-log.mjs';
import { esc as escapeHtml, relTime, shortModel, badgeFor, outcomeBadge } from './dashboard-utils.mjs';

async function fetchJson(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

// ─── Active now ─────────────────────────────────────────────────────────────

function activeRowHtml(name, a, ha) {
  if (a && a.active) {
    const sess = a.active.session || '';
    return `<div class="row active-row" data-sess="${escapeHtml(sess)}" style="cursor:pointer" title="Click to copy session resume command"><span class="badge ${badgeFor(a.active.status)}">${escapeHtml(a.active.status)}</span>` +
      `<div style="flex:1;min-width:0"><div class="mono" style="font-size:13px">${escapeHtml(a.active.task)}</div>` +
      `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(name)} · session <span class="mono" style="cursor:pointer;text-decoration:underline dotted;color:var(--text-accent)" title="Click to copy resume command" onclick="event.stopPropagation();copySession('${escapeHtml(sess)}','${escapeHtml(name)}')">${escapeHtml(sess.slice(0, 8))}</span> · ${a.active.heartbeatAgeSec}s ago</div></div>` +
      `<span class="model">${escapeHtml(shortModel(a.model))}</span></div>`;
  }
  const idleReason = (ha && ha.reason) ? ha.reason : 'no lease';
  const isSessionLimit = idleReason === 'session_limit';
  const resetAt = ha && ha.sessionResetAt;
  let reasonLabel, reasonColor;
  if (isSessionLimit) {
    reasonLabel = resetAt ? `session limit · resets ${escapeHtml(resetAt)}` : 'session limit';
    reasonColor = 'var(--text-warn, #c97c2e)';
  } else {
    reasonColor = 'var(--text-secondary)';
    reasonLabel = {
      ready: 'ready · awaiting runner',
      max_runs: 'run cap reached · awaiting window reset',
      quiet_hours: 'quiet hours · sleeping',
      no_eligible_task: 'no eligible task',
      wip_per_agent: 'WIP limit reached',
      max_parallel: 'max parallel reached',
      budget_halt: 'budget exhausted',
      kill_switch: 'kill switch ON',
      below_priority_floor: 'below priority floor',
    }[idleReason] || (idleReason.startsWith('sensitive_action:') ? 'awaiting approval: ' + idleReason.slice(17) : idleReason);
  }
  return `<div class="row active-row"><span class="badge ${isSessionLimit ? 'b-warn' : 'b-muted'}">idle</span>` +
    `<div style="flex:1;min-width:0"><div style="font-size:13px;color:${reasonColor}">${reasonLabel}</div>` +
    `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(name)} · waiting</div></div>` +
    `<span class="model">${escapeHtml(shortModel(a && a.model))}</span></div>`;
}

function renderActive(el, roster, agentsMap, haMap) {
  if (!roster || !roster.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no agents in roster</div>'; return; }
  el.innerHTML = roster.map((name) => activeRowHtml(name, agentsMap && agentsMap[name], haMap && haMap[name])).join('');
}

// ─── Next in queue ──────────────────────────────────────────────────────────

function renderQueue(el, q) {
  if (!q.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">queue empty - nothing eligible</div>'; return; }
  el.innerHTML = q.map((t, i) => {
    const sp = t.spec || `.ai/features/${t.id}/spec.md`;
    let mb = '';
    if (t.routing) {
      if (t.owner === 'claude' && t.routing.claude?.model) mb = `<span class="model" style="margin:0 6px">${escapeHtml(shortModel(t.routing.claude.model))}</span>`;
      else if (t.owner === 'antigravity' && t.routing.antigravity?.model) mb = `<span class="model" style="margin:0 6px">${escapeHtml(shortModel(t.routing.antigravity.model))}</span>`;
      else if (t.owner === 'both') {
        if (t.routing.claude?.model) mb += `<span class="model" style="margin:0 2px" title="Claude">${escapeHtml(shortModel(t.routing.claude.model))}</span>`;
        if (t.routing.antigravity?.model) mb += `<span class="model" style="margin:0 6px 0 2px" title="Antigravity">${escapeHtml(shortModel(t.routing.antigravity.model))}</span>`;
      }
    }
    return `<div class="row run" style="cursor:pointer" onclick="openSpec('${escapeHtml(t.id)}', '${escapeHtml(sp)}')"><span class="mono" style="font-size:12px;color:var(--text-muted);min-width:16px">${i + 1}</span><div style="flex:1;min-width:0"><span class="mono" style="font-size:13px">${escapeHtml(t.id)}</span></div><span class="badge ${badgeFor(t.status)}">${escapeHtml(t.status)}</span>${mb}<span style="font-size:11px;color:var(--text-muted)">${escapeHtml(t.owner)}</span></div>`;
  }).join('');
}

// ─── Recent runs ────────────────────────────────────────────────────────────

function renderRuns(el, noteEl, runs) {
  if (!runs.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no runs yet — the runner has not fired</div>'; return; }
  el.innerHTML = runs.map((r) => {
    const t = r.ts ? new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    return `<div class="row run" data-sess="${escapeHtml(r.session || '')}" data-app="${escapeHtml(r.agent || '')}" style="align-items:flex-start;cursor:pointer"><span class="mono" style="font-size:12px;color:var(--text-muted);min-width:46px">${t}</span><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:13px">${escapeHtml(r.agent || '—')}</span>${r.model ? `<span class="model">${escapeHtml(shortModel(r.model))}</span>` : ''}<span class="badge ${outcomeBadge(r.outcome)}">${escapeHtml(r.outcome)}</span>${r.tokens ? `<span class="mono" style="font-size:11px;color:var(--text-muted)">${fmt(r.tokens)} tok</span>` : ''}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px">${r.task ? `<span class="mono">${escapeHtml(r.task)}</span> — ` : ''}${escapeHtml(r.note || '')}${r.session ? ` · <span class="mono">${escapeHtml(String(r.session).slice(0, 8))}</span>` : ''}</div></div></div>`;
  }).join('');
  el.querySelectorAll('.run').forEach((row) => {
    row.onclick = () => {
      const s = row.getAttribute('data-sess');
      const app = row.getAttribute('data-app');
      if (s) { noteEl.textContent = '→ copied resume command for session ' + s.slice(0, 8); copySession(s, app); }
      else { noteEl.textContent = 'no session recorded for this run'; }
    };
  });
}

// ─── System health ──────────────────────────────────────────────────────────

function renderHealth(el, health) {
  if (!health) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">all agents healthy</div>'; return; }
  let htm = '';
  const wd = health.watchdog;
  if (wd) htm += `<div class="row"><div style="flex:1"><span style="font-size:13px">Watchdog</span></div><span class="badge ${wd.running ? 'b-ok' : 'b-danger'}">${wd.running ? 'running' : 'stopped'}</span><span class="mono" style="font-size:11px;color:var(--text-muted)">next tick: ${wd.nextTickTs ? new Date(wd.nextTickTs).toLocaleTimeString() : '—'}</span></div>`;
  if (health.agents) {
    for (const [name, a] of Object.entries(health.agents)) {
      const stateBadge = a.state === 'active' ? 'b-ok' : a.state === 'idle' ? 'b-muted' : a.state === 'halted' ? 'b-warn' : 'b-danger';
      htm += `<div class="row" style="flex-wrap:wrap">
        <div style="flex:1;min-width:120px"><span style="font-size:13px">${escapeHtml(name)}</span></div>
        <span class="badge ${stateBadge}">${escapeHtml(a.state)}</span>
          <span class="mono" style="font-size:11px;color:var(--text-muted)">${a.heartbeatAgeSec != null ? 'last ♥ ' + a.heartbeatAgeSec + 's ago' : ''}${a.reason ? ' · ' + escapeHtml(a.reason) : (a.state === 'idle' && !a.leaseTask ? ' · no claimable tasks' : '')}</span>
        ${a.leaseTask ? `<div style="width:100%;font-size:11px;color:var(--text-muted);margin-top:4px">Lease: <span class="model">${escapeHtml(a.leaseTask)}</span> expires in ${a.leaseExpiresTs ? Math.max(0, Math.floor((new Date(a.leaseExpiresTs) - Date.now()) / 1000)) : 0}s</div>` : ''}
      </div>`;
    }
  }
  if (health.slaBreaches?.length) {
    htm += `<div style="margin-top:12px;font-size:12px;font-weight:600;color:var(--text-danger)">SLA Breaches</div>`;
    htm += health.slaBreaches.map((b) => `<div class="row" style="background:var(--bg-danger);border-radius:4px;padding:4px 8px;margin-top:4px"><span class="model" style="color:var(--text-danger);border-color:var(--text-danger)">${escapeHtml(b.task)}</span><span style="font-size:11px;margin-left:8px;color:var(--text-danger)">reaped ${b.reapCount}x</span></div>`).join('');
  }
  if (health.reaps?.length) {
    htm += `<div style="margin-top:12px;font-size:12px;font-weight:500;color:var(--text-secondary)">Recent Reaps</div>`;
    htm += health.reaps.map((r) => `<div class="row" style="padding:4px 0"><span class="mono" style="font-size:11px;color:var(--text-muted);min-width:55px">${new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span class="model">${escapeHtml(r.task)}</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">${r.owner || '—'}${r.reapCount ? ', reaped ' + r.reapCount + '×' : ''}</span></div>`).join('');
  }
  el.innerHTML = htm;
}

// ─── Runner & schedule (status only — see scope note above) ────────────────

function renderRunner(el, runner) {
  if (!runner || !runner.enabled) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">manual only — scheduler off</div>'; return; }
  const nextInSec = runner.nextRunTs ? Math.max(0, Math.floor((new Date(runner.nextRunTs) - Date.now()) / 1000)) : 0;
  let htm = `<div class="row" style="align-items:center">
    <div style="flex:1"><div style="font-size:13px">Cadence: <strong>${escapeHtml(runner.cadence)}</strong></div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">next in ${Math.floor(nextInSec / 60)}m ${nextInSec % 60}s · last ${relTime(runner.lastRunTs)} ago</div></div>
    <button onclick="postAction('/api/run-now', {})" style="font-size:11px;padding:4px 8px">Run now</button>
  </div>`;
  if (runner.holdReason) htm += `<div style="margin-top:8px"><span class="badge b-warn">held: ${escapeHtml(runner.holdReason)}</span></div>`;
  if (runner.quietHours?.enabled) {
    const qh = runner.quietHours;
    htm += `<div class="row" style="margin-top:8px;background:var(--surface-1);border-radius:4px;padding:8px">
      <div style="flex:1;font-size:12px">Quiet hours: <span style="color:var(--text-secondary)">${qh.sleepingNow ? 'sleeping' : 'active now'}</span></div>
      <span class="mono" style="font-size:11px;color:var(--text-muted)">${escapeHtml(qh.from)} – ${escapeHtml(qh.to)}</span>
    </div>`;
  }
  if (runner.maxRunsPerWindow > 0) {
    const pct = Math.min(100, (runner.runsThisWindow / runner.maxRunsPerWindow) * 100);
    htm += `<div style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary)"><span>runs this window</span><span>${runner.runsThisWindow} / ${runner.maxRunsPerWindow}</span></div><div class="meter" style="height:4px;margin-top:4px"><span style="width:${pct}%"></span></div></div>`;
  }
  el.innerHTML = htm;
}

// ─── Verification queue ─────────────────────────────────────────────────────

function renderVerifier(el, verifier) {
  if (!verifier || (!verifier.pending?.length && !verifier.recent?.length)) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">nothing awaiting verification</div>'; return; }
  let htm = `<div style="margin-bottom:12px"><span class="badge b-muted" style="text-transform:none">mode: ${escapeHtml(verifier.mode)}</span></div>`;
  if (verifier.pending?.length) {
    htm += verifier.pending.map((p) => {
      const checks = p.checks.map((c) => `<span class="badge ${c.status === 'pass' ? 'b-ok' : c.status === 'fail' ? 'b-danger' : 'b-warn'}" title="${escapeHtml(c.detail)}">${escapeHtml(c.name)}</span>`).join(' ');
      const canApprove = verifier.mode !== 'founder_only';
      return `<div class="row" style="flex-wrap:wrap">
        <div style="flex:1;min-width:100%">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:13px;font-weight:500">${escapeHtml(p.task)}</span>
            <span class="badge ${outcomeBadge(p.verdict)}">${escapeHtml(p.verdict)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">PR #${p.pr} · by ${escapeHtml(p.agent)} · ${relTime(p.submittedTs)} ago</div>
          <div style="margin-top:6px">${checks}</div>
        </div>
        ${canApprove ? `<div style="display:flex;gap:6px;margin-top:8px;width:100%"><button onclick="postAction('/api/verify', {task:'${escapeHtml(p.task)}', action:'approve'})" style="font-size:11px;padding:4px 8px;color:var(--text-success);border-color:var(--text-success)">Approve</button><button onclick="postAction('/api/verify', {task:'${escapeHtml(p.task)}', action:'reject'})" style="font-size:11px;padding:4px 8px;color:var(--text-danger);border-color:var(--text-danger)">Reject</button></div>` : ''}
      </div>`;
    }).join('');
  } else htm += '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no pending PRs</div>';
  if (verifier.recent?.length) {
    htm += `<div style="margin-top:12px;font-size:12px;font-weight:500;color:var(--text-secondary)">Recent Verdicts</div>`;
    htm += verifier.recent.slice(0, 5).map((r) => `<div class="row" style="padding:4px 0"><span class="badge ${outcomeBadge(r.verdict)}">${escapeHtml(r.verdict)}</span><span class="model" style="margin-left:8px">${escapeHtml(r.task)}</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">${relTime(r.ts)} ago</span></div>`).join('');
  }
  el.innerHTML = htm;
}

// ─── Planner & backlog ───────────────────────────────────────────────────────

function renderPlanner(el, planner) {
  if (!planner || (planner.backlogDepth === 0 && !planner.epics?.length && !planner.proposals?.length)) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">backlog clear</div>'; return; }
  let htm = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-size:12px;color:var(--text-secondary)">Backlog depth: ${planner.backlogDepth}</span><span class="mono" style="font-size:11px;color:var(--text-muted)">planned ${relTime(planner.lastPlannedTs)} ago</span></div>`;
  if (planner.epics?.length) {
    htm += `<div style="font-size:12px;font-weight:600;margin-bottom:6px">Epics</div>`;
    htm += planner.epics.map((e) => {
      const pct = e.childrenTotal > 0 ? (e.childrenReady / e.childrenTotal) * 100 : 0;
      return `<div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:13px;font-weight:500">${escapeHtml(e.id)}</span><span class="badge ${badgeFor(e.status)}">${escapeHtml(e.status)}</span></div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">${escapeHtml(e.title)}</div>
        <div style="display:flex;align-items:center;gap:8px"><div class="meter" style="flex:1;margin:0"><span style="width:${pct}%"></span></div><span style="font-size:11px;color:var(--text-muted)">${e.childrenReady}/${e.childrenTotal} ready</span></div>
      </div>`;
    }).join('');
  }
  if (planner.proposals?.length) {
    htm += `<div style="margin-top:12px;font-size:12px;font-weight:600;margin-bottom:6px">Fresh Proposals</div>`;
    htm += planner.proposals.map((p) => `<div class="row" style="flex-wrap:wrap">
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center"><span style="font-size:13px;font-weight:500">${escapeHtml(p.title)}</span><span class="badge ${p.status === 'accepted' ? 'b-ok' : 'b-accent'}">${escapeHtml(p.status)}</span></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Epic: <span class="model">${escapeHtml(p.fromEpic)}</span> · Prio: ${p.priority}</div>
        ${p.resources?.length ? `<div style="margin-top:6px;width:100%">${p.resources.map((r) => `<span class="model" style="font-size:10px">${escapeHtml(r)}</span>`).join(' ')}</div>` : ''}
      </div>`).join('');
  }
  el.innerHTML = htm;
}

// ─── Panel shell ─────────────────────────────────────────────────────────────

function shellHtml() {
  return `
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">active now</div><div class="tw-active"></div></div>
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">next in queue</div><div class="tw-queue"></div></div>
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">recent runs</div><div class="tw-runs-note" style="font-size:11px;color:var(--text-muted);min-height:15px"></div><div class="tw-runs"></div></div>
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">system health</div><div class="tw-health"></div></div>
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">runner & schedule</div><div class="tw-runner"></div></div>
    <div style="margin-bottom:14px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">verification queue</div><div class="tw-verifier"></div></div>
    <div><div style="font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">planner & backlog</div><div class="tw-planner"></div></div>
  `;
}

async function refresh(el) {
  let s;
  try {
    s = await fetchJson('/api/status');
  } catch (err) {
    reportError('task-workflow-panel', err, { panelEl: el });
    return;
  }
  const roster = Object.keys(s.budget || {}).filter((k) => !['kill_switch', 'attribution', 'resets', 'mayClaim', 'providerUsage'].includes(k));
  const ha = s.health?.agents || {};
  renderActive(el.querySelector('.tw-active'), roster, s.agents, ha);
  renderQueue(el.querySelector('.tw-queue'), s.queue || []);
  renderRuns(el.querySelector('.tw-runs'), el.querySelector('.tw-runs-note'), s.runs || []);
  renderHealth(el.querySelector('.tw-health'), s.health);
  renderRunner(el.querySelector('.tw-runner'), s.runner);
  renderVerifier(el.querySelector('.tw-verifier'), s.verifier);
  renderPlanner(el.querySelector('.tw-planner'), s.planner);
}

async function renderTaskWorkflow(el) {
  el.innerHTML = shellHtml();
  await refresh(el);
  registerPollHandler(() => refresh(el));
}

export function registerTaskWorkflowPanel() {
  registerPanel('task-workflow', 'Task & Agent Workflow', renderTaskWorkflow);
}
