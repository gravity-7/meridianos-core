/**
 * The state API — the ONLY writer of task state. Every mutation is a single SQLite
 * transaction guarded by BEGIN IMMEDIATE (which grabs the write lock up front), so two
 * agents racing for the same task serialize: exactly one wins, the other sees it leased
 * and picks another task. No git push is involved in winning work — the race is gone.
 */
import { assertTransition, CLAIMABLE_STATUSES } from './machine.mjs';

const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min lease; heartbeat extends it

const nowIso = () => new Date().toISOString();
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const j = (v) => JSON.stringify(v ?? []);
const arr = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

/** Run `fn` inside an IMMEDIATE (write-lock) transaction; rollback + rethrow on error. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

function audit(db, { ts, taskId, from, to, actor, op, note }) {
  db.prepare(
    `INSERT INTO history(ts, task_id, from_state, to_state, actor, op, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(ts, taskId, from ?? null, to ?? null, actor ?? '', op, note ?? '');
}

export function getTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) ?? null;
}

export function listTasks(db) {
  return db.prepare('SELECT * FROM tasks ORDER BY priority ASC, id ASC').all();
}

export function listSprints(db) {
  return db.prepare('SELECT * FROM sprints ORDER BY start_date ASC').all();
}

export function listPIs(db) {
  return db.prepare('SELECT * FROM program_increments').all();
}

/**
 * Upsert a task's DECLARATIVE fields (never its lease). Idempotent — this is how board.json
 * seeds the DB on a fresh checkout, and how the planner adds proposals later.
 */
