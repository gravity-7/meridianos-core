/**
 * cloud/dashboard/app.js — client for the cloud control plane's own tiny dashboard (T088).
 * Talks to cloud/cloud-server.mjs's REST endpoints; the bearer token IS the user id (see
 * cloud-server.mjs's sessionUser doc comment — a local-dev simplification, not production auth).
 */
let token = localStorage.getItem('cloud_token');
let authenticatedAt = Number(localStorage.getItem('cloud_authenticated_at')) || 0;

const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
  }).then((r) => r.json());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function loadMachines() {
  const { machines } = await api('/api/cloud/machines');
  const tbody = document.querySelector('#machines-table tbody');
  tbody.innerHTML = (machines ?? []).map((m) => `
    <tr>
      <td>${escapeHtml(m.name ?? m.id)}</td>
      <td>${escapeHtml(m.os_type ?? '-')}</td>
      <td>${escapeHtml(m.meridianos_version ?? '-')}</td>
      <td class="status-${escapeHtml(m.status)}">${escapeHtml(m.status)}</td>
      <td>${escapeHtml(m.last_seen ? new Date(m.last_seen * 1000).toLocaleString() : 'never')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">No machines connected yet.</td></tr>';
}

async function loadHealth() {
  const health = await api('/api/cloud/health');
  const tbody = document.querySelector('#health-table tbody');
  tbody.innerHTML = Object.entries(health ?? {}).map(([provider, info]) => `
    <tr><td>${escapeHtml(provider)}</td><td class="status-${escapeHtml(info.overall)}">${escapeHtml(info.overall)}</td><td>${Number(info.machines?.length) || 0}</td></tr>
  `).join('') || '<tr><td colspan="3">No health data reported yet.</td></tr>';
}

async function refresh() {
  await Promise.all([loadMachines(), loadHealth()]);
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const result = await api('/api/cloud/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!result.token) {
    document.getElementById('login-error').textContent = result.message ?? 'Login failed';
    return;
  }
  token = result.token;
  authenticatedAt = Number(result.authenticatedAt) || Date.now();
  localStorage.setItem('cloud_token', token);
  localStorage.setItem('cloud_authenticated_at', String(authenticatedAt));
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  refresh();
});

document.getElementById('policy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const path = document.getElementById('policy-path').value;
  let value;
  try { value = JSON.parse(document.getElementById('policy-value').value); }
  catch { value = document.getElementById('policy-value').value; }
  const result = await api('/api/cloud/policy/preview', { method: 'POST', body: JSON.stringify({ updates: { [path]: value } }) });
  const status = document.getElementById('policy-result'); const previewHost = document.getElementById('policy-preview');
  if (!result.id) { status.textContent = result.message ?? 'Preview failed'; previewHost.classList.add('hidden'); return; }
  previewHost.classList.remove('hidden');
  const eligible = (result.targets ?? []).filter((target) => target.eligible).length;
  previewHost.innerHTML = `<p><strong>Preview ${escapeHtml(result.id)}</strong>: ${eligible} of ${(result.targets ?? []).length} machine(s) are eligible. No policy has been pushed.</p><button id="confirm-policy" type="button">Confirm with APPLY POLICY</button> <button id="rollback-policy" type="button" disabled>Rollback boundary</button>`;
  status.textContent = 'Review the target list and confirm only when the change is expected.';
  document.getElementById('confirm-policy').addEventListener('click', async () => {
    const confirmation = window.prompt('Type APPLY POLICY to confirm this change.');
    if (confirmation !== 'APPLY POLICY') { status.textContent = 'Confirmation cancelled; no policy was pushed.'; return; }
    const confirmed = await api(`/api/cloud/policy/${encodeURIComponent(result.id)}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation }) });
    status.textContent = confirmed.outcome ? `Policy result: ${confirmed.outcome}. Review machine outcomes before proceeding.` : (confirmed.message ?? 'Policy confirmation failed');
    document.getElementById('confirm-policy').disabled = true;
    document.getElementById('rollback-policy').disabled = !confirmed.outcome;
  });
  document.getElementById('rollback-policy').addEventListener('click', async () => {
    const rolledBack = await api(`/api/cloud/policy/${encodeURIComponent(result.id)}/rollback`, { method: 'POST', body: '{}' });
    status.textContent = rolledBack.message ?? `Rollback boundary: ${rolledBack.outcome ?? 'recorded'}.`;
  });
});

if (token) {
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  refresh();
}
