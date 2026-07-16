import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocStore } from '../doc-store.mjs';

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'aios-docstore-'));
}

test('write→read round-trips exact bytes', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  const body = 'line one\nline two\n— em dash, emoji 🎉\n';
  const rel = join('.ai', 'inbox', 'F-1.handoff.md');
  const written = docs.write(rel, body);
  assert.equal(written, rel);
  assert.equal(docs.read(rel), body);
});

test('exists() reflects presence before and after write', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  const rel = join('.ai', 'feedback', 'F-2.md');
  assert.equal(docs.exists(rel), false);
  docs.write(rel, 'hello');
  assert.equal(docs.exists(rel), true);
});

test('read() throws for a missing file (callers must guard with exists)', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  assert.throws(() => docs.read(join('.ai', 'nope.md')));
});

test('list() of a missing dir returns [] (never throws)', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  assert.deepEqual(docs.list(join('.ai', 'does-not-exist')), []);
});

test('list() returns entry names for an existing dir', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  docs.write(join('.ai', 'inbox', 'a.md'), 'a');
  docs.write(join('.ai', 'inbox', 'b.md'), 'b');
  const names = docs.list(join('.ai', 'inbox')).sort();
  assert.deepEqual(names, ['a.md', 'b.md']);
});

test('a `..`-escape throws instead of touching the filesystem outside repoRoot', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  assert.throws(() => docs.write(join('..', 'escaped.md'), 'x'));
  assert.throws(() => docs.read(join('..', 'escaped.md')));
  assert.throws(() => docs.exists(join('..', '..', 'escaped.md')));
  assert.throws(() => docs.list(join('..')));
});

test('write() creates parent directories recursively', () => {
  const repoRoot = freshRoot();
  const docs = createDocStore({ repoRoot });
  const rel = join('deep', 'nested', 'dir', 'file.txt');
  docs.write(rel, 'nested content');
  assert.equal(docs.read(rel), 'nested content');
});
