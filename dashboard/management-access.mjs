import { InvitationManager } from '../auth/user-store.mjs';

const PERMISSIONS = Object.freeze({ admin: ['providers:write', 'keys:write', 'webhooks:write', 'access:write', 'settings:write', 'audit:read'], operator: ['providers:read', 'webhooks:write', 'access:read', 'billing:read', 'audit:read'], viewer: [] });
const VALID_ROLES = new Set(Object.keys(PERMISSIONS));

function projectId(scope) { return scope.projectId ?? scope.tenantId; }
function invitationRow(scope, row) {
  const expiresAt = new Date(row.expires_at * 1000).toISOString();
  const status = row.status === 'pending' && row.expires_at <= Math.floor(Date.now() / 1000) ? 'expired' : row.status;
  return { id: row.id, tenantId: scope.tenantId, projectId: scope.projectId, email: row.email, role: row.role, status, expiresAt, createdAt: new Date(row.created_at * 1000).toISOString(), updatedAt: new Date(row.updated_at * 1000).toISOString() };
}
function manager(userStore) { return new InvitationManager(userStore); }

export function explainPermissions({ tenantId, projectId, role = 'viewer', inheritedRole = null }) { return { tenantId, projectId, explicitRole: role, inheritedRole, allowed: PERMISSIONS[role] ?? [], denied: Object.values(PERMISSIONS).flat().filter((x) => !(PERMISSIONS[role] ?? []).includes(x)) }; }

/** Create only through the authority that backs public invitation acceptance. Raw material is
 * intentionally discarded here: delivery is a separate one-time channel, never the dashboard. */
export function invite(userStore, scope, { email, role = 'viewer' }) {
  if (!VALID_ROLES.has(role)) return null;
  const targetProject = projectId(scope); const normalized = String(email ?? '').trim().toLowerCase(); const now = Math.floor(Date.now() / 1000);
  userStore.db.prepare("UPDATE invitations SET status = 'superseded', updated_at = ? WHERE email = ? AND project_id = ? AND status = 'pending'").run(now, normalized, targetProject);
  try { const created = manager(userStore).create(normalized, targetProject, role); return invitationRow(scope, userStore.db.prepare('SELECT * FROM invitations WHERE id = ?').get(created.id)); } catch { return null; }
}

export function listInvitations(userStore, scope) { return manager(userStore).listProjectInvitations(projectId(scope)).map((row) => invitationRow(scope, row)); }

/** Cancellation and resend remain scoped admin operations. Acceptance is delegated to the
 * unauthenticated, token-bound public route so an admin UI can never accept on somebody else's
 * behalf or receive the raw invite token. */
export function updateInvitation(userStore, scope, id, action) {
  const targetProject = projectId(scope); const row = userStore.db.prepare('SELECT * FROM invitations WHERE id = ? AND project_id = ?').get(id, targetProject); if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (action === 'cancel') { const changed = userStore.db.prepare("UPDATE invitations SET status = 'cancelled', updated_at = ? WHERE id = ? AND project_id = ? AND status = 'pending'").run(now, id, targetProject); return changed.changes ? invitationRow(scope, userStore.db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)) : null; }
  if (action === 'resend' && row.status === 'pending') return invite(userStore, scope, { email: row.email, role: row.role });
  return null;
}

export function listMemberships(userStore, scope) {
  const rows = userStore.db.prepare('SELECT users.email, project_users.role, project_users.created_at, project_users.updated_at FROM project_users JOIN users ON users.id = project_users.user_id WHERE project_users.project_id = ? ORDER BY users.email').all(projectId(scope));
  return rows.map((row) => ({ email: row.email, role: row.role, tenantId: scope.tenantId, projectId: scope.projectId, createdAt: new Date(row.created_at * 1000).toISOString(), updatedAt: new Date(row.updated_at * 1000).toISOString(), effectivePermissions: explainPermissions({ ...scope, role: row.role }) }));
}

export function changeMembership(userStore, scope, email, role) {
  if (!VALID_ROLES.has(role)) return null;
  const targetProject = projectId(scope); const normalized = String(email ?? '').toLowerCase(); const changed = userStore.db.prepare('UPDATE project_users SET role = ?, updated_at = ? WHERE project_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)').run(role, Math.floor(Date.now() / 1000), targetProject, normalized);
  if (!changed.changes) return null; return listMemberships(userStore, scope).find((row) => row.email === normalized) ?? null;
}

// Retained exports keep state-loader adapters source-compatible; authority is no longer a map.
export function accessSnapshot() { return {}; }
export function restoreAccessSnapshot() {}