export function upsertTask(db, t, { now = nowIso() } = {}) {
  const existing = getTask(db, t.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO tasks(id,type,parent_id,sprint_id,title,acceptance_criteria,lane,status,owner,priority,complexity,risk_tags,task_type,
                         approved_at,snoozed_until,skipped_at,skip_reason,resources,
                         depends_on,spec,contracts,pr,note,created_at,updated_at,source)
       VALUES (@id,@type,@parent_id,@sprint_id,@title,@acceptance_criteria,@lane,@status,@owner,@priority,@complexity,@risk_tags,@task_type,
               @approved_at,@snoozed_until,@skipped_at,@skip_reason,@resources,
               @depends_on,@spec,@contracts,@pr,@note,@created_at,@updated_at,@source)`,
    ).run({
      id: t.id,
      type: t.type ?? 'feature',
      parent_id: t.parent_id ?? null,
      sprint_id: t.sprint_id ?? null,
      title: t.title,
      acceptance_criteria: t.acceptance_criteria ?? null,
      lane: t.lane ?? 'standard',
      status: t.status ?? 'proposed',
      owner: t.owner ?? 'both',
      priority: t.priority ?? 100,
      complexity: t.complexity ?? 3,
      risk_tags: j(t.risk_tags),
      task_type: t.task_type ?? null,
      approved_at: t.approved_at ?? null,
      snoozed_until: t.snoozed_until ?? null,
      skipped_at: t.skipped_at ?? null,
      skip_reason: t.skip_reason ?? null,
      resources: j(t.resources),
      depends_on: j(t.depends_on),
      spec: t.spec ?? null,
      contracts: j(t.contracts),
      pr: t.pr ?? null,
      note: t.note ?? null,
      created_at: t.created_at ?? now,
      updated_at: t.updated_at ?? now,
      source: t.source ?? null,
    });
    audit(db, { ts: now, taskId: t.id, from: null, to: t.status ?? 'proposed', actor: 'seed', op: 'seed' });
  } else {
    db.prepare(
      `UPDATE tasks SET type=@type, parent_id=@parent_id, sprint_id=@sprint_id, title=@title, acceptance_criteria=@acceptance_criteria,
              lane=@lane, status=@status, owner=@owner, priority=@priority,
              complexity=@complexity, risk_tags=@risk_tags, task_type=@task_type,
              approved_at=@approved_at, snoozed_until=@snoozed_until, skipped_at=@skipped_at, skip_reason=@skip_reason,
              resources=@resources, depends_on=@depends_on,
              spec=@spec, contracts=@contracts, pr=@pr, note=@note, updated_at=@updated_at, source=@source
       WHERE id=@id`,
    ).run({
      id: t.id,
      type: t.type ?? existing.type,
      parent_id: t.parent_id ?? existing.parent_id,
      sprint_id: t.sprint_id ?? existing.sprint_id,
      title: t.title,
      acceptance_criteria: t.acceptance_criteria ?? existing.acceptance_criteria,
      lane: t.lane ?? existing.lane,
      status: t.status ?? existing.status,
      owner: t.owner ?? existing.owner,
      priority: t.priority ?? existing.priority,
      complexity: t.complexity ?? existing.complexity,
      risk_tags: j(t.risk_tags),
      task_type: t.task_type ?? existing.task_type ?? null,
      approved_at: t.approved_at ?? existing.approved_at ?? null,
      snoozed_until: t.snoozed_until ?? existing.snoozed_until ?? null,
      skipped_at: t.skipped_at ?? existing.skipped_at ?? null,
      skip_reason: t.skip_reason ?? existing.skip_reason ?? null,
      resources: j(t.resources),
      depends_on: j(t.depends_on),
      spec: t.spec ?? existing.spec,
      contracts: j(t.contracts),
      pr: t.pr ?? existing.pr,
      note: t.note ?? existing.note,
      updated_at: t.updated_at ?? now,
      source: t.source ?? existing.source ?? null,
    });
  }
  return getTask(db, t.id);
}

/** Seed many tasks from a board.json object `{ tasks: [...], pis: [...], sprints: [...] }`. Idempotent. */
export function seedTasks(db, board, { now = nowIso() } = {}) {
  return tx(db, () => {
    (board?.pis ?? []).forEach(pi => upsertPI(db, pi));
    (board?.sprints ?? []).forEach(s => upsertSprint(db, s));
    return (board?.tasks ?? []).map((t) => upsertTask(db, t, { now }));
  });
}

export function upsertPI(db, pi) {
  const existing = db.prepare('SELECT * FROM program_increments WHERE id = ?').get(pi.id);
  if (!existing) {
    db.prepare('INSERT INTO program_increments(id, name, status) VALUES (?, ?, ?)').run(pi.id, pi.name, pi.status ?? 'planning');
  } else {
    db.prepare('UPDATE program_increments SET name = ?, status = ? WHERE id = ?').run(pi.name, pi.status ?? existing.status, pi.id);
  }
}

export function upsertSprint(db, s) {
  const existing = db.prepare('SELECT * FROM sprints WHERE id = ?').get(s.id);
  if (!existing) {
    db.prepare('INSERT INTO sprints(id, pi_id, name, start_date, end_date, goal, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      s.id, s.pi_id ?? null, s.name, s.start_date ?? null, s.end_date ?? null, s.goal ?? null, s.status ?? 'planning'
    );
  } else {
    db.prepare('UPDATE sprints SET pi_id=?, name=?, start_date=?, end_date=?, goal=?, status=? WHERE id=?').run(
      s.pi_id ?? existing.pi_id, s.name, s.start_date ?? existing.start_date, s.end_date ?? existing.end_date, s.goal ?? existing.goal, s.status ?? existing.status, s.id
    );
  }
}

/**
 * Atomically claim a task: acquire its lease AND all of its declared resource locks in one
 * transaction, or nothing. Returns {won:true, task} or {won:false, reason}.
 */
export function claimTask(db, { taskId, agent, session, ttlMs = DEFAULT_TTL_MS, now = nowIso(), claimable = CLAIMABLE_STATUSES }) {
  if (!taskId || !agent || !session) throw new Error('claimTask requires taskId, agent, session');
  const expires = plus(now, ttlMs);
  return tx(db, () => {
    const t = getTask(db, taskId);
    if (!t) return { won: false, reason: 'no-such-task' };

    const leaseLive = t.lease_expires && t.lease_expires > now && t.lease_session !== session;
    if (leaseLive) return { won: false, reason: 'leased', by: t.lease_owner };

    const allowed = claimable ?? [];
    if (!allowed.includes(t.status)) return { won: false, reason: `status '${t.status}' not claimable by ${agent}` };

    const resources = arr(t.resources);
    for (const r of resources) {
      const lock = db.prepare('SELECT task_id FROM resource_locks WHERE resource = ?').get(r);
      if (lock && lock.task_id !== taskId) return { won: false, reason: `resource-locked: ${r} (by ${lock.task_id})` };
    }

    db.prepare(
      `UPDATE tasks SET lease_owner=?, lease_session=?, lease_acquired=?, lease_expires=?, updated_at=?
       WHERE id=?`,
    ).run(agent, session, now, expires, now, taskId);

    for (const r of resources) {
      db.prepare(
        `INSERT INTO resource_locks(resource, task_id, owner, acquired) VALUES (?, ?, ?, ?)`,
      ).run(r, taskId, agent, now);
    }

    audit(db, { ts: now, taskId, from: t.status, to: t.status, actor: `${agent}:${session}`, op: 'claim', note: `ttl=${ttlMs}ms` });
    return { won: true, task: getTask(db, taskId) };
  });
}

/** Extend the lease. Succeeds only if the caller currently holds a live lease. */
export function heartbeat(db, { taskId, session, ttlMs = DEFAULT_TTL_MS, now = nowIso() }) {
  const expires = plus(now, ttlMs);
  const r = db.prepare(
    `UPDATE tasks SET lease_expires=?, updated_at=?
     WHERE id=? AND lease_session=? AND lease_expires > ?`,
  ).run(expires, now, taskId, session, now);
  if (r.changes === 1) audit(db, { ts: now, taskId, actor: session, op: 'heartbeat', note: `+${ttlMs}ms` });
  return { ok: r.changes === 1 };
}

/** Voluntarily release a held lease (frees its resource locks). Status is unchanged. */
export function releaseLease(db, { taskId, session, now = nowIso() }) {
  return tx(db, () => {
    const t = getTask(db, taskId);
    if (!t || t.lease_session !== session) return { ok: false, reason: 'not-lease-holder' };
    freeLease(db, t, now);
    audit(db, { ts: now, taskId, from: t.status, to: t.status, actor: session, op: 'release' });
    return { ok: true };
  });
}

/**
 * Force-release a lease by agent name when the session UUID may not match (e.g. agent exited so
 * fast the session wasn't committed, or the runner holds a different session ID than the DB).
 * Validates that lease_owner === agent before clearing. Only for runner/watchdog use.
 */
export function forceReleaseLease(db, { taskId, agent, now = nowIso() }) {
  return tx(db, () => {
    const t = getTask(db, taskId);
    if (!t) return { ok: false, reason: 'no-such-task' };
    if (!t.lease_owner) return { ok: false, reason: 'no-lease' };
    if (t.lease_owner !== agent) return { ok: false, reason: `owned-by-${t.lease_owner}` };
    freeLease(db, t, now);
    audit(db, { ts: now, taskId, from: t.status, to: t.status, actor: `${agent}:force-release`, op: 'release' });
    return { ok: true };
  });
}

function freeLease(db, t, now) {
  db.prepare(
    `UPDATE tasks SET lease_owner=NULL, lease_session=NULL, lease_acquired=NULL, lease_expires=NULL, updated_at=?
     WHERE id=?`,
  ).run(now, t.id);
  db.prepare('DELETE FROM resource_locks WHERE task_id=?').run(t.id);
}

/**
 * Free EVERY live lease. Called once at daemon boot: any agent a previous daemon launched died
 * with it, so its lease is an orphan the TTL reaper would otherwise sit on for up to lease_ttl_min
 * (postmortem RCA-4 "daemon killed mid-run" gap — the reaper only frees EXPIRED leases, but a lease
 * acquired minutes before a crash isn't expired yet). Mirrors the boot-time worktree prune. Returns
 * the freed task ids. Does NOT bump reap_count — this is recovery, not a stall signal.
 */
export function releaseAllLeases(db, { now = nowIso() } = {}) {
  const live = db.prepare('SELECT id FROM tasks WHERE lease_owner IS NOT NULL OR lease_expires IS NOT NULL').all();
  const freed = [];
  for (const { id } of live) {
    tx(db, () => {
      const t = getTask(db, id);
      if (!t || (t.lease_owner == null && t.lease_expires == null)) return;
      freeLease(db, t, now);
      audit(db, { ts: now, taskId: id, from: t.status, to: t.status, actor: 'boot', op: 'release', note: 'boot recovery: orphaned lease freed' });
      freed.push(id);
    });
  }
  return { freed };
}

/** Cap the append-only history table so it never grows unbounded (postmortem A6). Keeps the most
 *  recent `keep` rows; returns the number deleted. Mirrors event-log.pruneEvents. */
export function pruneHistory(db, { keep = 5000 } = {}) {
  const max = db.prepare('SELECT MAX(seq) AS m FROM history').get()?.m;
  if (max == null) return 0;
  const cutoff = max - keep;
  if (cutoff <= 0) return 0;
  return db.prepare('DELETE FROM history WHERE seq <= ?').run(cutoff).changes;
}

/**
 * Watchdog: free every lease that has expired, returning its task to the pool and bumping
 * reap_count (the SLA/derailment signal Phase 4 escalates on). This is how a silent agent's
 * task recovers automatically instead of stalling forever.
 */
export function reapExpiredLeases(db, { now = nowIso() } = {}) {
  const expired = db.prepare(
    'SELECT id FROM tasks WHERE lease_expires IS NOT NULL AND lease_expires <= ?',
  ).all(now);
  const reaped = [];
  for (const { id } of expired) {
    tx(db, () => {
      const t = getTask(db, id);
      if (!(t.lease_expires && t.lease_expires <= now)) return; // someone renewed under us
      freeLease(db, t, now);
      // A lease on a done / in-review task is a leftover (belt-and-suspenders with the
      // lease-freeing transition): free it silently, but do NOT count it as a stall or remediate —
      // the work is already handed off, not stuck.
      if (t.status === 'done' || t.status === 'in-review') { reaped.push(id); return; }
      const newReapCount = t.reap_count + 1;
      db.prepare('UPDATE tasks SET reap_count = ? WHERE id=?').run(newReapCount, id);
      audit(db, { ts: now, taskId: id, from: t.status, to: t.status, actor: 'watchdog', op: 'reap', note: t.lease_owner ? `owner:${t.lease_owner}` : 'expired' });

      if (newReapCount >= 5) {
        db.prepare('UPDATE tasks SET status=?, updated_at=?, note=? WHERE id=?').run('blocked', now, `auto-blocked after ${newReapCount} reaps`, id);
        audit(db, { ts: now, taskId: id, from: t.status, to: 'blocked', actor: 'watchdog', op: 'transition', note: 'auto-blocked due to high reap count' });
      } else if (newReapCount >= 3 && t.complexity < 5) {
        db.prepare('UPDATE tasks SET complexity = MIN(5, complexity + 1) WHERE id=?').run(id);
        audit(db, { ts: now, taskId: id, from: t.status, to: t.status, actor: 'watchdog', op: 'remediate', note: `bumped complexity from ${t.complexity} to ${Math.min(5, t.complexity + 1)}` });
      }
      reaped.push(id);
    });
  }
  return { reaped };
}

/**
 * Move a task to a new status (state-machine enforced). If `requireSession` is given, the
 * caller must hold the lease. `releaseLease:true` frees the lease on the way (e.g. on handoff
 * submit or PR merge).
 */
// States where no agent is actively working the task, so any lease MUST be freed on entry.
// Otherwise the lease lingers until its 90-min TTL and the watchdog reaps it — inflating
// reap_count, raising false "task stalling" escalations, and even remediating/auto-blocking a
// task that has already shipped. A lease means "an agent is working this"; handoff ends that.
const LEASE_FREEING_STATES = new Set(['in-review', 'done', 'blocked']);

export function transition(db, { taskId, to, actor, note, requireSession = null, releaseLease: doRelease = false, pr = undefined, now = nowIso() }) {
  return tx(db, () => {
    const t = getTask(db, taskId);
    if (!t) throw new Error(`no such task: ${taskId}`);
    assertTransition(t.status, to);
    if (requireSession && t.lease_session !== requireSession) return { ok: false, reason: 'not-lease-holder' };

    if (note !== undefined) {
      db.prepare('UPDATE tasks SET status=?, note=?, updated_at=? WHERE id=?').run(to, note, now, taskId);
    } else {
      db.prepare('UPDATE tasks SET status=?, updated_at=? WHERE id=?').run(to, now, taskId);
    }
    if (pr !== undefined) db.prepare('UPDATE tasks SET pr=? WHERE id=?').run(pr, taskId);
    // A shipped task starts fresh — clear the SLA counter so it stops showing as "stalling".
    if (to === 'done') db.prepare('UPDATE tasks SET reap_count=0 WHERE id=?').run(taskId);
    if (doRelease || LEASE_FREEING_STATES.has(to)) freeLease(db, getTask(db, taskId), now);

    audit(db, { ts: now, taskId, from: t.status, to, actor, op: 'transition', note });
    return { ok: true, task: getTask(db, taskId) };
  });
}

/** Convenience: park a task as blocked (writes a feedback pointer as the note). */
export function blockTask(db, { taskId, actor, reason, now = nowIso() }) {
  return transition(db, { taskId, to: 'blocked', actor, note: reason, now });
}

/**
 * Update a task's note WITHOUT a status change (e.g. appending/clearing a snooze or skip
 * marker on a blocked task). A blocked task is already non-claimable, so parking it further
 * needs no state-machine transition — just a note update the founder can reverse later.
 */
export function annotateTask(db, { taskId, note, actor, op = 'annotate', now = nowIso() }) {
  return tx(db, () => {
    const t = getTask(db, taskId);
    if (!t) return { ok: false, reason: 'no-such-task' };
    db.prepare('UPDATE tasks SET note=?, updated_at=? WHERE id=?').run(note, now, taskId);
    audit(db, { ts: now, taskId, from: t.status, to: t.status, actor, op, note });
    return { ok: true, task: getTask(db, taskId) };
  });
}

/**
 * Set/clear the DURABLE §6 governance + park columns (approved_at / snoozed_until / skipped_at /
 * skip_reason) with NO status change, writing a `history` audit row. These columns live OUTSIDE
 * the free-text `note` precisely so a later note-overwriting transition (e.g. a verify bounce) can
 * never clobber a founder approval or park (the observed minio re-block bug). `transition()` must
 * therefore NEVER touch them — it doesn't.
 *
 * Field semantics: pass an explicit value (incl. `null`) to SET/CLEAR that column; `undefined`
 * (omit it) leaves the column as-is. `clear:true` is a convenience that NULLs all four at once
 * (ignoring the individual fields).
 */
export function setGovernanceFlags(
  db,
  { taskId, approvedAt, snoozedUntil, skippedAt, skipReason, clear = false } = {},
  { actor, op = 'govern', note = null, now = nowIso() } = {},
) {
  return tx(db, () => {
    const t = getTask(db, taskId);
    if (!t) return { ok: false, reason: 'no-such-task' };
    if (clear) {
      db.prepare(
        'UPDATE tasks SET approved_at=NULL, snoozed_until=NULL, skipped_at=NULL, skip_reason=NULL, updated_at=? WHERE id=?',
      ).run(now, taskId);
    } else {
      const sets = [];
      const vals = [];
      if (approvedAt !== undefined) { sets.push('approved_at=?'); vals.push(approvedAt); }
      if (snoozedUntil !== undefined) { sets.push('snoozed_until=?'); vals.push(snoozedUntil); }
      if (skippedAt !== undefined) { sets.push('skipped_at=?'); vals.push(skippedAt); }
      if (skipReason !== undefined) { sets.push('skip_reason=?'); vals.push(skipReason); }
      if (!sets.length) return { ok: true, task: t }; // nothing to change
      sets.push('updated_at=?'); vals.push(now);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id=?`).run(...vals, taskId);
    }
    audit(db, { ts: now, taskId, from: t.status, to: t.status, actor, op, note });
    return { ok: true, task: getTask(db, taskId) };
  });
}

