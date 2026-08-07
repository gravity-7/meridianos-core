/**
 * dashboard-source-quality — mechanical regression guard for two specific anti-patterns removed in
 * 009 (Dashboard Modernization, US3/FR-006/FR-008): empty/no-op `catch` blocks, and the
 * `poll = async function(){...}` global-reassignment pattern. Both were the direct mechanism behind
 * the pre-Phase-9 audit's headline bug — a thrown `TypeError` silently discarded by a bare `catch`
 * with no logging, which took a full investigation pass to even locate.
 *
 * This is a plain regex scan over source text, not an AST parse — consistent with this repo's
 * Zero-Dependency Philosophy (Constitution Principle III: no new parser dependency for a check this
 * targeted). The patterns are deliberately narrow (see EMPTY_CATCH_RE / POLL_REASSIGN_RE below) so
 * this test fails only on the exact anti-patterns it exists to prevent, not on legitimate catches
 * that already report or handle their error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Matches `catch(e){}`, `catch{}`, `catch (e) { }`, and a catch body containing only block
// comment(s) — e.g. `catch { /* optional feature unavailable */ }` — since a comment-only body
// still takes no action (no visible-state update, no report), which is exactly what FR-006 forbids.
// Deliberately does NOT match a catch containing any real statement, even one line, even alongside
// a comment.
const EMPTY_CATCH_RE = /catch\s*(\([^)]*\))?\s*\{\s*(\/\*[\s\S]*?\*\/\s*)*\}/g;

// Matches the specific `poll = async function` global-reassignment anti-pattern this phase replaces
// with poll-dispatcher.mjs's registerPollHandler().
const POLL_REASSIGN_RE = /\bpoll\s*=\s*async\s+function\s*\(/g;

function findMatches(source, re) {
  const matches = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(source))) {
    const upToMatch = source.slice(0, m.index);
    const line = upToMatch.split('\n').length;
    matches.push({ line, text: m[0].replace(/\s+/g, ' ').trim() });
  }
  return matches;
}

function listDashboardStaticFiles() {
  const dir = join(REPO_ROOT, 'dashboard', 'static');
  // Exclude vendor/ — third-party vendored libraries (uPlot/Muuri/Litegraph) are not this repo's
  // code and are out of scope for this repo's own error-handling discipline.
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join(dir, f));
}

test('dashboard/index.html has zero empty/no-op catch blocks', () => {
  const source = readFileSync(join(REPO_ROOT, 'dashboard', 'index.html'), 'utf8');
  const matches = findMatches(source, EMPTY_CATCH_RE);
  assert.deepEqual(
    matches,
    [],
    `Found ${matches.length} empty/no-op catch block(s) in dashboard/index.html:\n` +
      matches.map((m) => `  line ${m.line}: ${m.text}`).join('\n'),
  );
});

test('dashboard/static/*.mjs (excluding vendor/) have zero empty/no-op catch blocks', () => {
  const offenders = [];
  for (const file of listDashboardStaticFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const m of findMatches(source, EMPTY_CATCH_RE)) {
      offenders.push({ file, ...m });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Found empty/no-op catch block(s):\n` +
      offenders.map((o) => `  ${o.file}:${o.line}: ${o.text}`).join('\n'),
  );
});

test('dashboard/static/client-error-log.mjs and poll-dispatcher.mjs are syntactically valid and export what dashboard/index.html expects', async () => {
  // Regex source-scans above can't catch a syntax error in these two modules — Node's test runner
  // never actually imports browser-side .mjs files otherwise. This caught a real bug during Phase 9
  // development: a JSDoc comment containing a literal `/* ... */` substring silently closed the
  // outer block comment early, turning the rest of the file into a syntax error that only surfaced
  // live in the browser. A plain dynamic import is enough to catch that class of bug in `npm test`
  // instead of requiring a live-browser check every time.
  const errLog = await import('../dashboard/static/client-error-log.mjs');
  const dispatcher = await import('../dashboard/static/poll-dispatcher.mjs');
  assert.equal(typeof errLog.reportError, 'function');
  assert.equal(typeof dispatcher.registerPollHandler, 'function');
  assert.equal(typeof dispatcher.runPollHandlers, 'function');
});

test('dashboard/index.html has zero `poll = async function` reassignments', () => {
  const source = readFileSync(join(REPO_ROOT, 'dashboard', 'index.html'), 'utf8');
  const matches = findMatches(source, POLL_REASSIGN_RE);
  assert.deepEqual(
    matches,
    [],
    `Found ${matches.length} \`poll = async function\` reassignment(s) in dashboard/index.html ` +
      `— use poll-dispatcher.mjs's registerPollHandler() instead:\n` +
      matches.map((m) => `  line ${m.line}: ${m.text}`).join('\n'),
  );
});
