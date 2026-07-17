/**
 * domain-record.test — card C2 (DomainPlugin-as-data). Covers validateDomainRecord's contract
 * checks and loadDomainRecord's compilation into a DomainPlugin `createAios({domain})` accepts,
 * mirroring the "inject a non-default plugin, prove core honors it" style of
 * tests/domain-plugin.test.mjs and tests/second-tenant.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDomainRecord, loadDomainRecord, compileGuardrailCheck } from '../domain-record.mjs';
import { createAios } from '../config.mjs';

// A minimal valid record — exactly the three required top-level fields.
const MINIMAL = {
  name: 'Minimal Co',
  roster: ['solo'],
  modelRouting: { solo: { medium: 'solo-medium-model' } },
};

// ---- AC1: minimal valid record validates clean --------------------------------------------

test('AC1: a minimal valid record (name, roster, modelRouting) validates ok with no errors', () => {
  const result = validateDomainRecord(MINIMAL);
  assert.deepEqual(result, { ok: true, errors: [] });
});

// ---- AC2: a record missing roster fails, naming the field ---------------------------------

test('AC2: a record missing roster is rejected, with an error naming "roster"', () => {
  const { name, modelRouting } = MINIMAL;
  const result = validateDomainRecord({ name, modelRouting });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('roster:')), `expected an error naming "roster", got: ${JSON.stringify(result.errors)}`);
});

// ---- more validation coverage (not AC-numbered, but cheap and worth having) ----------------

test('validateDomainRecord rejects a missing name and a missing modelRouting the same way', () => {
  const noName = validateDomainRecord({ roster: ['a'], modelRouting: { a: { medium: 'x' } } });
  assert.equal(noName.ok, false);
  assert.ok(noName.errors.some((e) => e.startsWith('name:')));

  const noRouting = validateDomainRecord({ name: 'X', roster: ['a'] });
  assert.equal(noRouting.ok, false);
  assert.ok(noRouting.errors.some((e) => e.startsWith('modelRouting:')));
});

test('validateDomainRecord rejects an empty roster array and a duplicate agent name', () => {
  const empty = validateDomainRecord({ ...MINIMAL, roster: [] });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((e) => e.startsWith('roster:')));

  const dup = validateDomainRecord({ ...MINIMAL, roster: ['solo', 'solo'] });
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((e) => /duplicate agent name/.test(e)));
});

test('validateDomainRecord rejects an unknown modelRouting tier and a non-string model id', () => {
  const badTier = validateDomainRecord({ ...MINIMAL, modelRouting: { solo: { legendary: 'x' } } });
  assert.equal(badTier.ok, false);
  assert.ok(badTier.errors.some((e) => /unknown tier/.test(e)));

  const badModel = validateDomainRecord({ ...MINIMAL, modelRouting: { solo: { medium: 42 } } });
  assert.equal(badModel.ok, false);
  assert.ok(badModel.errors.some((e) => e.startsWith('modelRouting.solo.medium:')));
});

test('validateDomainRecord rejects an unknown guardrails flag and a non-boolean value', () => {
  const unknownFlag = validateDomainRecord({ ...MINIMAL, guardrails: { bogus: true } });
  assert.equal(unknownFlag.ok, false);
  assert.ok(unknownFlag.errors.some((e) => /unknown flag/.test(e)));

  const notBool = validateDomainRecord({ ...MINIMAL, guardrails: { tone: 'yes' } });
  assert.equal(notBool.ok, false);
  assert.ok(notBool.errors.some((e) => e.startsWith('guardrails.tone:')));
});

test('validateDomainRecord accepts every optional field when well-formed', () => {
  const full = {
    ...MINIMAL,
    sources: [{ type: 'filesystem-inbox' }],
    guardrails: { tone: true, currency: true, secrets: true },
    budget: { solo: 'protobuf' },
    boardTitle: 'Minimal Board',
    riskTags: { deploy: 'deploy' },
    taskCategories: { ops: { tier: 'complex', desc: 'Ops work', tags: ['deploy'] } },
    mcpServers: [{ name: 'github', command: 'npx', args: ['-y', 'gh-mcp'] }],
    cliPath: '/abs/cli.mjs',
  };
  assert.deepEqual(validateDomainRecord(full), { ok: true, errors: [] });
});

// ---- AC3: guardrails flags compile into a real enforcing/skipping function ------------------

test('AC3: guardrails:{tone:true,currency:false,secrets:true} enforces tone+secrets and skips currency', () => {
  const plugin = loadDomainRecord({ ...MINIMAL, guardrails: { tone: true, currency: false, secrets: true } });
  assert.equal(typeof plugin.guardrailCheck, 'function');

  // Contains a tone violation, a secret-shaped literal, AND a currency literal.
  const dirty = 'You are stupid. token: "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ01234" costs $1,200 today.';
  const result = plugin.guardrailCheck(dirty);
  assert.equal(result.status, 'fail');
  const flags = result.violations.map((v) => v.flag);
  assert.ok(flags.includes('tone'), 'tone flag enforced');
  assert.ok(flags.includes('secrets'), 'secrets flag enforced');
  assert.ok(!flags.includes('currency'), 'currency flag was OFF in the record — never flagged, even though the text has a $ literal');

  // Clean text (no tone/secret hits) still trips nothing.
  const clean = plugin.guardrailCheck('Ship the payments feature by Friday, no drama.');
  assert.equal(clean.status, 'pass');
  assert.deepEqual(clean.violations, []);
});

test('a record with no guardrails flags set (or all false) compiles guardrailCheck to null — "no check", not a no-op function', () => {
  assert.equal(loadDomainRecord(MINIMAL).guardrailCheck, null);
  assert.equal(loadDomainRecord({ ...MINIMAL, guardrails: { tone: false, currency: false, secrets: false } }).guardrailCheck, null);
});

test('compileGuardrailCheck memoizes by exact flag combination (same flags -> same function reference)', () => {
  const a = compileGuardrailCheck({ tone: true, currency: false, secrets: false });
  const b = compileGuardrailCheck({ tone: true, currency: false, secrets: false });
  assert.equal(a, b, 'identical flag combinations compile to the SAME function reference');
  const c = compileGuardrailCheck({ tone: true, currency: true, secrets: false });
  assert.notEqual(a, c, 'a different flag combination compiles to a different function');
});

// ---- AC4: createAios({domain: loadDomainRecord(...)}) succeeds and matches the record --------

test('AC4: createAios({domain: loadDomainRecord(validRecord)}) succeeds; roster/title/models match the record', () => {
  const record = {
    name: 'Acme Co',
    roster: ['dev', 'qa'],
    modelRouting: {
      dev: { simple: 'dev-simple', medium: 'dev-medium', harness: 'claude-code' },
      qa: { medium: 'qa-medium', complex: 'qa-complex' },
    },
    boardTitle: 'Acme Delivery Board',
  };
  const plugin = loadDomainRecord(record);
  const { config } = createAios({ domain: plugin });

  assert.deepEqual(config.domain.agents, ['dev', 'qa'], 'roster flows through to domain.agents');
  assert.equal(config.domain.boardTitle, 'Acme Delivery Board', 'boardTitle flows through');
  assert.deepEqual(config.domain.defaultModels, {
    dev: { simple: 'dev-simple', medium: 'dev-medium' },
    qa: { medium: 'qa-medium', complex: 'qa-complex' },
  }, 'per-agent tier models flow through to defaultModels (harness stripped out)');
  assert.deepEqual(config.domain.agentHarness, { dev: 'claude-code' }, 'per-agent harness collected separately, only for agents that set one');
});

// ---- AC5 is verified by running the EXISTING config.mjs test file unmodified (see PR body) ---
// (No test here — AC5 is "existing tests stay green", proven by `node --test tests/config.test.mjs`
// passing exactly as it did before this bite, since config.mjs is untouched.)

// ---- AC6: a YAML record and the equivalent JSON record load to a deep-equal plugin -----------

test('AC6: a YAML record and the equivalent JSON record load to a deep-equal compiled plugin', () => {
  const record = {
    name: 'Acme YAML Co',
    roster: ['dev', 'qa'],
    modelRouting: {
      dev: { simple: 'model-a-simple', medium: 'model-a-medium', harness: 'claude-code' },
      qa: { simple: 'model-b-simple', complex: 'model-b-complex' },
    },
    guardrails: { tone: true, currency: false, secrets: true },
    budget: { dev: 'transcript', qa: 'protobuf' },
    boardTitle: 'Acme YAML Board',
    riskTags: { payments: 'spend_money', deploy: 'deploy' },
    taskCategories: { 'money-math': { tier: 'complex', desc: 'Financial calcs', tags: ['payments', 'money-math'] } },
    cliPath: 'tools/acme/cli.mjs',
  };

  // yaml-lite.mjs supports nested block mappings + inline flow arrays of scalars, but NOT block
  // sequences of mappings — so this fixture deliberately sticks to fields expressible that way
  // (no `sources`/`mcpServers`, which are arrays of objects; see schema/domain-record.schema.json's
  // note on mcpServers).
  const yamlText = `
name: Acme YAML Co
roster: [dev, qa]
modelRouting:
  dev:
    simple: model-a-simple
    medium: model-a-medium
    harness: claude-code
  qa:
    simple: model-b-simple
    complex: model-b-complex
guardrails:
  tone: true
  currency: false
  secrets: true
budget:
  dev: transcript
  qa: protobuf
boardTitle: Acme YAML Board
riskTags:
  payments: spend_money
  deploy: deploy
taskCategories:
  money-math:
    tier: complex
    desc: Financial calcs
    tags: [payments, money-math]
cliPath: tools/acme/cli.mjs
`;

  const dir = mkdtempSync(join(tmpdir(), 'aios-domain-record-'));
  const yamlPath = join(dir, 'domain.yaml');
  const jsonPath = join(dir, 'domain.json');
  writeFileSync(yamlPath, yamlText, 'utf8');
  writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');

  const fromYaml = loadDomainRecord(yamlPath);
  const fromJson = loadDomainRecord(jsonPath);
  assert.deepEqual(fromYaml, fromJson, 'YAML- and JSON-loaded records compile to the identical plugin (including the SAME memoized guardrailCheck function reference)');

  // Sanity: also matches loading the plain object directly (no file round-trip at all).
  const fromObject = loadDomainRecord(record);
  assert.deepEqual(fromYaml, fromObject);
});

// ---- loadDomainRecord error path -------------------------------------------------------------

test('loadDomainRecord throws on an invalid record, with every validation error in the message', () => {
  assert.throws(
    () => loadDomainRecord({ name: 'Bad' }),
    (err) => err instanceof Error && /roster/.test(err.message) && /modelRouting/.test(err.message),
  );
});

test('loadDomainRecord rejects an unsupported file extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aios-domain-record-ext-'));
  const badPath = join(dir, 'domain.txt');
  writeFileSync(badPath, 'name: X', 'utf8');
  assert.throws(() => loadDomainRecord(badPath), /unsupported file extension/);
});
