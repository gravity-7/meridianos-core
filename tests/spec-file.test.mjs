import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSpec, writeSpec } from '../dashboard/spec-file.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

const FIXTURE_DIR = join(config.repoRoot, '.ai', 'features', '__test-spec-file__');
const FIXTURE_REL = '.ai/features/__test-spec-file__/spec.md';
const FIXTURE_ABS = join(FIXTURE_DIR, 'spec.md');

test('readSpec / writeSpec round-trip a file under .ai/features/', () => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURE_ABS, '# original\n');
  try {
    assert.equal(readSpec(FIXTURE_REL, config), '# original\n');
    const r = writeSpec(FIXTURE_REL, '# updated\n', config);
    assert.deepEqual(r, { ok: true, path: FIXTURE_REL });
    assert.equal(readSpec(FIXTURE_REL, config), '# updated\n');
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

test('rejects paths outside .ai/features/ (never touches other files)', () => {
  assert.throws(() => readSpec('.ai/policy.yaml', config), /not allowed/);
  assert.throws(() => readSpec('../../etc/passwd', config), /not allowed/);
  assert.throws(() => writeSpec('.ai/features/../../CLAUDE.md', 'x', config), /not allowed/);
});

test('rejects non-markdown paths inside .ai/features/', () => {
  assert.throws(() => readSpec('.ai/features/F1-1.9-admin/notes.txt', config), /not allowed/);
});

test('readSpec returns empty string for missing file; writeSpec creates it', () => {
  const dir = join(config.repoRoot, '.ai', 'features', '__does-not-exist__');
  try {
    assert.equal(readSpec('.ai/features/__does-not-exist__/spec.md', config), '');
    const r = writeSpec('.ai/features/__does-not-exist__/spec.md', '# new\n', config);
    assert.deepEqual(r, { ok: true, path: '.ai/features/__does-not-exist__/spec.md' });
    assert.equal(readSpec('.ai/features/__does-not-exist__/spec.md', config), '# new\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSpec requires a string content', () => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(FIXTURE_ABS, '# original\n');
  try {
    assert.throws(() => writeSpec(FIXTURE_REL, 42, config), /content must be a string/);
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});
