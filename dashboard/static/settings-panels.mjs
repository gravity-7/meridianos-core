/**
 * settings-panels — config panels for the Settings/Observability workspace (008 — End-User
 * Configurability, US1/FR-001, US2/FR-007). Writes go through the existing `POST /api/policy` →
 * `LEVER_PATHS` → `policy-write.mjs` path (FR-002) — the same mechanism the pre-existing
 * scattered controls (agent budget tiles, quiet-hours, etc.) already use, not a parallel write
 * mechanism. Per spec.md's Assumptions, "Agents / Providers / Models / Budget" categories already
 * have dashboard UI elsewhere and are out of scope here beyond linking to them; this module covers
 * the genuine remaining gaps: General/Gateway fields, the profile selector, and backup/restore.
 */
import { registerPanel } from './settings-workspace.mjs';

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

// ─── Kill switch ────────────────────────────────────────────────────────────

async function renderKillSwitch(el) {
  el.innerHTML = `
    <label class="workspace-lever-row">
      <input type="checkbox" id="ws-kill-switch">
      <span>Kill switch (halt all agent work immediately)</span>
    </label>
    <div class="workspace-panel-status" id="ws-kill-switch-status"></div>
  `;
  const checkbox = el.querySelector('#ws-kill-switch');
  const status = el.querySelector('#ws-kill-switch-status');

  try {
    const body = await fetchJson('/api/status');
    checkbox.checked = Boolean(body?.kill_switch);
  } catch {
    // status fetch failing shouldn't block the panel from being usable.
  }

  checkbox.addEventListener('change', async () => {
    const ok = await saveLever({ kill_switch: checkbox.checked }, status);
    if (!ok) checkbox.checked = !checkbox.checked; // revert the optimistic toggle
  });
}

// ─── General / Gateway ──────────────────────────────────────────────────────
// Per spec.md's Assumptions: Agents/Providers/Models/Budget already have dashboard UI elsewhere,
// out of scope here beyond linking. gateway.port is the one genuinely real, currently-unwritable
// field found by auditing actual runtime reads (see policy-write.mjs's LEVER_PATHS comment for
// why "logging toggle"/"enforcement mode" were deliberately NOT added — no backing behavior).

async function renderGeneralGateway(el) {
  el.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
      Agent / Provider / Model / Budget settings live in their existing cards below — this panel
      covers what's new here.
    </div>
    <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;margin-bottom:8px">
      <span>Gateway port</span>
      <input type="number" id="ws-gateway-port" min="1024" max="65535" style="width:120px">
    </label>
    <button id="ws-gateway-port-save" style="font-size:12px;padding:4px 10px">Save</button>
    <div class="workspace-panel-status" id="ws-gateway-status"></div>
  `;
  const input = el.querySelector('#ws-gateway-port');
  const status = el.querySelector('#ws-gateway-status');

  try {
    const body = await fetchJson('/api/status');
    if (body?.gateway?.port != null) input.value = body.gateway.port;
  } catch {
    // no gateway status available yet — leave the field blank rather than block the panel.
  }

  el.querySelector('#ws-gateway-port-save').addEventListener('click', async () => {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      status.textContent = 'Port must be an integer between 1024 and 65535.';
      return;
    }
    await saveLever({ 'gateway.port': value }, status);
  });
}

// ─── Profile selector (US2/FR-007) ──────────────────────────────────────────

async function renderProfileSelector(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let data;
  try {
    data = await fetchJson('/api/config/profiles');
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Profiles unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  if (data.profiles.length === 0) {
    el.innerHTML = `
      <div class="workspace-panel-empty">
        No profiles defined. Add a <code>profiles:</code> block to policy.yaml
        (each entry may set <code>extends: &lt;name&gt;</code>) to enable switching.
      </div>
    `;
    return;
  }

  const options = data.profiles
    .map((p) => `<option value="${p.name}" ${p.name === data.active ? 'selected' : ''}>${p.name}${p.extends ? ` (extends ${p.extends})` : ''}</option>`)
    .join('');
  el.innerHTML = `
    <label style="display:flex;flex-direction:column;gap:4px;font-size:13px">
      <span>Active profile</span>
      <select id="ws-profile-select">
        <option value="" ${!data.active ? 'selected' : ''}>— none —</option>
        ${options}
      </select>
    </label>
    <div class="workspace-panel-status" id="ws-profile-status"></div>
  `;
  const select = el.querySelector('#ws-profile-select');
  const status = el.querySelector('#ws-profile-status');
  select.addEventListener('change', () => {
    saveLever({ active_profile: select.value || null }, status);
  });
}

// ─── Backups (US1/FR-003) ───────────────────────────────────────────────────

async function renderBackups(el) {
  el.innerHTML = '<div class="workspace-panel-loading">Loading…</div>';
  let data;
  try {
    data = await fetchJson('/api/config/backups');
  } catch (err) {
    el.innerHTML = `<div class="workspace-panel-error">Backups unavailable: ${String(err.message ?? err)}</div>`;
    return;
  }

  if (data.backups.length === 0) {
    el.innerHTML = '<div class="workspace-panel-empty">No backups yet — one is created on every Settings save.</div>';
    return;
  }

  const rows = data.backups
    .map((b) => `<li style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;padding:4px 0">
        <span class="mono">${b.timestamp}</span>
        <button data-timestamp="${b.timestamp}" class="ws-restore-btn" style="font-size:11px;padding:2px 8px">Restore</button>
      </li>`)
    .join('');
  el.innerHTML = `<ul style="list-style:none;padding:0;margin:0;max-height:180px;overflow:auto">${rows}</ul><div class="workspace-panel-status" id="ws-backups-status"></div>`;

  const status = el.querySelector('#ws-backups-status');
  el.querySelectorAll('.ws-restore-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const timestamp = btn.dataset.timestamp;
      if (!confirm(`Restore the backup from ${timestamp}? The current policy.yaml will itself be backed up first.`)) return;
      status.textContent = 'Restoring…';
      try {
        const result = await fetchJson(`/api/config/restore/${encodeURIComponent(timestamp)}`, { method: 'POST' });
        if (!result.ok) throw new Error(result.error ?? 'restore failed');
        status.textContent = 'Restored. Reloading panels…';
        setTimeout(() => renderBackups(el), 1000);
      } catch (err) {
        status.textContent = `Restore failed: ${String(err.message ?? err)}`;
      }
    });
  });
}

export function registerSettingsPanels() {
  registerPanel('settings-kill-switch', 'Kill Switch', renderKillSwitch);
  registerPanel('settings-general-gateway', 'General / Gateway', renderGeneralGateway);
  registerPanel('settings-profiles', 'Profiles', renderProfileSelector);
  registerPanel('settings-backups', 'Backups', renderBackups);
}
