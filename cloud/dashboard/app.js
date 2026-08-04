/**
 * cloud/dashboard/app.js — client for the cloud control plane's own tiny dashboard (T088).
 * Talks to cloud/cloud-server.mjs's REST endpoints; the bearer token IS the user id (see
 * cloud-server.mjs's sessionUser doc comment — a local-dev simplification, not production auth).
 */
let token = localStorage.getItem('cloud_token');

const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
  }).then((r) => r.json());
}

async function loadMachines() {
  const { machines } = await api('/api/cloud/machines');
  const tbody = document.querySelector('#machines-table tbody');
  tbody.innerHTML = (machines ?? []).map((m) => `
    <tr>
      <td>${m.name ?? m.id}</td>
      <td>${m.os_type ?? '-'}</td>
      <td>${m.meridianos_version ?? '-'}</td>
      <td class="status-${m.status}">${m.status}</td>
      <td>${m.last_seen ? new Date(m.last_seen * 1000).toLocaleString() : 'never'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">No machines connected yet.</td></tr>';
}

async function loadHealth() {
  const health = await api('/api/cloud/health');
  const tbody = document.querySelector('#health-table tbody');
  tbody.innerHTML = Object.entries(health ?? {}).map(([provider, info]) => `
    <tr><td>${provider}</td><td class="status-${info.overall}">${info.overall}</td><td>${info.machines.length}</td></tr>
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
  localStorage.setItem('cloud_token', token);
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
  const result = await api('/api/cloud/policy', { method: 'POST', body: JSON.stringify({ updates: { [path]: value } }) });
  document.getElementById('policy-result').textContent = result.pushed
    ? `Pushed to all connected machines — they'll pick it up on their next report (within their configured interval).`
    : (result.message ?? 'Push failed');
});

if (token) {
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  refresh();
}
