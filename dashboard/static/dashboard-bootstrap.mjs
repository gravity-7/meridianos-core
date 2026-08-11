/**
 * dashboard-bootstrap — 010 Frontend ES Module Migration, US9. The phase's finish line:
 * dashboard/index.html ships zero inline application logic after this module lands. Imports every
 * other feature module (US1-US8) to reconstruct render(s)/poll()'s exact call sequence and the
 * top-level init order (FR-008/FR-009) — same relative order as the classic script, since ES
 * modules execute top-to-bottom same as a classic script (only deferred-relative-to-parsing timing,
 * strict mode, and module scoping differ).
 *
 * The `_pendingPollHandlers` queue-and-flush bridge the classic script needed (registerPollHandler()
 * calls made synchronously, before a `import()` dynamic-import's promise could ever settle within
 * that same tick) is gone: every module imported below already resolves `registerPollHandler`/
 * `reportError`/`runPollHandlers` via a plain static `import`, which is fully resolved before this
 * module's own top-level code runs at all (an ES module guarantee a classic script never had). This
 * module does the same directly — the workaround's entire reason for existing was the classic
 * script's inability to use static `import` syntax, which no longer applies to any file in this
 * migration.
 *
 * window.fmt/window.poll/window.startPolling/window.stopPolling/window.kill stay as bridges:
 * spend-budget.mjs/policy-levers.mjs (fmt), escalation-actions.mjs (poll),
 * daemon-console.mjs (poll/startPolling/stopPolling), and render(s)/poll() here plus
 * policy-levers.mjs (kill, genuinely shared mutable state, not a stable function reference) all
 * reach across the module boundary this way — confirmed safe: none of those modules' own top-level
 * code touches any of these bridges before this module's top-level code (which sets them) has run,
 * only code inside functions those modules call later (event handlers, timers, or calls this
 * module itself makes after import evaluation completes).
 *
 * `EXT`/`stateColor` (dead top-level consts, confirmed by a repo-wide grep to have zero call sites
 * anywhere — pre-existing dead code, not something this phase introduced) are dropped, not ported.
 *
 * The AIOS_TOKEN CSRF guard (postmortem security P1) is deliberately NOT here — it's a tiny inline
 * `<script type="module">` left in dashboard/index.html itself. dashboard/server.mjs's GET / route
 * string-replaces `__AIOS_TOKEN__` in that file's own served bytes; everything under /static/
 * (this file included) is served as a plain, unmodified static asset with no such substitution. The
 * constant and its window.fetch wrapper have to live somewhere the server actually templates into.
 */
import { esc } from './dashboard-utils.mjs';
import { renderParked } from './escalation-actions.mjs';
import { renderFounderUsage, renderProviderCost } from './spend-budget.mjs';
import { renderSystemLog } from './daemon-console.mjs';
import { populateControls } from './policy-levers.mjs';
import { reportError } from './client-error-log.mjs';
import { runPollHandlers } from './poll-dispatcher.mjs';
import { operationalPollingInterval, operationalStatusPresentation } from '/static/app/shared/legacy-adapters.mjs';
import './optimization.mjs';
import './ide-integration.mjs';
import './subscriptions.mjs';

const $=id=>document.getElementById(id);
const fmt=n=>n==null?'—':(n>=1e6?(n/1e6).toFixed(1)+'M':Math.round(n/1000)+'k');
// spend-budget.mjs's renderFounderUsage/renderProviderCost (US3) and policy-levers.mjs's
// syncReadouts (US8) call this — fmt() itself stays here (a page-level display helper, not one of
// the 64 migrated functions; deliberately not merged with dashboard-utils.mjs's formatNumber).
window.fmt = fmt;
let controlsInit=false;

