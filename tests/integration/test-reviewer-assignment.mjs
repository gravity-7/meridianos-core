/**
 * tests/integration/test-reviewer-assignment.mjs — ReviewerAssigner (008 — Team Collaboration,
 * US3/FR-014). This class did not exist anywhere in the codebase before this feature — both
 * runner.mjs (T122) and dashboard/server.mjs's /api/reviews/* routes referenced
 * `getReviewerAssigner()` from control-plane.mjs without it ever being exported.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReviewerAssigner } from '../../control-plane.mjs';

let dir;
let assigner;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewer-assigner-'));
  assigner = new ReviewerAssigner(join(dir, 'control-plane.db'));

  // Seed users + project_users directly (this class shares the same control-plane.db as
  // auth/user-store.mjs's UserStore, but constructing a full UserStore here would be redundant —
  // ReviewerAssigner's own ensureSchema() already creates a compatible `users` table).
  const now = Math.floor(Date.now() / 1000);
  const insertUser = assigner.db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, github_username, created_at, updated_at)
    VALUES (?, ?, 'x', ?, 'operator', ?, ?, ?)
  `);
  insertUser.run('u1', 'alice@example.com', 'Alice', 'alice-gh', now, now);
  insertUser.run('u2', 'bob@example.com', 'Bob', 'bob-gh', now, now);
  insertUser.run('u3', 'carol@example.com', 'Carol', null, now, now); // no github_username — excluded

  assigner.db.exec(`CREATE TABLE IF NOT EXISTS project_users (id TEXT, project_id TEXT, user_id TEXT, role TEXT, created_at INTEGER, updated_at INTEGER)`);
  const insertMember = assigner.db.prepare(`INSERT INTO project_users (id, project_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'operator', ?, ?)`);
  insertMember.run('pu1', 'proj1', 'u1', now, now);
  insertMember.run('pu2', 'proj1', 'u2', now, now);
  insertMember.run('pu3', 'proj1', 'u3', now, now);
});

after(() => {
  assigner.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  assigner.db.exec('DELETE FROM reviewer_assignments');
});

test('assign() excludes members with no github_username set', async () => {
  const result = await assigner.assign('proj1', 'https://github.com/org/repo/pull/1', 2);
  assert.equal(result.success, true);
  assert.equal(result.reviewer_count, 2);
  assert.ok(result.reviewers.every((r) => r.username !== undefined && r.username !== null));
  assert.ok(!result.reviewers.some((r) => r.user_id === 'u3'));
});

test('assign() returns fewer reviewers than requested rather than erroring when the pool is smaller', async () => {
  const result = await assigner.assign('proj1', 'https://github.com/org/repo/pull/2', 10);
  assert.equal(result.success, true);
  assert.equal(result.reviewer_count, 2); // only alice + bob are eligible
});

test('assign() fails clearly when no project member has a github_username', async () => {
  const result = await assigner.assign('empty-project', 'https://github.com/org/repo/pull/3', 1);
  assert.equal(result.success, false);
  assert.match(result.error, /no eligible reviewers/);
});

test('assign() requires projectId and prUrl', async () => {
  assert.equal((await assigner.assign(null, 'https://x', 1)).success, false);
  assert.equal((await assigner.assign('proj1', null, 1)).success, false);
});

test('round-robin fairness: assigning 1 reviewer repeatedly alternates between eligible candidates', async () => {
  const first = await assigner.assign('proj1', 'https://github.com/org/repo/pull/10', 1);
  const second = await assigner.assign('proj1', 'https://github.com/org/repo/pull/11', 1);
  // whoever was picked first now has the most recent assignment, so the second call must pick the OTHER one
  assert.notEqual(first.reviewers[0].user_id, second.reviewers[0].user_id);
});

test('getRecentAssignments groups multi-reviewer events into one entry each, newest first', async () => {
  await assigner.assign('proj1', 'https://github.com/org/repo/pull/20', 2);
  await new Promise((r) => setTimeout(r, 1100)); // ensure a distinct created_at (second-resolution)
  await assigner.assign('proj1', 'https://github.com/org/repo/pull/21', 1);

  const recent = assigner.getRecentAssignments('proj1', 10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].pr_url, 'https://github.com/org/repo/pull/21'); // newest first
  assert.equal(recent[0].reviewers.length, 1);
  assert.equal(recent[1].reviewers.length, 2);
});

test('getAssignmentStats counts per-reviewer assignments and total distinct events', async () => {
  await assigner.assign('proj1', 'https://github.com/org/repo/pull/30', 2);
  const stats = assigner.getAssignmentStats('proj1');
  assert.equal(stats.total_assignment_events, 1);
  assert.equal(stats.by_reviewer.length, 2);
  assert.ok(stats.by_reviewer.every((r) => r.assignment_count === 1));
});
