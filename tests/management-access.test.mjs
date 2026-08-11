import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { UserStore } from '../auth/user-store.mjs'; import { invite, listInvitations, updateInvitation, listMemberships, changeMembership, explainPermissions } from '../dashboard/management-access.mjs'; import { MANAGEMENT_SCOPE } from './management-fixtures.mjs';

test('management invitations are durable, supersede safely, and membership is sourced from the user store', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'meridianos-management-access-')); const store = new UserStore(path.join(folder, 'users.db'));
  try {
    const original = invite(store, MANAGEMENT_SCOPE, { email: 'member@example.test', role: 'operator' }); const replacement = updateInvitation(store, MANAGEMENT_SCOPE, original.id, 'resend');
    assert.equal(listInvitations(store, MANAGEMENT_SCOPE).find((x) => x.id === original.id).status, 'superseded'); assert.equal(replacement.email, 'member@example.test'); assert.equal(JSON.stringify(replacement).includes('token'), false);
    const user = await store.createUser({ email: 'member@example.test', password: 'safe-password', full_name: 'Member' }); store.db.prepare('INSERT INTO project_users (id, project_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('member-project-link', MANAGEMENT_SCOPE.projectId ?? MANAGEMENT_SCOPE.tenantId, user.id, 'operator', 1, 1);
    assert.equal(changeMembership(store, MANAGEMENT_SCOPE, 'member@example.test', 'viewer').effectivePermissions.allowed.length, 0); assert.equal(listMemberships(store, MANAGEMENT_SCOPE)[0].email, 'member@example.test'); assert.equal(explainPermissions({ ...MANAGEMENT_SCOPE, role: 'viewer' }).allowed.length, 0);
  } finally { store.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
