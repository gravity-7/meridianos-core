/**
 * ide-integration — 010 Frontend ES Module Migration, US5. IDE Connect panel (detect/config/test),
 * MCP config panel, and IDE traffic status (Copilot panel). Fully self-contained, untouched and
 * unmentioned by 009 — already dispatcher-registered, so this is a mechanical port with zero
 * cross-story coupling.
 */
import { esc } from './dashboard-utils.mjs';
import { reportError } from './client-error-log.mjs';
import { registerPollHandler } from './poll-dispatcher.mjs';

// ─── P4: IDE Connect Panel ──────────────────────────────────────────────────

export async function fetchIdeDetect() {
  try {
    const r = await fetch('/api/ide/detect');
    const j = await r.json();
    if (j.ides) renderIdeCards(j.ides);
    else document.getElementById('ideDetectStatus').textContent = 'Detection unavailable.';
  } catch {
    document.getElementById('ideDetectStatus').textContent = 'Detection unavailable — is the daemon running?';
  }
}

export function renderIdeCards(ides) {
  if (!ides || !ides.length) return;
  const installed = ides.filter(i => i.installed);
  document.getElementById('ideDetectStatus').textContent = installed.length + ' of ' + ides.length + ' supported IDEs detected';

  const cardsEl = document.getElementById('ideCards');
  let htm = '';
  for (const ide of ides) {
    const statusIcon = ide.installed ? '✓ Installed' : '✗ Not found';
    const statusColor = ide.installed ? 'var(--text-success)' : 'var(--text-muted)';
    htm += `<div style="border:1px solid var(--border);border-radius:var(--radius);padding:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-weight:500">${esc(ide.displayName)}</span>
        <span style="font-size:11px;color:${statusColor}">${statusIcon}</span>
        ${ide.installed && ide.detectionMethod ? `<span class="badge b-muted" style="font-size:10px">${esc(ide.detectionMethod)}</span>` : ''}
      </div>
      ${ide.installed ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="fetchIdeConfig('${esc(ide.ideName)}')" style="font-size:11px;padding:4px 8px">View Config</button>
          <button onclick="testIdeConn('${esc(ide.ideName)}')" style="font-size:11px;padding:4px 8px">Test Connection</button>
        </div>
        <pre id="ideCfg-${esc(ide.ideName)}" style="display:none;margin-top:8px;padding:8px;background:var(--surface-1);border-radius:4px;font-size:11px;max-height:120px;overflow:auto"></pre>
        <span id="ideTest-${esc(ide.ideName)}" style="display:block;margin-top:6px;font-size:11px;color:var(--text-muted)"></span>
      ` : ''}
    </div>`;
  }

  if (!installed.length) {
    document.getElementById('ideNoIdes').style.display = 'block';
    htm += '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">No IDEs detected. Use the generic proxy above.</div>';
  } else {
    document.getElementById('ideNoIdes').style.display = 'none';
  }
  cardsEl.innerHTML = htm;
}

export async function fetchIdeConfig(ideName) {
  const pre = document.getElementById('ideCfg-' + ideName);
  if (pre.style.display === 'block') { pre.style.display = 'none'; return; }
  try {
    const r = await fetch('/api/ide/config/' + ideName);
    const j = await r.json();
    pre.textContent = j.content || JSON.stringify(j, null, 2);
    pre.style.display = 'block';
    if (j.instructions) {
      pre.textContent = '// ' + j.instructions.replace(/\n/g, '\n// ') + '\n\n' + pre.textContent;
    }
  } catch {
    pre.textContent = 'Failed to load config.';
    pre.style.display = 'block';
  }
}
window.fetchIdeConfig = fetchIdeConfig;

export async function testIdeConn(ideName) {
  const el = document.getElementById('ideTest-' + ideName);
  el.textContent = 'Testing…';
  try {
    const r = await fetch('/api/ide/test/' + ideName, { method: 'POST' });
    const j = await r.json();
    el.textContent = j.ok ? `✓ Connected (${j.latencyMs}ms)` : `✗ ${j.errorCode}: ${j.errorMessage || 'Test failed'}`;
    el.style.color = j.ok ? 'var(--text-success)' : 'var(--text-danger)';
  } catch {
    el.textContent = '✗ Test request failed.';
    el.style.color = 'var(--text-danger)';
  }
}
window.testIdeConn = testIdeConn;

// ─── P4: MCP Config Panel ───────────────────────────────────────────────────

export async function fetchMcpConfig() {
  try {
    const r = await fetch('/api/mcp/config');
    const j = await r.json();
    document.getElementById('mcpConfigJson').textContent = JSON.stringify(j.config, null, 2);
  } catch {
    document.getElementById('mcpConfigJson').textContent = 'Failed to load MCP config. Is the daemon running?';
  }
}
document.getElementById('mcpCopyBtn').addEventListener('click', () => {
  const text = document.getElementById('mcpConfigJson').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('mcpCopyBtn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  });
});

// ─── P4: IDE Traffic Status (Copilot Panel) ─────────────────────────────────

export async function fetchIdeStatus() {
  try {
    const r = await fetch('/api/ide/status?period=week');
    const j = await r.json();
    if (j.byIde && j.byIde.length > 0) {
      document.getElementById('copilotPanel').style.display = 'block';
      const badge = document.getElementById('copilotStatusBadge');
      const statusColors = {
        working: { bg: 'var(--bg-success)', color: 'var(--text-success)', text: '✓ Copilot Working' },
        partial: { bg: 'var(--bg-warning)', color: 'var(--text-warning)', text: '⚠️ Partial Coverage' },
        unavailable: { bg: 'var(--bg-danger)', color: 'var(--text-danger)', text: '✗ Copilot Unavailable' },
        unknown: { bg: 'var(--surface-1)', color: 'var(--text-muted)', text: '— Copilot Status Unknown' },
      };
      const s = statusColors[j.copilotStatus] || statusColors.unknown;
      badge.style.background = s.bg;
      badge.style.color = s.color;
      badge.textContent = s.text;

      document.getElementById('copilotNote').textContent = j.copilotStatusNote || '';
      document.getElementById('copilotPrivacy').style.display = 'block';
    }
  } catch (e) {
    // Copilot monitoring requires the gateway feature — panel staying hidden on failure is still
    // correct UX (no misleading "unavailable" banner for a feature most installs don't use), but the
    // failure itself is still worth a low-severity report for diagnosability.
    reportError('fetchIdeStatus', e, { severity: 'info' });
  }
}

registerPollHandler(fetchIdeDetect);
registerPollHandler(fetchMcpConfig);
registerPollHandler(fetchIdeStatus);
