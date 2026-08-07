/**
 * daemon-console — 010 Frontend ES Module Migration, US7. Quick Command buttons, system log, and
 * the light/dark theme toggle. Calls initCmdButtons() itself at module-evaluation time, matching
 * the previous bare top-level call — the one piece of load-time initialization in this story that
 * isn't dispatcher- or onclick-triggered.
 *
 * runCmd calls poll(); stopScheduler/restartDaemon call stopPolling()/startPolling() — none of
 * those three move until US9, so this module reaches them via the window bridges dashboard/index.html
 * already carries (window.poll from US2; window.startPolling/window.stopPolling added alongside
 * this story).
 */
import { esc } from './dashboard-utils.mjs';
import { reportError } from './client-error-log.mjs';

let currentTheme = localStorage.getItem('aios-theme') || 'auto';
const rootElement = document.documentElement;
if (currentTheme !== 'auto') rootElement.setAttribute('data-theme', currentTheme);

export function updateThemeIcon() {
  const isDark = currentTheme === 'dark' || (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.getElementById('themeIcon').innerHTML = isDark ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
}
updateThemeIcon();
document.getElementById('themeToggle').onclick = () => {
  currentTheme = currentTheme === 'auto' ? 'dark' : (currentTheme === 'dark' ? 'light' : 'auto');
  if (currentTheme === 'auto') rootElement.removeAttribute('data-theme');
  else rootElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('aios-theme', currentTheme);
  updateThemeIcon();
};
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentTheme === 'auto') updateThemeIcon();
});

export function renderSystemLog(events) {
  const el = document.getElementById('sysLogList');
  if (!events || !events.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">no events yet</div>'; return; }
  const lvlBadge = l => l === 'error' || l === 'fatal' ? 'b-danger' : (l === 'warn' ? 'b-warn' : 'b-ok');
  el.innerHTML = events.map(e => {
    const t = e.ts ? new Date(e.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
    const d = e.detail ? ('<div class="mono" style="font-size:11px;color:var(--text-muted);margin-top:2px;word-break:break-all">' + esc(String(e.detail).slice(0, 200)) + '</div>') : '';
    return `<div class="row" style="align-items:flex-start"><span class="mono" style="font-size:11px;color:var(--text-muted);min-width:60px">${t}</span><span class="badge ${lvlBadge(e.level)}" style="min-width:38px;text-align:center">${esc(e.level)}</span><div style="flex:1;min-width:0"><div style="font-size:12px"><span style="color:var(--text-secondary)">${esc(e.source)}</span> <span class="mono">${esc(e.event)}</span></div>${d}</div></div>`;
  }).join('');
}

const CMD_LIST = ['validate','list','run --dry','tick','plan','render','verify --dry','reap','seed'];
const CMD_ICONS = {validate:'✓',list:'☰','run --dry':'▶',tick:'⟳',plan:'◈',render:'⎙','verify --dry':'⚑',reap:'✂',seed:'⬢'};
let cmdRunning = false;

export function initCmdButtons() {
  const el = document.getElementById('cmdButtons');
  el.innerHTML = CMD_LIST.map(c => `<button class="cmd-btn" data-cmd="${esc(c)}" onclick="runCmd('${esc(c)}')" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:6px 12px;font-family:var(--font-mono)"><span style="font-size:14px">${CMD_ICONS[c]||'›'}</span>${esc(c)}</button>`).join('')
    + '<span style="display:inline-block;width:1px;height:24px;background:var(--border-strong);margin:0 4px"></span>'
    + '<button onclick="stopScheduler()" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:6px 12px;font-family:var(--font-mono);color:var(--text-danger);border-color:var(--text-danger)"><span style="font-size:14px">⏻</span>stop</button>'
    + '<button onclick="restartDaemon()" title="Stop the daemon, pull the latest main, and restart it (~10s)" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:6px 12px;font-family:var(--font-mono);color:var(--text-accent);border-color:var(--text-accent)"><span style="font-size:14px">↻</span>restart &amp; update</button>';
}

export async function runCmd(name) {
  if (cmdRunning) return;
  cmdRunning = true;
  const btns = document.querySelectorAll('.cmd-btn');
  btns.forEach(b => { b.disabled = true; if (b.dataset.cmd === name) b.style.borderColor = 'var(--fill-accent)'; });
  const out = document.getElementById('cmdOutput'), pre = document.getElementById('cmdPre'), label = document.getElementById('cmdLabel');
  out.style.display = 'block';
  label.textContent = '$ node tools/aios/cli.mjs ' + name.replace('--dry', '-- dry').replace('-- dry', '--dry');
  pre.textContent = 'running…';
  pre.style.color = 'var(--text-muted)';
  try {
    const r = await fetch('/api/exec', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ command: name }) });
    const j = await r.json();
    const text = (j.stdout || '') + (j.stderr ? '\n' + j.stderr : '');
    pre.textContent = text.trim() || '(no output)';
    pre.style.color = j.ok ? 'var(--text-primary)' : 'var(--text-danger)';
    if (!j.ok) label.textContent += ' — exit ' + (j.exitCode ?? 1);
    window.poll();
  } catch (e) {
    pre.textContent = 'failed: ' + e.message;
    pre.style.color = 'var(--text-danger)';
  }
  cmdRunning = false;
  btns.forEach(b => { b.disabled = false; b.style.borderColor = ''; });
}
window.runCmd = runCmd;

