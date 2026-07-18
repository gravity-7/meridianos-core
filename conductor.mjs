/**
 * conductor — the no-LLM, lease-guarded relauncher for the disposable-session continuity protocol
 * (ACCELERATION-PLAN §9; card C8). A Windows Scheduled Task runs `node conductor.mjs` every 5 min.
 * The conductor NEVER reasons — it makes one mechanical decision: should a fresh orchestrator be
 * spawned right now? If yes, it takes the lease FIRST (so a double-spawn is impossible) and launches
 * `claude -p @RESUME-PROMPT.md`. The spawned orchestrator boots as a resume from durable state
 * (checkpoint + decision log + board + continuity.json), so no session death loses a card.
 *
 * Skip conditions (exit early, spawn nothing):
 *   - an orchestrator is ALIVE (lease held by a live PID, not past the hard max-age) — double-spawn guard
 *   - the last session HALTED (continuity.exit_class === 'halt') — an intentional stop, not a crash;
 *     the founder clears it, not the conductor
 *   - a future resume_at is set — the session paused for a quota window that hasn't reopened yet
 *
 * The lease is reclaimed automatically when its PID is dead (crash) or older than MAX_LEASE_MS
 * (a wedged process), so a real crash resurrects on the next tick, not hours later.
 *
 * Dry-run (CONDUCTOR_DRY_RUN=1 or --dry-run): prints the decision + the command it WOULD run and
 * does not spawn — used by the forced pause/resume drill and safe to run anywhere.
 */
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const LEASE_PATH = join(ROOT, '.ai', 'state', 'orchestrator.lease');
const CONTINUITY_PATH = join(ROOT, '.ai', 'state', 'continuity.json');
const SECRET_PATH = join(ROOT, '.ai', 'secrets', 'escalation-webhook');
const RESUME_PROMPT = join(ROOT, 'RESUME-PROMPT.md');

/** A session window is ~5h; cap a lease's life a bit beyond that so a wedged process can't block
 *  resurrection forever, while a live session is never pre-empted mid-window. */
export const MAX_LEASE_MS = 6 * 60 * 60 * 1000;

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** Is `pid` a live process on this machine? kill(pid,0) throws ESRCH if not. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** PURE decision — no IO, fully unit-testable. Returns { spawn, reason }. */
export function decide({ now, lease, leaseAlive, continuity }) {
  if (lease && leaseAlive) return { spawn: false, reason: 'orchestrator-alive' };
  if (continuity?.exit_class === 'halt') return { spawn: false, reason: 'halted (founder must clear)' };
  const resumeAt = continuity?.resume_at ? Date.parse(continuity.resume_at) : NaN;
  if (Number.isFinite(resumeAt) && resumeAt > now) return { spawn: false, reason: 'resume_at in future' };
  return { spawn: true, reason: 'window open — relaunching orchestrator' };
}

/** Read the current lease and decide whether its holder is still alive (PID up AND within max-age). */
function inspectLease(now) {
  if (!existsSync(LEASE_PATH)) return { lease: null, alive: false };
  const lease = readJson(LEASE_PATH, null);
  if (!lease) return { lease: null, alive: false };
  const fresh = (now - (Date.parse(lease.acquired_at) || 0)) < MAX_LEASE_MS;
  return { lease, alive: fresh && pidAlive(lease.pid) };
}

/** Atomically create the lease (wx = exclusive). Reclaims a dead/stale lease first. Returns true on win. */
export function acquireLease(pid, now = Date.now()) {
  const { alive } = inspectLease(now);
  if (alive) return false;                 // a live holder exists — never steal it
  try { if (existsSync(LEASE_PATH)) unlinkSync(LEASE_PATH); } catch { /* raced; fall through */ }
  try {
    const fd = openSync(LEASE_PATH, 'wx');  // fails EEXIST if another tick won the race
    writeFileSync(fd, JSON.stringify({ pid, host: process.env.COMPUTERNAME || 'local', acquired_at: new Date(now).toISOString() }, null, 2));
    closeSync(fd);
    return true;
  } catch { return false; }
}

