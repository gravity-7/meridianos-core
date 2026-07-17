import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePaths } from '../config.mjs';
import { createDocStore } from '../doc-store.mjs';
import { createInboxSource, parseFrontmatter } from '../inbox-source.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

function freshConfig() {
  const root = mkdtempSync(join(tmpdir(), 'aios-inboxsource-'));
  return resolvePaths({ root, domain: FIXTURE_DOMAIN });
}

// ---- parseFrontmatter ----------------------------------------------------------------------

test('parseFrontmatter: well-formed handoff frontmatter -> meta + body', () => {
  const text = '---\nfeature: F-dsgn\nfrom: antigravity\nto: claude-code\nstatus: ready-for-impl\n---\n\n# Done\nbuilt the cards';
  const { meta, body } = parseFrontmatter(text);
  assert.deepEqual(meta, { feature: 'F-dsgn', from: 'antigravity', to: 'claude-code', status: 'ready-for-impl' });
  assert.equal(body, '# Done\nbuilt the cards');
});

test('parseFrontmatter: well-formed request frontmatter -> meta + body', () => {
  const text = '---\nfeature: F0-a11y\nslug: a11y\ntask_type: request\nstatus: proposed\nconstitution: v1\n---\n\nplease review';
  const { meta, body } = parseFrontmatter(text);
  assert.deepEqual(meta, { feature: 'F0-a11y', slug: 'a11y', task_type: 'request', status: 'proposed', constitution: 'v1' });
  assert.equal(body, 'please review');
});

test('parseFrontmatter: no frontmatter -> { meta: {}, body: text }', () => {
  const text = 'just plain markdown, no fence at all';
  assert.deepEqual(parseFrontmatter(text), { meta: {}, body: text });
});

test('parseFrontmatter: unterminated fence (malformed) -> never throws, falls back to original text', () => {
  const text = '---\nfeature: F-1\nno closing fence here';
  assert.doesNotThrow(() => parseFrontmatter(text));
  assert.deepEqual(parseFrontmatter(text), { meta: {}, body: text });
});

test('parseFrontmatter: garbage/binary-ish input never throws', () => {
  assert.doesNotThrow(() => parseFrontmatter(null));
  assert.doesNotThrow(() => parseFrontmatter(undefined));
  assert.doesNotThrow(() => parseFrontmatter(''));
  assert.doesNotThrow(() => parseFrontmatter('---\n\0\x01---\n\nbody'));
  assert.deepEqual(parseFrontmatter(undefined), { meta: {}, body: '' });
});

// ---- list() ---------------------------------------------------------------------------------

test('list(): [] when the inbox dir is absent', () => {
  const config = freshConfig();
  const inbox = createInboxSource({ config });
  assert.deepEqual(inbox.list(), []);
});

test('list(): normalizes both kinds, ignores README.md and non-.md, deterministic id-sorted order, no body', () => {
  const config = freshConfig();
  const dir = join(config.repoRoot, '.ai', 'inbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Inbox\nhow this works', 'utf8');
  writeFileSync(join(dir, 'notes.txt'), 'not markdown', 'utf8');
  writeFileSync(join(dir, 'Z-later.handoff.md'), '---\nfeature: Z-later\nfrom: antigravity\nto: claude-code\nstatus: ready-for-impl\n---\n\nzzz', 'utf8');
  writeFileSync(join(dir, 'A-first.request.md'), '---\nfeature: A-first\nslug: a-first\ntask_type: request\nstatus: proposed\nconstitution: v1\n---\n\naaa', 'utf8');

  const inbox = createInboxSource({ config });
  const items = inbox.list();
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.id), ['A-first.request', 'Z-later.handoff']); // id-sorted asc

  const [req, ho] = items;
  assert.equal(req.source, 'filesystem-inbox');
  assert.equal(req.kind, 'request');
  assert.equal(req.feature, 'A-first');
  assert.equal(req.status, 'proposed');
  assert.equal(req.path, '.ai/inbox/A-first.request.md');
  assert.equal(req.meta.slug, 'a-first');
  assert.equal('body' in req, false);

  assert.equal(ho.kind, 'handoff');
  assert.equal(ho.feature, 'Z-later');
  assert.equal(ho.status, 'ready-for-impl');
  assert.equal(ho.path, '.ai/inbox/Z-later.handoff.md');
  assert.equal('body' in ho, false);
});

