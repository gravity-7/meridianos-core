/**
 * tests/integration/test-team-collaboration-http.mjs — HTTP-level coverage for 008 Team
 * Collaboration (US3): invitations and project member management. Every handler here previously
 * called APIs that didn't match the real classes (InvitationManager.create() takes positional
 * args, not an object; ActivityLogger needs a path, not a db instance; etc.), read `req.pathname`
 * (which doesn't exist on a raw http.IncomingMessage), and had zero project-role authorization
 * anywhere — see the handler-by-handler comments in dashboard/server.mjs for what was wrong with
 * each one. Existing tests (test-invitation-lifecycle.mjs) only ever call auth/user-store.mjs's
 * classes directly, never over HTTP, so none of this was ever caught.
 *
 * Same singleton-isolation caveat as test-auth-http.mjs: getUserStore()/getActivityLogger() are
 * hardcoded to <repo-root>/.ai/control-plane.db, not derived from `config`. See
 * tests/helpers/wipe-control-plane.mjs for the close-then-delete teardown this uses. Unique-per-run
 * emails/project ids are kept as a second line of defense in case a leftover row ever survives.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDashboardServer } from '../../dashboard/server.mjs';
import { resolvePaths } from '../../config.mjs';
import { FIXTURE_DOMAIN } from '../_fixture-domain.mjs';
import { getUserStore } from '../../auth/user-store.mjs';
import { wipeControlPlaneDbFiles, closeControlPlaneSingletonsAndWipeDb } from '../helpers/wipe-control-plane.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const RUN_ID = Date.now();
const PROJECT_A = `proj-a-${RUN_ID}`;
const PROJECT_B = `proj-b-${RUN_ID}`;

let server, port, aiosToken;
let adminUser, adminToken;
let viewerUser, viewerToken;

function httpRequest({ path, method, token, aios, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(aios ? { 'x-aios-token': aios } : {}),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login(email, password) {
  const res = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email, password } });
  return res.body.token;
}

before(async () => {
  await wipeControlPlaneDbFiles();
  const store = getUserStore();
  adminUser = await store.createUser({ email: `team-http-admin-${RUN_ID}@example.com`, password: 'pw-admin-123', full_name: 'Admin', role: 'operator' });
  viewerUser = await store.createUser({ email: `team-http-viewer-${RUN_ID}@example.com`, password: 'pw-viewer-123', full_name: 'Viewer', role: 'viewer' });

  // adminUser is project-admin of PROJECT_A only (site role is 'operator' — NOT a site-admin, so
  // this genuinely exercises the project-scoped RBAC path, not the site-admin bypass).
  const now = Math.floor(Date.now() / 1000);
  store.db.prepare(`INSERT INTO project_users (id, project_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?)`)
    .run(`pu-${RUN_ID}-1`, PROJECT_A, adminUser.id, now, now);

  server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const raw = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
      let out = ''; res.on('data', (c) => (out += c)); res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.end();
  });
  aiosToken = /AIOS_TOKEN = "([^"]+)"/.exec(raw)[1];

  adminToken = await login(adminUser.email, 'pw-admin-123');
  viewerToken = await login(viewerUser.email, 'pw-viewer-123');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeControlPlaneSingletonsAndWipeDb();
});

test('POST /api/projects/:id/members rejects a caller with no role on that project', async () => {
  const res = await httpRequest({
    path: `/api/projects/${PROJECT_B}/members`, method: 'POST', token: adminToken, aios: aiosToken,
    body: { email: 'someone@example.com', role: 'viewer' },
  });
  assert.equal(res.status, 403); // adminUser is admin of PROJECT_A, not PROJECT_B
});

test('POST /api/projects/:id/members adds an existing user directly', async () => {
  const res = await httpRequest({
    path: `/api/projects/${PROJECT_A}/members`, method: 'POST', token: adminToken, aios: aiosToken,
    body: { email: viewerUser.email, role: 'operator' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.id, viewerUser.id);
});

test('GET /api/projects/:id/members lists members, viewable by a viewer-role member', async () => {
  const res = await httpRequest({ path: `/api/projects/${PROJECT_A}/members`, method: 'GET', token: viewerToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.members.some((m) => m.id === adminUser.id && m.role === 'admin'));
  assert.ok(res.body.members.some((m) => m.id === viewerUser.id && m.role === 'operator'));
  // team-panel.mjs (dashboard UI) displays full_name/email — pin the shape so a future rename
  // of these columns doesn't silently leave the UI showing "Unknown" for every member.
  const admin = res.body.members.find((m) => m.id === adminUser.id);
  assert.equal(admin.full_name, adminUser.full_name);
  assert.equal(admin.email, adminUser.email);
});

test('PUT /api/projects/:id/members/:user_id requires admin role — operator cannot change roles', async () => {
  // Promote viewer to operator first via a fresh grant so we have a non-admin member to test with
  const res = await httpRequest({
    path: `/api/projects/${PROJECT_A}/members/${viewerUser.id}`, method: 'PUT', token: viewerToken, aios: aiosToken,
    body: { role: 'admin' },
  });
  assert.equal(res.status, 403); // viewerUser is 'operator' on PROJECT_A, not 'admin'
});

test('PUT /api/projects/:id/members/:user_id updates role as admin', async () => {
  const res = await httpRequest({
    path: `/api/projects/${PROJECT_A}/members/${viewerUser.id}`, method: 'PUT', token: adminToken, aios: aiosToken,
    body: { role: 'admin' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'admin');
});

test('POST /api/auth/invitations creates an invitation for a project the caller admins', async () => {
  const res = await httpRequest({
    path: '/api/auth/invitations', method: 'POST', token: adminToken, aios: aiosToken,
    body: { email: `invitee-${RUN_ID}@example.com`, project_id: PROJECT_A, role: 'viewer' },
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.invitation.token);
  assert.equal(res.body.invitation.project_id, PROJECT_A);
});

test('GET /api/auth/invitations?project_id=X lists pending invitations', async () => {
  const res = await httpRequest({ path: `/api/auth/invitations?project_id=${PROJECT_A}`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.invitations.length >= 1);
});

test('POST /api/auth/invitations/:token/accept requires NO auth token and creates a new user', async () => {
  const email = `accept-flow-${RUN_ID}@example.com`;
  const create = await httpRequest({
    path: '/api/auth/invitations', method: 'POST', token: adminToken, aios: aiosToken,
    body: { email, project_id: PROJECT_A, role: 'viewer' },
  });
  const token = create.body.invitation.token;

  // Deliberately no `token:` (bearer) here — accepting an invite must not require being logged in.
  const accept = await httpRequest({
    path: `/api/auth/invitations/${token}/accept`, method: 'POST', aios: aiosToken,
    body: { password: 'invitee-password-123' },
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.success, true);
  assert.equal(accept.body.user.email, email);

  // The new user can now log in with the password they set during acceptance.
  const newLogin = await httpRequest({ path: '/api/auth/login', method: 'POST', aios: aiosToken, body: { email, password: 'invitee-password-123' } });
  assert.equal(newLogin.status, 200);
});

test('POST /api/auth/invitations/:token/reject (revoke) requires project admin role', async () => {
  const create = await httpRequest({
    path: '/api/auth/invitations', method: 'POST', token: adminToken, aios: aiosToken,
    body: { email: `revoke-target-${RUN_ID}@example.com`, project_id: PROJECT_A, role: 'viewer' },
  });
  const token = create.body.invitation.token;

  const revoked = await httpRequest({ path: `/api/auth/invitations/${token}/reject`, method: 'POST', token: adminToken, aios: aiosToken });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.success, true);

  // A revoked invitation can no longer be accepted.
  const acceptAfterRevoke = await httpRequest({
    path: `/api/auth/invitations/${token}/accept`, method: 'POST', aios: aiosToken, body: { password: 'x' },
  });
  assert.equal(acceptAfterRevoke.status, 400);
});

test('DELETE /api/projects/:id/members/:user_id removes a member, admin only', async () => {
  // viewerUser was promoted to 'admin' on PROJECT_A by an earlier test — deliberately using
  // adminUser (the original project admin, unaffected by that promotion) to remove them here, so
  // this only exercises one DELETE against the still-present row instead of racing two.
  const res = await httpRequest({ path: `/api/projects/${PROJECT_A}/members/${viewerUser.id}`, method: 'DELETE', token: adminToken, aios: aiosToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  const listAfter = await httpRequest({ path: `/api/projects/${PROJECT_A}/members`, method: 'GET', token: adminToken });
  assert.ok(!listAfter.body.members.some((m) => m.id === viewerUser.id));
});

test('DELETE /api/projects/:id/members/:user_id returns MEMBER_NOT_FOUND for someone not on the project', async () => {
  const res = await httpRequest({ path: `/api/projects/${PROJECT_A}/members/not-a-real-user-id`, method: 'DELETE', token: adminToken, aios: aiosToken });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'MEMBER_NOT_FOUND');
});

// ─── Activity feed (008 — Team Collaboration, FR-012) ───────────────────────

test('GET /api/projects/:id/activity requires project membership and reflects logged actions', async () => {
  const forbidden = await httpRequest({ path: `/api/projects/${PROJECT_A}/activity`, method: 'GET' });
  assert.equal(forbidden.status, 401); // no token at all

  const res = await httpRequest({ path: `/api/projects/${PROJECT_A}/activity`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.project_id, PROJECT_A);
  // earlier tests in this file (member add/remove, invitations) all logged activity for PROJECT_A
  assert.ok(res.body.feed.length > 0);
  assert.ok(res.body.feed.every((e) => e.project_id === PROJECT_A));
  // team-panel.mjs (dashboard UI) renders user_name/action_display/timestamp — pin the shape
  // (ActivityLogger.getProjectFeed()'s enrichment) so a future refactor doesn't silently break it.
  const entry = res.body.feed[0];
  assert.ok('user_name' in entry);
  assert.ok('action_display' in entry);
  assert.equal(typeof entry.timestamp, 'number');
});

test('GET /api/projects/:id/activity rejects a caller with no role on that project', async () => {
  const res = await httpRequest({ path: `/api/projects/${PROJECT_B}/activity`, method: 'GET', token: adminToken });
  assert.equal(res.status, 403); // adminUser has no role on PROJECT_B
});

test('GET /api/activity/feed with no project_id is site-admin only', async () => {
  const forbidden = await httpRequest({ path: '/api/activity/feed', method: 'GET', token: adminToken });
  assert.equal(forbidden.status, 403); // adminUser's SITE role is 'operator', not 'admin' — see before()
});

test('GET /api/activity/feed?project_id=X scopes to that project like the /projects/:id/activity route', async () => {
  const res = await httpRequest({ path: `/api/activity/feed?project_id=${PROJECT_A}`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.feed.every((e) => e.project_id === PROJECT_A));
});

test('GET /api/activity/stats?project_id=X returns a total scoped to that project', async () => {
  const res = await httpRequest({ path: `/api/activity/stats?project_id=${PROJECT_A}`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.stats.total >= 1);
});

// ─── Task comments (008 — Team Collaboration, FR-013) ───────────────────────

const TASK_ID = `task-${RUN_ID}`;

test('POST /api/projects/:id/tasks/:task_id/comments requires project membership', async () => {
  const res = await httpRequest({
    path: `/api/projects/${PROJECT_B}/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken,
    body: { content: 'hello' },
  });
  assert.equal(res.status, 403); // adminUser has no role on PROJECT_B
});

test('POST /api/projects/:id/tasks/:task_id/comments creates a comment as a project member', async () => {
  const res = await httpRequest({
    path: `/api/projects/${PROJECT_A}/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken,
    body: { content: 'Looks good to me.' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.comment.content, 'Looks good to me.');
  assert.equal(res.body.comment.user_id, adminUser.id);
  // enrichCommentWithUserName() (dashboard/server.mjs) — TaskComment rows only carry user_id;
  // the dashboard UI (task-comments.mjs) needs a display name, so the handler joins it in.
  assert.equal(res.body.comment.user_name, adminUser.full_name);
});

test('GET /api/projects/:id/tasks/:task_id/comments lists comments, project-scoped', async () => {
  const res = await httpRequest({ path: `/api/projects/${PROJECT_A}/tasks/${TASK_ID}/comments`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  const comment = res.body.comments.find((c) => c.content === 'Looks good to me.');
  assert.ok(comment);
  assert.equal(comment.user_name, adminUser.full_name);
});

test('POST /api/tasks/:id/comments (non-project-scoped route) rejects empty content', async () => {
  const res = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken, body: { content: '' } });
  assert.equal(res.status, 400);
});

test('POST /api/tasks/:id/comments (non-project-scoped route) creates a comment for any logged-in user', async () => {
  const res = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken, body: { content: 'Non-project-scoped comment.' } });
  assert.equal(res.status, 201);
});

test('PUT /api/tasks/:id/comments/:commentId lets the author edit their own comment', async () => {
  const created = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken, body: { content: 'original' } });
  const commentId = created.body.comment.id;

  const updated = await httpRequest({
    path: `/api/tasks/${TASK_ID}/comments/${commentId}`, method: 'PUT', token: adminToken, aios: aiosToken, body: { content: 'edited' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.comment.content, 'edited');
});

test('PUT /api/tasks/:id/comments/:commentId returns 404 when editing someone else\'s comment', async () => {
  const created = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken, body: { content: 'admin owns this' } });
  const commentId = created.body.comment.id;

  const res = await httpRequest({
    path: `/api/tasks/${TASK_ID}/comments/${commentId}`, method: 'PUT', token: viewerToken, aios: aiosToken, body: { content: 'hijacked' },
  });
  assert.equal(res.status, 404); // viewerUser doesn't own this comment
});

test('DELETE /api/tasks/:id/comments/:commentId lets the author delete their own comment', async () => {
  const created = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments`, method: 'POST', token: adminToken, aios: aiosToken, body: { content: 'to be deleted' } });
  const commentId = created.body.comment.id;

  const res = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments/${commentId}`, method: 'DELETE', token: adminToken, aios: aiosToken });
  assert.equal(res.status, 200);

  const list = await httpRequest({ path: `/api/tasks/${TASK_ID}/comments`, method: 'GET', token: adminToken });
  assert.ok(!list.body.comments.some((c) => c.id === commentId));
});

// ─── PR reviewer assignment (008 — Team Collaboration, FR-014) ──────────────

test('POST /api/reviews/assign requires project admin/operator role', async () => {
  const res = await httpRequest({
    path: '/api/reviews/assign', method: 'POST', token: viewerToken, aios: aiosToken,
    body: { project_id: PROJECT_A, pr_url: 'https://github.com/org/repo/pull/1' },
  });
  // viewerUser has no role on PROJECT_A in this file's fixtures (only adminUser does)
  assert.equal(res.status, 403);
});

test('POST /api/reviews/assign fails clearly when no project member has a github_username', async () => {
  const res = await httpRequest({
    path: '/api/reviews/assign', method: 'POST', token: adminToken, aios: aiosToken,
    body: { project_id: PROJECT_A, pr_url: 'https://github.com/org/repo/pull/1' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no eligible reviewers/);
});

test('POST /api/reviews/assign succeeds once a member has a github_username set', async () => {
  await httpRequest({ path: '/api/auth/me', method: 'PUT', token: adminToken, aios: aiosToken, body: { github_username: `admin-gh-${RUN_ID}` } });

  const res = await httpRequest({
    path: '/api/reviews/assign', method: 'POST', token: adminToken, aios: aiosToken,
    body: { project_id: PROJECT_A, pr_url: 'https://github.com/org/repo/pull/2', reviewer_count: 1 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.reviewers[0].username, `admin-gh-${RUN_ID}`);
});

test('GET /api/reviews/assignments?project_id=X lists recent assignments', async () => {
  const res = await httpRequest({ path: `/api/reviews/assignments?project_id=${PROJECT_A}`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.assignments.length >= 1);
});

test('GET /api/reviews/stats?project_id=X returns per-reviewer counts', async () => {
  const res = await httpRequest({ path: `/api/reviews/stats?project_id=${PROJECT_A}`, method: 'GET', token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.stats.total_assignment_events >= 1);
});