function webhookUrl() {
  const env = process.env.AIOS_ESCALATION_WEBHOOK;
  if (env && /^https?:\/\//i.test(env)) return env;
  try { const f = readFileSync(SECRET_PATH, 'utf8').trim(); if (/^https?:\/\//i.test(f)) return f; } catch { /* none */ }
  return null;
}

async function ping(text) {
  const url = webhookUrl();
  if (!url) return;
  const body = /hooks\.slack\.com/i.test(url) ? { text } : { content: text };
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }); } catch { /* best-effort */ }
}

async function main() {
  const dry = process.env.CONDUCTOR_DRY_RUN === '1' || process.argv.includes('--dry-run');
  const now = Date.now();
  const { lease, alive } = inspectLease(now);
  const continuity = readJson(CONTINUITY_PATH, {});
  const { spawn: shouldSpawn, reason } = decide({ now, lease, leaseAlive: alive, continuity });

  if (!shouldSpawn) { console.log(`[conductor] skip: ${reason}`); return; }

  // COOL-DOWN (2026-07-18): a session boot is expensive (full durable-state read). Respawning every
  // 5 min turned one blocker into 26 boots that burned the whole window. Minimum 60 min between
  // spawns — a healthy session lives for hours; anything that dies faster needs a founder look anyway.
  const SPAWN_STAMP = join(dirname(LEASE_PATH), 'conductor-last-spawn');
  const lastSpawn = (() => { try { return Number(readFileSync(SPAWN_STAMP, 'utf8')); } catch { return 0; } })();
  if (now - lastSpawn < 60 * 60_000) { console.log('[conductor] skip: cool-down (last spawn < 60 min ago)'); return; }
  try { writeFileSync(SPAWN_STAMP, String(now)); } catch { /* best-effort */ }

  const cmd = 'claude';
  // acceptEdits alone DENIES Bash execution in headless mode — sessions #5–#24 (2026-07-18) burned a
  // whole night unable to run `npm test`/`git add`. Execution tools must be explicitly allowed
  // (mirrored in .claude/settings.local.json as belt-and-suspenders).
  const args = ['-p', `@${RESUME_PROMPT}`, '--permission-mode', 'acceptEdits',
    '--add-dir', 'C:\\projects\\mos-dev', '--add-dir', 'C:\\projects\\.mos-worktrees',
    '--allowedTools', 'Bash(git:*)', 'Bash(gh:*)', 'Bash(npm:*)', 'Bash(node:*)', 'Bash(npx:*)'];
  if (dry) { console.log(`[conductor] DRY-RUN would spawn (${reason}); in_flight=${(continuity.in_flight_cards || []).map(c => c.card).join(',') || 'none'}\n  ${cmd} ${args.join(' ')}`); return; }

  const child = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
  if (!acquireLease(child.pid, now)) { console.log('[conductor] lost lease race after spawn — child continues; lease held by winner'); }
  child.unref();
  // Rate-limit relaunch pings to 1/30min — an overnight respawn loop once flooded the channel.
  const PING_STAMP = join(dirname(LEASE_PATH), 'conductor-last-ping');
  const lastPing = (() => { try { return Number(readFileSync(PING_STAMP, 'utf8')); } catch { return 0; } })();
  if (now - lastPing > 30 * 60_000) {
    await ping(`:satellite: *conductor* relaunched the orchestrator (pid ${child.pid}) — ${reason}.`);
    try { writeFileSync(PING_STAMP, String(now)); } catch { /* best-effort */ }
  }
  console.log(`[conductor] spawned orchestrator pid ${child.pid}: ${reason}`);
}

// Only run when invoked directly (not when imported by the unit test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('[conductor] fatal', e); process.exitCode = 1; });
}
