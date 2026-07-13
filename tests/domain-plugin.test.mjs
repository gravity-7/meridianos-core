import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaths, reviewerFor } from '../config.mjs';
import { buildBoardMd } from '../render.mjs';
import { sensitiveBlock, sensitiveBlocks } from '../sensitive.mjs';
import { checkInvariants } from '../validate.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// Independently computed expected repo root (three dirs up from tools/aios/tests/) — same
// derivation config.test.mjs uses, to assert paths are unaffected by a non-default plugin.
const EXPECTED_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const config = resolvePaths({ domain: FIXTURE_DOMAIN }); // for calls where knownRiskTags is omitted

// A fully non-default DomainPlugin — the "2nd tenant" proof that core honors an injected plugin
// end-to-end, not just PV's own defaults reflected back.
const FAKE = {
  agents: ['alice', 'bob', 'carol'],
  prompts: {
    implRules: ['- Fake rule'],
    reviewCriteria: ['- Fake criterion'],
  },
  guardrailCheck: { cmd: 'node', script: 'noop.mjs' },
};

test('a non-default DomainPlugin fully replaces the roster, prompts, and guardrailCheck', () => {
  const cfg = resolvePaths({ domain: FAKE });
  assert.deepEqual(cfg.domain.agents, FAKE.agents);
  assert.deepEqual(cfg.domain.prompts, FAKE.prompts);
  assert.deepEqual(cfg.domain.guardrailCheck, FAKE.guardrailCheck);
});

test('reviewerFor honors the injected plugin roster (not the PV default)', () => {
  const cfg = resolvePaths({ domain: FAKE });
  assert.equal(reviewerFor('alice', cfg.domain.agents), 'bob');
  assert.equal(reviewerFor('bob', cfg.domain.agents), 'alice');
  assert.equal(reviewerFor('carol', cfg.domain.agents), 'alice');
});

test('a plugin may declare guardrailCheck:null — distinct from a plugin that sets a real runner', () => {
  const cfg = resolvePaths({ domain: { ...FAKE, guardrailCheck: null } });
  assert.equal(cfg.domain.guardrailCheck, null);
});

test('the plugin does NOT change paths — paths remain infra, unaffected by domain', () => {
  const cfg = resolvePaths({ domain: FAKE });
  assert.equal(cfg.boardMd, join(EXPECTED_REPO_ROOT, '.ai', 'board.md'));
  assert.equal(cfg.repoRoot, EXPECTED_REPO_ROOT);
  assert.equal(cfg.boardJson, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'board.json'));
  assert.equal(cfg.policyPath, join(EXPECTED_REPO_ROOT, '.ai', 'policy.yaml'));
});

// --- 2.2b: boardTitle / riskToAction / knownRiskTags flow through a non-default plugin ---

test('resolvePaths resolves boardTitle/riskToAction/knownRiskTags from an injected plugin', () => {
  const cfg = resolvePaths({
    domain: { boardTitle: 'Fake Board', riskToAction: { crypto: 'spend_money' }, knownRiskTags: ['crypto'] },
  });
  assert.equal(cfg.domain.boardTitle, 'Fake Board');
  assert.deepEqual(cfg.domain.riskToAction, { crypto: 'spend_money' });
  assert.deepEqual(cfg.domain.knownRiskTags, ['crypto']);
});

test('an omitted boardTitle/riskToAction/knownRiskTags resolves to undefined — no baked default to fall back to', () => {
  // ★③.2 Part B: core has no default tenant, so resolveDomain does NOT field-merge onto a hidden
  // PV_DOMAIN anymore — a field the plugin doesn't set simply resolves to undefined.
  const cfg = resolvePaths({ domain: FAKE }); // FAKE sets agents/prompts/guardrailCheck only
  assert.equal(cfg.domain.boardTitle, undefined);
  assert.equal(cfg.domain.riskToAction, undefined);
  assert.equal(cfg.domain.knownRiskTags, undefined);
});

test('a fake boardTitle renders as the H1 of buildBoardMd (injected explicitly, no ambient default)', () => {
  const boardJson = { tasks: [], milestones: [], founder_actions: [] };
  const md = buildBoardMd(boardJson, 'Fake Tenant Board — Acme', config);
  assert.match(md, /^# Fake Tenant Board — Acme/);
});

test('a fake riskToAction makes sensitiveBlock/sensitiveBlocks hard-stop on its own tag and ignore unknown tags', () => {
  const policy = { sensitive_actions: { spend_money: 'block_and_ask' } };
  const fakeRiskToAction = { crypto: 'spend_money' };

  // `crypto` is in the fake map and mapped to a block_and_ask action → hard-stop.
  assert.equal(sensitiveBlock(policy, ['crypto'], fakeRiskToAction), 'spend_money');
  assert.deepEqual(sensitiveBlocks(policy, ['crypto'], fakeRiskToAction), ['spend_money']);

  // `payments` is a FIXTURE_DOMAIN tag but is NOT in the fake map → ignored (not a hard-stop under this plugin).
  assert.equal(sensitiveBlock(policy, ['payments'], fakeRiskToAction), null);
  assert.deepEqual(sensitiveBlocks(policy, ['payments'], fakeRiskToAction), []);
});

test('a fake knownRiskTags makes checkInvariants reject a tag outside it and accept one inside it', () => {
  const fakeKnownRiskTags = ['crypto'];
  const okBoard = { tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['crypto'] }] };
  const badBoard = { tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['payments'] }] };

  assert.equal(checkInvariants(okBoard, fakeKnownRiskTags).length, 0);
  assert.ok(checkInvariants(badBoard, fakeKnownRiskTags).some((p) => /unknown risk_tag 'payments'/.test(p)));
  // Sanity: `payments` is fine under FIXTURE_DOMAIN's OWN taxonomy (the module-level `config`
  // above) — proves the fake taxonomy above, not some universally-stricter check, is what
  // rejected it.
  assert.equal(checkInvariants(badBoard, undefined, config).length, 0, "sanity: FIXTURE_DOMAIN's own taxonomy accepts payments when not injected");
});
