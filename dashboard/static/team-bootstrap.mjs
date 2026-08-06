/**
 * team-bootstrap — wires renderTeamPanel (team-panel.mjs) to the real US3 Team Collaboration
 * API (dashboard/server.mjs: /api/projects, /api/projects/:id/members, /api/projects/:id/activity).
 * Loaded lazily by index.html's showTeamWorkspace() the first time the operator opens the Team
 * tab, matching the settings-workspace-bootstrap.mjs pattern (T012, 008 — End-User
 * Configurability) so the auth/team code is never fetched on a normal dashboard load.
 */
import { renderTeamPanel } from './team-panel.mjs';
import { getToken, getUser, authFetch, renderLoginPrompt, verifySession, clearSession } from './auth-client.mjs';

let container;
let currentProjectId = null;

export async function initTeamWorkspace(root) {
  container = root;
  const user = await verifySession();
  if (!user) {
    renderLoginPrompt(container, () => initTeamWorkspace(root));
    return;
  }
  await renderWorkspace(user);
}

async function renderWorkspace(user) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <label for="teamProjectSelect" style="font-size:12px;color:var(--text-secondary)">Project</label>
      <select id="teamProjectSelect" style="min-width:220px"></select>
      <span style="flex:1"></span>
      <span style="font-size:12px;color:var(--text-muted)">signed in as ${escapeHtml(user.email)}</span>
      <button id="teamSignOutBtn" class="btn btn-sm">Sign out</button>
    </div>
    <div id="teamProjectBody"><div class="empty-state"><p>Loading projects…</p></div></div>
  `;

  container.querySelector('#teamSignOutBtn').addEventListener('click', () => {
    clearSession();
    initTeamWorkspace(container);
  });

  const select = container.querySelector('#teamProjectSelect');
  const res = await authFetch('/api/projects');
  if (!res) return renderLoginPrompt(container, () => initTeamWorkspace(container));
  const result = await res.json();
  const projects = result.success ? result.projects : [];

  if (projects.length === 0) {
    container.querySelector('#teamProjectBody').innerHTML = '<div class="empty-state"><p>No projects yet.</p></div>';
    return;
  }

  select.innerHTML = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.id)}</option>`).join('');
  select.addEventListener('change', () => loadProject(select.value, user));

  currentProjectId = projects[0].id;
  select.value = currentProjectId;
  await loadProject(currentProjectId, user);
}

async function loadProject(projectId, user) {
  currentProjectId = projectId;
  const body = container.querySelector('#teamProjectBody');
  body.innerHTML = '<div class="empty-state"><p>Loading team…</p></div>';

  const [membersRes, activityRes] = await Promise.all([
    authFetch(`/api/projects/${encodeURIComponent(projectId)}/members`),
    authFetch(`/api/projects/${encodeURIComponent(projectId)}/activity?limit=25`),
  ]);
  if (!membersRes || !activityRes) return renderLoginPrompt(container, () => initTeamWorkspace(container));

  const membersResult = await membersRes.json();
  const activityResult = await activityRes.json();
  if (!membersResult.success) {
    body.innerHTML = `<div class="empty-state"><p>${escapeHtml(membersResult.error || 'Failed to load team')}</p></div>`;
    return;
  }

  const members = membersResult.members;
  const activities = activityResult.success ? activityResult.feed : [];
  const myMembership = members.find((m) => m.id === user.id);
  const canManage = user.role === 'admin' || myMembership?.role === 'admin';

  body.innerHTML = renderTeamPanel(members, activities, canManage);
  wireInteractions(body, projectId, canManage);
}

function wireInteractions(body, projectId, canManage) {
  const modal = body.querySelector('#invite-member-modal');
  const inviteBtn = body.querySelector('#invite-member-btn');
  if (inviteBtn && modal) {
    inviteBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    modal.querySelector('.close-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('.cancel-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('#invite-member-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = modal.querySelector('#invite-email').value.trim();
      const role = modal.querySelector('#invite-role').value;
      const res = await authFetch(`/api/projects/${encodeURIComponent(projectId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const result = res && await res.json();
      if (!result?.success) {
        alert('Invite failed: ' + (result?.error || 'unknown error'));
        return;
      }
      modal.classList.add('hidden');
      const user = getUser();
      await loadProject(projectId, user);
    });
  }

  if (!canManage) return;

  body.querySelectorAll('.change-role-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.id;
      const current = btn.dataset.role;
      const role = prompt('New role (admin / operator / viewer):', current);
      if (!role || role === current) return;
      const res = await authFetch(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const result = res && await res.json();
      if (!result?.success) return alert('Update failed: ' + (result?.error || 'unknown error'));
      await loadProject(projectId, getUser());
    });
  });

  body.querySelectorAll('.remove-member-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.id;
      if (!confirm('Remove this member from the project?')) return;
      const res = await authFetch(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const result = res && await res.json();
      if (!result?.success) return alert('Remove failed: ' + (result?.error || 'unknown error'));
      await loadProject(projectId, getUser());
    });
  });
}

function escapeHtml(unsafe) {
  return (unsafe ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