export function clearCmdOutput() { document.getElementById('cmdOutput').style.display = 'none'; document.getElementById('cmdPre').textContent = ''; }
window.clearCmdOutput = clearCmdOutput;

export async function stopScheduler() {
  if (!confirm('Stop the scheduler? You will need to restart it manually.')) return;
  const out = document.getElementById('cmdOutput'), pre = document.getElementById('cmdPre'), label = document.getElementById('cmdLabel');
  out.style.display = 'block'; label.textContent = 'stopping scheduler…'; pre.textContent = 'sending stop signal…'; pre.style.color = 'var(--text-muted)';
  try {
    const r = await fetch('/api/stop', { method: 'POST' });
    const j = await r.json();
    pre.textContent = j.message || 'stop signal sent'; pre.style.color = 'var(--text-warning)';
    label.textContent = 'scheduler stopped — restart with: node tools/aios/scheduler.mjs';
    window.stopPolling();
  } catch (e) { pre.textContent = 'connection lost — scheduler has stopped'; pre.style.color = 'var(--text-warning)'; label.textContent = 'scheduler stopped — restart with: node tools/aios/scheduler.mjs'; window.stopPolling(); }
}
window.stopScheduler = stopScheduler;

export async function restartDaemon() {
  if (!confirm('Restart & update the daemon?\n\nIt will stop, pull the latest main (picking up any merged tools/aios changes), and restart — about 10 seconds of downtime. The dashboard will briefly disconnect, then reconnect.')) return;
  const out = document.getElementById('cmdOutput'), pre = document.getElementById('cmdPre'), label = document.getElementById('cmdLabel');
  out.style.display = 'block'; label.textContent = 'restarting & updating daemon…';
  pre.textContent = 'stopping → git pull --ff-only origin main → starting…'; pre.style.color = 'var(--text-muted)';
  try {
    const r = await fetch('/api/restart', { method: 'POST' });
    const j = await r.json();
    pre.textContent = j.ok ? (j.message || 'restart requested') : ('restart failed: ' + (j.error || 'unknown'));
    pre.style.color = j.ok ? 'var(--text-warning)' : 'var(--text-danger)';
  } catch (e) {
    // Expected: the daemon goes down mid-request, so the fetch may error — that's the restart working.
    pre.textContent = 'daemon is restarting… reconnecting shortly.'; pre.style.color = 'var(--text-warning)';
  }
  window.stopPolling();
  // Poll the dashboard back to life, then resume.
  let tries = 0;
  const reconnect = setInterval(async () => {
    tries++;
    try {
      const s = await fetch('/api/status', { cache: 'no-store' });
      if (s.ok) { clearInterval(reconnect); label.textContent = 'daemon back up ✓'; window.startPolling(); }
    } catch (e) {
      // Expected during most of this loop — the daemon is mid-restart, so "still down" on any given
      // 2s tick is normal, not an error worth reporting 40 times. Only report once we've actually
      // given up (below), so the log has the one signal that matters instead of restart-loop noise.
      if (tries > 40) reportError('restartDaemon-reconnect', e, { severity: 'info' });
    }
    if (tries > 40) { clearInterval(reconnect); label.textContent = 'daemon did not come back — check .ai/runs/restart.log'; }
  }, 2000);
}
window.restartDaemon = restartDaemon;

initCmdButtons();