const SAMPLE_STATUS = {
  "health": {
    "watchdog": { "running": true, "lastTickTs": "2026-07-04T09:14:00.000Z", "nextTickTs": "2026-07-04T09:15:00.000Z", "intervalSec": 60 },
    "agents": {
      "claude":      { "state": "active", "reason": null,             "lastHeartbeatTs": "2026-07-04T09:13:40.000Z", "heartbeatAgeSec": 42,   "leaseTask": "F1-1.9-admin-backend", "leaseExpiresTs": "2026-07-04T09:44:00.000Z" },
      "antigravity": { "state": "idle",   "reason": null,             "lastHeartbeatTs": "2026-07-04T08:31:55.000Z", "heartbeatAgeSec": 2547, "leaseTask": null,                   "leaseExpiresTs": null }
    },
    "reaps": [
      { "ts": "2026-07-04T07:12:00.000Z", "task": "F2-3-photo-tools-ui", "owner": "antigravity", "reapCount": 1, "sessionAgeSec": 2100 }
    ],
    "slaBreaches": []
  },
  "runner": {
    "cadence": "every_30m",
    "enabled": true,
    "nextRunTs": "2026-07-04T09:30:00.000Z",
    "lastRunTs": "2026-07-04T09:02:10.000Z",
    "quietHours": { "enabled": true, "from": "01:00", "to": "07:00", "sleepingNow": false, "resumesAt": null },
    "holdReason": null,
    "runsThisWindow": 3,
    "maxRunsPerWindow": 8
  },
  "verifier": {
    "mode": "peer_agent_review",
    "pending": [
      {
        "task": "F1-1.9-admin-backend", "pr": 33, "agent": "claude", "submittedTs": "2026-07-04T09:03:00.000Z",
        "checks": [
          { "name": "tests",      "status": "pass",    "detail": "42/42" },
          { "name": "guardrails", "status": "pass",    "detail": "clean" },
          { "name": "peer-review","status": "pending", "detail": "antigravity reviewing" }
        ],
        "verdict": "pending"
      }
    ],
    "recent": [
      { "task": "F1-1.7-ui", "pr": 25, "verdict": "pass", "ts": "2026-07-03T22:10:00.000Z", "mergedBy": "verifier" }
    ]
  },
  "planner": {
    "backlogDepth": 2,
    "epics": [
      { "id": "F1-1", "title": "Platform Revamp",                    "status": "in-progress", "childrenReady": 0, "childrenTotal": 13 },
      { "id": "F2",   "title": "AI virtual staging / photo cleanup", "status": "designing",   "childrenReady": 0, "childrenTotal": 4 }
    ],
    "proposals": [
      { "id": "F4-nl-search.1", "title": "Seed catalog loader", "fromEpic": "F4-nl-search", "priority": 70, "resources": ["packages/data-access"], "status": "proposed" }
    ],
    "lastPlannedTs": "2026-07-04T06:00:00.000Z"
  },
  "escalations": [
    { "id": "esc-1024", "ts": "2026-07-04T09:05:00.000Z", "severity": "warn",     "kind": "budget_warn",      "title": "Claude weekly budget at 83%",  "detail": "8.3M / 10M tokens this week — auto-downgrade is off.",                          "task": null,               "action": null },
    { "id": "esc-1023", "ts": "2026-07-04T07:12:00.000Z", "severity": "info",     "kind": "lease_reaped",     "title": "Reaped a stalled lease",       "detail": "F2-3-photo-tools-ui lease expired with no heartbeat; returned to the pool.",   "task": "F2-3-photo-tools-ui","action": null, "status": "ready-for-impl", "owner": "claude" },
    { "id": "esc-1019", "ts": "2026-07-03T18:40:00.000Z", "severity": "critical", "kind": "sensitive_action", "title": "Schema change needs you",      "detail": "claude paused on F1-1.13-migrations: schema_change = block_and_ask.",           "task": "F1-1.13-migrations", "action": { "label": "Open task", "endpoint": null, "payload": null } },
    { "id": "esc-task_blocked-F2-pay", "ts": "2026-07-04T06:30:00.000Z", "severity": "warn", "kind": "task_blocked", "title": "Blocked: F2-pay", "detail": "governance hold: spend money", "task": "F2-pay", "action": { "label": "Open task", "endpoint": null, "payload": null }, "status": "blocked", "owner": "claude" }
  ],
  "parked": [
    { "task": "F2-3-photo-tools-ui-dropzone", "status": "blocked", "owner": "claude", "note": "governance hold: external send [founder-skipped:waiting on legal]", "skipped": true, "snoozedUntil": null },
    { "task": "F3-spec", "status": "blocked", "owner": "claude", "note": "governance hold: spend money [founder-snoozed:2026-07-11T00:00:00.000Z]", "skipped": false, "snoozedUntil": "2026-07-11T00:00:00.000Z" }
  ]
};

function render(s){
  renderFounderUsage(s.budget);
  renderProviderCost(s.budget.providerUsage && s.budget.providerUsage.last7d);
  $('clock').textContent=new Date(s.ts).toLocaleTimeString();
  window.kill=!!s.kill_switch; $('dot').style.background=operationalStatusPresentation({ killSwitch: window.kill }).color;
  renderParked(s.parked||[]);
  renderTaskCategories(s.taskCategories);
  renderSystemLog(s.systemLog||[]);
  if(!controlsInit){ populateControls(s.policy||{}); controlsInit=true; }
}

async function poll(){
  try{
    const r=await fetch('/api/status');
    let s=await r.json();
    if(location.search.includes('mock')){
      for (const k of ['health', 'runner', 'verifier', 'planner', 'escalations', 'parked']) {
        if (s[k] === undefined) s[k] = SAMPLE_STATUS[k];
      }
    }
    render(s);
    if(!window.kill)$('dot').style.background=operationalStatusPresentation().color;
  }
  catch(e){ const status=operationalStatusPresentation({ offline: true }); $('dot').style.background=status.color; $('clock').textContent=status.label; reportError('poll', e); }
  // 009 — Dashboard Modernization (US3/FR-008): every feature that used to chain onto poll via
  // reassign the global poll variable itself now registers through poll-dispatcher.mjs's
  // registerPollHandler() instead. Each handler's failure is isolated and reported individually;
  // one throwing never stops or delays the others.
  await runPollHandlers();
}
// escalation-actions.mjs's postAction() and daemon-console.mjs's runCmd() call poll() on success —
// same bridge pattern as window.fmt above.
window.poll = poll;