/**
 * The next task `agent` may work: right status, not live-leased, all dependencies done.
 * Ordered by real priority (lower = sooner), then id. Fixes v1's alphabetical-filename queue.
 * Optional `filter(task)` callback: return false to skip a task (e.g. capability_matrix or the
 * scrum sprint gate). Scrum gating (only stories in the active sprint) is layered on by the
 * router via `buildSprintFilter`, NOT hard-coded here — so this stays testable and so the
 * system degrades gracefully (claims by status) if the sprint model is ever incompletely
 * populated, rather than silently starving.
 */
export function nextEligibleTask(db, { agent, now = nowIso(), claimable = CLAIMABLE_STATUSES, filter }) {
  const statuses = claimable ?? [];
  if (!statuses.length) return null;
  const placeholders = statuses.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM tasks
      WHERE status IN (${placeholders})
        AND (lease_expires IS NULL OR lease_expires <= ?)
      ORDER BY priority ASC, id ASC`,
  ).all(...statuses, now);

  for (const t of rows) {
    const deps = arr(t.depends_on);
    if (deps.length) {
      const doneCount = db.prepare(
        `SELECT COUNT(*) AS c FROM tasks WHERE id IN (${deps.map(() => '?').join(',')}) AND status='done'`,
      ).get(...deps).c;
      if (doneCount < deps.length) continue; // dependencies not all done
    }
    if (filter && !filter(t)) continue; // capability gate
    return t;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Promoted read-queries (D2 bite #2, stage 2a): these used to live in sensitive.mjs / router.mjs /
// watchdog.mjs. Bodies are byte-identical to their originals except for two self-containment
// adaptations forced by the acyclic-imports constraint (state.mjs must not import sensitive.mjs /
// router.mjs / watchdog.mjs): `parseJsonArray(...)` calls use this module's local `arr` helper
// directly (the exact same function, just its in-module name), and `parkedTasks` calls the local
// `listTasks(db)` / inlines the two trivial sensitive.mjs column-readers (`skipped_at != null`,
// `snoozed_until ?? null`) instead of importing them. The old modules re-export these by name so
// every existing external importer keeps working unchanged.
// ---------------------------------------------------------------------------------------------

/**
 * Walk a task's ancestors via the EXPLICIT parent_id chain and return the task plus every ancestor
 * row. We deliberately do NOT infer ancestry from the id-prefix: ids like `F2-3-photo-tools-ui`
 * (a standalone UI epic) share the `F2-` prefix with the money epic `F2` without being its child,
 * so a prefix heuristic would wrongly tar pure-UI work with `payments`/`external` and block it.
 * parent_id is the source of truth for the hierarchy (see the seed/board.json).
 */
export function taskWithAncestors(db, task) {
  const all = db.prepare('SELECT id, parent_id, risk_tags FROM tasks').all();
  const byId = new Map(all.map((t) => [t.id, t]));
  const out = [];
  const seen = new Set();
  let cur = byId.get(task.id) ?? task;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return out;
}

/** The union of a task's own risk_tags and all its ancestors' risk_tags (lowercased). */
export function effectiveRiskTags(db, task) {
  const tags = new Set();
  for (const t of taskWithAncestors(db, task)) {
    for (const tag of arr(t.risk_tags)) tags.add(String(tag).toLowerCase());
  }
  return [...tags];
}

/**
 * The scrum sprint gate. In scrum mode ONLY stories committed to an active sprint are workable
 * (epics/features are containers; unassigned stories are backlog). Returns null when the DB has
 * no active sprint — so the system degrades to status-based selection instead of starving, and
 * so non-scrum callers/tests are unaffected. Composable with the capability filter.
 */
export function buildSprintFilter(db) {
  let activeSprintIds;
  try {
    activeSprintIds = db.prepare("SELECT id FROM sprints WHERE status = 'active'").all().map((r) => r.id);
  } catch {
    return null; // no sprints table (e.g. a minimal test DB) → no scrum gating
  }
  if (!activeSprintIds.length) return null; // no active sprint → fail open (don't starve)
  const active = new Set(activeSprintIds);
  return (task) => {
    if (task.type && task.type !== 'story') return false;   // only stories are directly workable
    if (!task.sprint_id) return false;                       // unassigned = backlog, not committed
    return active.has(task.sprint_id);                       // must be in an active sprint
  };
}

/** Recent expired-lease reaps (from the audit log). owner is recovered from the reap note. */
export function recentReaps(db, { limit = 10 } = {}) {
  const rows = db.prepare(
    `SELECT h.ts AS ts, h.task_id AS task, h.note AS note, t.reap_count AS reapCount
       FROM history h LEFT JOIN tasks t ON t.id = h.task_id
      WHERE h.op = 'reap' ORDER BY h.seq DESC LIMIT ?`,
  ).all(limit);
  return rows.map((r) => ({
    ts: r.ts,
    task: r.task,
    owner: r.note && r.note.startsWith('owner:') ? r.note.slice(6) : null,
    reapCount: r.reapCount ?? null,
    sessionAgeSec: null,
  }));
}

/**
 * Blocked tasks the founder has parked (snoozed or skipped) — kept OUT of collectEscalations
 * so they stop nagging, but still listed here so the dashboard's "Snoozed / Skipped" section
 * can show them with an Un-snooze/Un-skip + Approve control (reversible, never silently lost).
 */
export function parkedTasks(db, { now = Date.now() } = {}) {
  const out = [];
  for (const t of listTasks(db).filter((t) => t.status === 'blocked')) {
    const skipped = t.skipped_at != null;               // mirrors sensitive.isSkipped
    const until = t.snoozed_until ?? null;               // mirrors sensitive.snoozedUntil
    const snoozed = !!(until && Date.parse(until) > now);
    if (!skipped && !snoozed) continue;
    out.push({ task: t.id, status: t.status, owner: t.owner, note: t.note, skipped, snoozedUntil: snoozed ? until : null });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// D2 bite #2, stage 2b: new state-layer helpers so the ORCHESTRATION layer (planner.mjs,
// watchdog.mjs, verify-loop.mjs) can stop reaching into a raw `db` directly now that their public
// entry points flip to receive a ProjectStore `store` instead of `db`. Every body below is
// byte-identical to the ad-hoc SQL its caller used to run inline — pure relocation, never a
// behavior change. Exposed via state-store.mjs's DB_BOUND_FNS so callers reach them as
// `store.state.<name>(...)`.
// ---------------------------------------------------------------------------------------------

/** Overwrite a task's note WITHOUT an audit row and WITHOUT a status change — distinct from
 *  annotateTask (which also writes a history row). Mirrors the planner's prior ad-hoc SQL. */
export function setTaskNote(db, { taskId, note, now = nowIso() }) {
  db.prepare('UPDATE tasks SET note=?, updated_at=? WHERE id=?').run(note, now, taskId);
}

/** Re-point a task at a different sprint, with no audit row. Mirrors the planner's prior
 *  ad-hoc sprint-carry-over SQL. */
export function setTaskSprint(db, { taskId, sprintId, now = nowIso() }) {
  db.prepare('UPDATE tasks SET sprint_id = ?, updated_at = ? WHERE id = ?').run(sprintId, now, taskId);
}

/** The single active sprint row, or undefined if none. */
export function getActiveSprint(db) {
  return db.prepare("SELECT * FROM sprints WHERE status = 'active'").get();
}

/** Mark a sprint completed (no audit row). Mirrors the planner's prior ad-hoc SQL. */
export function completeSprint(db, id) {
  db.prepare("UPDATE sprints SET status = 'completed' WHERE id = ?").run(id);
}

/** How many of `ids` currently have status='done'. */
export function countDoneAmong(db, ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE id IN (${placeholders}) AND status='done'`).get(...ids).c;
}