// ---- read() ---------------------------------------------------------------------------------

test('read(id): returns the normalized item WITH the exact body', () => {
  const config = freshConfig();
  const dir = join(config.repoRoot, '.ai', 'inbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'F-dsgn.handoff.md'), '---\nfeature: F-dsgn\nfrom: antigravity\nto: claude-code\nstatus: ready-for-impl\n---\n\n# Done\nbuilt the cards', 'utf8');

  const inbox = createInboxSource({ config });
  const item = inbox.read('F-dsgn.handoff');
  assert.equal(item.id, 'F-dsgn.handoff');
  assert.equal(item.kind, 'handoff');
  assert.equal(item.feature, 'F-dsgn');
  assert.equal(item.status, 'ready-for-impl');
  assert.equal(item.path, '.ai/inbox/F-dsgn.handoff.md');
  assert.equal(item.body, '# Done\nbuilt the cards');
});

test('read(id): unknown id -> null (does not throw)', () => {
  const config = freshConfig();
  const inbox = createInboxSource({ config });
  assert.equal(inbox.read('nope.handoff'), null);
  assert.equal(inbox.read('not-a-recognized-suffix'), null);
});

// ---- submit() ---------------------------------------------------------------------------------

test('submit(): round-trips through list()/read(); path + bytes correct', () => {
  const config = freshConfig();
  const inbox = createInboxSource({ config });
  const path = inbox.submit({ feature: 'F-new', markdown: '# hello\nworld' });
  assert.equal(path, '.ai/inbox/F-new.handoff.md');

  const onDisk = readFileSync(join(config.repoRoot, '.ai', 'inbox', 'F-new.handoff.md'), 'utf8');
  assert.equal(onDisk, '---\nfeature: F-new\nfrom: antigravity\nto: claude-code\nstatus: ready-for-impl\n---\n\n# hello\nworld');

  const listed = inbox.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'F-new.handoff');
  assert.equal(listed[0].feature, 'F-new');

  const read = inbox.read('F-new.handoff');
  assert.equal(read.body, '# hello\nworld');
  assert.equal(read.feature, 'F-new');
});

test('submit(): kind + meta drive a non-handoff (request) item', () => {
  const config = freshConfig();
  const inbox = createInboxSource({ config });
  const path = inbox.submit({ feature: 'F-req', markdown: 'please review', kind: 'request', meta: { slug: 'f-req', task_type: 'request', status: 'proposed', constitution: 'v1' } });
  assert.equal(path, '.ai/inbox/F-req.request.md');

  const item = inbox.read('F-req.request');
  assert.equal(item.kind, 'request');
  assert.equal(item.meta.slug, 'f-req');
  assert.equal(item.meta.task_type, 'request');
  assert.equal(item.status, 'proposed');
  assert.equal(item.body, 'please review');
});

test('submit(): feature is sanitized the same way bus.submitHandoff sanitizes it', () => {
  const config = freshConfig();
  const inbox = createInboxSource({ config });
  const path = inbox.submit({ feature: 'weird/feature name!', markdown: 'x' });
  assert.equal(path, '.ai/inbox/weird_feature_name_.handoff.md');
});

test('createInboxSource reuses an injected DocStore instead of constructing a second one', () => {
  const config = freshConfig();
  const docs = createDocStore(config);
  const inbox = createInboxSource({ config, docs });
  inbox.submit({ feature: 'F-shared', markdown: 'shared docstore' });
  // Visible through the SAME injected docs instance, proving it wrote through it (not a new one).
  assert.equal(docs.exists(join('.ai', 'inbox', 'F-shared.handoff.md')), true);
});

test('name is "filesystem-inbox"', () => {
  const config = freshConfig();
  assert.equal(createInboxSource({ config }).name, 'filesystem-inbox');
});
