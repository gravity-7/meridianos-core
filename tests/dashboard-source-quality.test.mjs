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
 *
 * 010 (Frontend ES Module Migration, FR-010) adds two more assertions, both expected to stay red
 * from Phase 1 through Phase 10 and go green only once Phase 11/US9 deletes dashboard/index.html's
 * classic script entirely — see TOP_LEVEL_FUNCTION_RE / NON_MODULE_SCRIPT_RE below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

// Matches a top-level `function foo(...)` / `async function foo(...)` declaration — anchored to
// column 0 (start of line, `m` flag) because every classic-script declaration in
// dashboard/index.html is written unindented; a nested function inside another function/callback is
// always indented. Confirmed empirically, not assumed: a `^\s+(async )?function ` scan (leading
// whitespace required) over the current file returns zero matches. This is FR-010/010's completion
// gate — expected to match 66 declarations (65 unique names) at Phase 1 baseline, dropping to zero
// only once Phase 11/US9 removes the classic script entirely.
const TOP_LEVEL_FUNCTION_RE = /^(async )?function [a-zA-Z_$][a-zA-Z0-9_$]*/gm;

// Matches any `<script` tag that is neither `type="module"` nor one of the three unmodified vendor
// `<script src="static/vendor/...">` includes (uPlot/Muuri/Litegraph, out of scope per 010's
// Assumptions) — i.e. a classic (non-module), non-vendor script tag, exactly what FR-002 forbids
// once 010 completes. Order-independent: the lookaheads scan the whole tag for `type="module"` /
// the vendor src prefix regardless of where in the tag they appear. Anchored to column 0 (`^`, `m`
// flag), same empirically-confirmed convention as TOP_LEVEL_FUNCTION_RE above — every real
// `<script` tag in this file starts a line; the string "<script>" also appears once, unanchored,
// inside a prose HTML comment near the vendor includes (referring to the concept, not a real tag),
// which the anchor correctly excludes.
const NON_MODULE_SCRIPT_RE = /^<script(?![^>]*type="module")(?![^>]*src="static\/vendor\/)[^>]*>/gm;

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

// Syntax-only check (`node --check`, no execution) for a module whose top-level code touches the
// DOM (document.getElementById(...).addEventListener(...) etc.) — a plain dynamic `import()` would
// throw `document is not defined` in plain Node before it ever got to check syntax. Modules with no
// such top-level DOM access (dashboard-utils.mjs) use a real dynamic import instead, matching the
// client-error-log.mjs/poll-dispatcher.mjs precedent above — it exercises more than just parsing.
function assertModuleSyntaxValid(relPath) {
  const absPath = join(REPO_ROOT, ...relPath.split('/'));
  execFileSync(process.execPath, ['--check', absPath], { stdio: 'pipe' });
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

test('dashboard/static/dashboard-utils.mjs is syntactically valid and exports the shared helpers (010 US1)', async () => {
  const utils = await import('../dashboard/static/dashboard-utils.mjs');
  for (const name of ['esc', 'relTime', 'formatSpend', 'formatNumber', 'shortModel', 'badgeFor', 'outcomeBadge']) {
    assert.equal(typeof utils[name], 'function', `expected ${name} to be exported as a function`);
  }
});

test('dashboard/static/escalation-actions.mjs is syntactically valid (010 US2)', () => {
  assert.doesNotThrow(() => assertModuleSyntaxValid('dashboard/static/escalation-actions.mjs'));
});

test('dashboard/static/spend-budget.mjs is syntactically valid (010 US3)', () => {
  assert.doesNotThrow(() => assertModuleSyntaxValid('dashboard/static/spend-budget.mjs'));
});

test('dashboard/static/optimization.mjs is syntactically valid (010 US4)', () => {
  assert.doesNotThrow(() => assertModuleSyntaxValid('dashboard/static/optimization.mjs'));
});

test('dashboard/static/ide-integration.mjs is syntactically valid (010 US5)', () => {
  assert.doesNotThrow(() => assertModuleSyntaxValid('dashboard/static/ide-integration.mjs'));
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

test('dashboard/index.html has zero top-level function declarations (010 FR-010)', () => {
  const source = readFileSync(join(REPO_ROOT, 'dashboard', 'index.html'), 'utf8');
  const matches = findMatches(source, TOP_LEVEL_FUNCTION_RE);
  assert.deepEqual(
    matches,
    [],
    `Found ${matches.length} top-level function declaration(s) in dashboard/index.html — each must ` +
      `move into a dashboard/static/*.mjs module (Constitution Principle VIII):\n` +
      matches.map((m) => `  line ${m.line}: ${m.text}`).join('\n'),
  );
});

test('dashboard/index.html has zero non-module, non-vendor <script> tags (010 FR-010)', () => {
  const source = readFileSync(join(REPO_ROOT, 'dashboard', 'index.html'), 'utf8');
  const matches = findMatches(source, NON_MODULE_SCRIPT_RE);
  assert.deepEqual(
    matches,
    [],
    `Found ${matches.length} classic (non-module, non-vendor) <script> tag(s) in dashboard/index.html:\n` +
      matches.map((m) => `  line ${m.line}: ${m.text}`).join('\n'),
  );
});