/** The `from_state` of the most recent transition INTO `to` for a task (used by the planner to
 *  restore the pre-block status on a governance release). */
export function lastTransitionInto(db, taskId, to) {
  return db.prepare(
    'SELECT from_state FROM history WHERE task_id=? AND op=\'transition\' AND to_state=? ORDER BY seq DESC LIMIT 1',
  ).get(taskId, to);
}

/** Tasks reaped at or above the SLA threshold — likely a stuck agent. Moved from watchdog.mjs's
 *  ad-hoc SQL so the flipped watchdog.slaBreaches can reach it via store.state instead of a raw db. */
export function slaBreaches(db, threshold) {
  return db.prepare(
    'SELECT id AS task, reap_count AS reapCount, updated_at AS sinceTs FROM tasks WHERE reap_count >= ? ORDER BY reap_count DESC',
  ).all(threshold).map((r) => ({ task: r.task, reapCount: r.reapCount, sinceTs: r.sinceTs }));
}

/**
 * Verify-attempt counter (the `verify_attempts` table) — the durable 3-strike "bounce then block"
 * counter verify-loop.mjs's handleFailure needs to survive daemon restarts. Moved here so the
 * flipped verifyCycle can reach it via store.state instead of a raw db.
 */
export function getVerifyAttempts(db, taskId) {
  try { return db.prepare('SELECT attempts FROM verify_attempts WHERE task_id=?').get(taskId)?.attempts ?? 0; }
  catch { return 0; }
}

export function bumpVerifyAttempts(db, taskId, now = nowIso()) {
  const n = getVerifyAttempts(db, taskId) + 1;
  try {
    db.prepare(`INSERT INTO verify_attempts(task_id, attempts, updated_at) VALUES (?,?,?)
                ON CONFLICT(task_id) DO UPDATE SET attempts=excluded.attempts, updated_at=excluded.updated_at`)
      .run(taskId, n, now);
  } catch { /* best-effort */ }
  return n;
}

export function clearVerifyAttempts(db, taskId) {
  try { db.prepare('DELETE FROM verify_attempts WHERE task_id=?').run(taskId); } catch { /* best-effort */ }
}

export { arr as parseJsonArray, nowIso, DAY };