function renderTaskCategories(categories) {
  const el = $('taskCategoriesBody');
  if (!categories || typeof categories !== 'object') { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no task categories data</div>'; return; }
  const entries = Object.entries(categories).filter(([k]) => k !== '_uncategorized');
  const uncat = categories._uncategorized;
  if (!entries.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no categories defined</div>'; return; }
  let htm = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">';
  for (const [type, cat] of entries) {
    htm += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px"><div style="font-size:12px;font-weight:500;color:var(--text-secondary)">${cat.icon || ''} ${esc(cat.label || type)}</div><div style="font-size:20px;font-weight:600;margin-top:2px">${cat.total}</div></div>`;
  }
  if (uncat && uncat.total) {
    htm += `<div style="border:1px dashed var(--border);border-radius:8px;padding:8px 10px"><div style="font-size:12px;font-weight:500;color:var(--text-muted)">${uncat.icon || ''} ${esc(uncat.label)}</div><div style="font-size:20px;font-weight:600;margin-top:2px;color:var(--text-muted)">${uncat.total}</div></div>`;
  }
  htm += '</div>';
  el.innerHTML = htm;
}

const POLL_MS=operationalPollingInterval(10000);
let pollTimer=null;
function startPolling(){ if(pollTimer) return; poll(); pollTimer=setInterval(()=>poll(),POLL_MS); }
function stopPolling(){ clearInterval(pollTimer); pollTimer=null; }
// daemon-console.mjs's stopScheduler/restartDaemon (US7) call these — same bridge pattern as
// window.poll.
window.startPolling = startPolling;
window.stopPolling = stopPolling;
$('refresh').addEventListener('click',()=>poll());
document.addEventListener('visibilitychange',()=>{ document.hidden ? stopPolling() : startPolling(); });
startPolling();

// 008 — End-User Configurability: Settings/Observability workspace visibility toggle. The Muuri
// grid computes item positions from layout at init time, so it must only ever be initialized
// while #settingsPanel is actually visible (display:block) — initializing it while hidden
// (display:none) would give Muuri a zero-size container and every panel would stack at (0,0).
let _settingsWorkspaceInitialized = false;
function showSettingsWorkspace() {
  document.getElementById('settingsPanel').style.display = 'block';
  if (!_settingsWorkspaceInitialized) {
    _settingsWorkspaceInitialized = true;
    import('./settings-workspace-bootstrap.mjs');
  }
}
window.showSettingsWorkspace = showSettingsWorkspace;
function toggleSettingsWorkspace() {
  const panel = document.getElementById('settingsPanel');
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  showSettingsWorkspace();
}
window.toggleSettingsWorkspace = toggleSettingsWorkspace;

// 008 — Team Collaboration (US3): same lazy-load-on-first-open pattern as Settings above.
let _teamWorkspaceInitialized = false;
async function showTeamWorkspace() {
  document.getElementById('teamPanel').style.display = 'block';
  if (!_teamWorkspaceInitialized) {
    _teamWorkspaceInitialized = true;
    const { initTeamWorkspace } = await import('./team-bootstrap.mjs');
    initTeamWorkspace(document.getElementById('teamWorkspaceContainer'));
  }
}
function toggleTeamWorkspace() {
  const panel = document.getElementById('teamPanel');
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  showTeamWorkspace();
}
window.toggleTeamWorkspace = toggleTeamWorkspace;

// Admin workspace (Projects/Templates/API Keys/Billing/Compliance/Marketplace): same
// lazy-load-on-first-open pattern as Team/Settings above.
let _adminWorkspaceInitialized = false;
async function showAdminWorkspace() {
  document.getElementById('adminPanel').style.display = 'block';
  if (!_adminWorkspaceInitialized) {
    _adminWorkspaceInitialized = true;
    const { initAdminWorkspace } = await import('./admin-bootstrap.mjs');
    initAdminWorkspace(document.getElementById('adminWorkspaceContainer'));
  }
}
function toggleAdminWorkspace() {
  const panel = document.getElementById('adminPanel');
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  showAdminWorkspace();
}
window.toggleAdminWorkspace = toggleAdminWorkspace;

// 009 — Dashboard Modernization (US2/FR-003): the panel-grid workspace is now the default view on
// page load instead of a hidden overlay behind the "⚙ Settings" nav button. Placed here — the true
// end of the script, after every `let`/function declaration above has executed — rather than near
// startPolling() earlier: showSettingsWorkspace() is a hoisted function declaration (safe to call
// early), but its body reads `_settingsWorkspaceInitialized`, a `let` binding that is NOT usable
// until its own declaration line runs (the temporal dead zone). Calling it too early threw
// `ReferenceError: Cannot access '_settingsWorkspaceInitialized' before initialization` — caught
// live, not by any static check. toggleSettingsWorkspace() (bound to the nav button) still works as
// a collapse/expand shortcut afterward — this only changes the INITIAL state, not the toggle behavior.
showSettingsWorkspace();
