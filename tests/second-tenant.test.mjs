/**
 * The "2nd-tenant proof" (★②, REPO-AUDIT.md carve-out plan): prove the COMPOSED AIOS core — the
 * same render/validate/planner/verifier/config modules any tenant runs in production — behaves as
 * a DIFFERENT, fully non-default product when driven by a swapped-in DomainPlugin, with ZERO core
 * code changes. This file is additive only; it does not alter any existing module's behavior.
 *
 * There is no ambient singleton (DI-3c), and — as of ★③.2 Part B — no default tenant either.
 * Every core module takes `config` as a REQUIRED, explicitly-injected parameter. So the "tenant
 * swap" here is simply: construct TWO independent configs via `resolvePaths({domain: ...})` — the
 * neutral test fixture (`FIXTURE_DOMAIN`, tenant #1) and a fully separate "Acme Robotics" plugin
 * (tenant #2) — and pass whichever one a given call needs. `node --test` runs each test FILE in
 * its own process, and there is nothing global to leak between tests within this file either —
 * each test just uses its own local config value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { seedTasks, getTask } from '../state.mjs';
import { buildBoardJson, buildBoardMd } from '../render.mjs';
import { checkInvariants } from '../validate.mjs';
import { plannerCycle } from '../planner.mjs';
import { createCheckRunners } from '../verifier.mjs';
import { buildStatus } from '../status.mjs';
import { runnerStatus } from '../runner.mjs';
import { resolvePaths, reviewerFor } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const T0 = '2026-07-12T00:00:00.000Z';
const TENANT1 = resolvePaths({ domain: FIXTURE_DOMAIN }); // tenant #1, for byte-identical sanity checks below

// A fully NON-default DomainPlugin — "Acme Robotics" (tenant #2) — with its own roster, prose,
// guardrail posture, board title, risk-to-action map, and risk taxonomy. None of these values
// overlap with FIXTURE_DOMAIN, so any test that passes could only be passing because the injected
// plugin, not some other tenant's defaults, drove the result.
const ACME = resolvePaths({
  domain: {
    agents: ['dev', 'qa', 'lead'],
    prompts: { implRules: ['- Follow the Acme handbook'], reviewCriteria: ['- Firmware safety'] },
    guardrailCheck: null, // Acme has no content guardrail
    boardTitle: 'Acme Robotics — Delivery Board',
    riskToAction: { crypto: 'spend_money', firmware_ota: 'deploy' }, // Acme's OWN risk map
    knownRiskTags: ['crypto', 'firmware_ota', 'ui', 'docs'], // Acme's OWN taxonomy
  },
});

// ─── 1. Render: the H1 and task titles come from the ACTIVE plugin, not another tenant's ───────

test('render: an Acme board renders the Acme H1 and an Acme story title (proves config injection)', () => {
  const board = {
    sprints: [{ id: 'ACME-S1', name: 'Sprint 1', status: 'active' }],
    tasks: [
      {
        id: 'ACME-1', type: 'story', sprint_id: 'ACME-S1', title: 'Ship firmware OTA pipeline',
        owner: 'dev', status: 'ready-for-impl', priority: 10, risk_tags: ['crypto'],
        created_at: T0, updated_at: T0,
      },
      {
        id: 'ACME-2', type: 'feature', title: 'Robot arm calibration rig', owner: 'qa',
        status: 'designing', priority: 20, created_at: T0, updated_at: T0,
      },
    ],
  };
  const db = openDb(':memory:', ACME);
  seedTasks(db, board);
  // buildBoardMd's boardTitle defaults to `config.domain.boardTitle` — the explicit ACME config
  // passed here, not tenant #1's — so this only renders "Acme Robotics" because of the injected
  // config. A stock tenant-#1 AIOS would render "Test Board" instead.
  const md = buildBoardMd(buildBoardJson(db), undefined, ACME);
  assert.match(md, /^# Acme Robotics — Delivery Board/);
  assert.match(md, /Ship firmware OTA pipeline/, 'the Acme story title appears in the rendered board');
  assert.doesNotMatch(md, /Test Board/, 'no tenant-#1 string leaks into an Acme render');
  db.close();
});

// ─── 2. Validate/taxonomy: knownRiskTags comes from the ACTIVE plugin, not another tenant's ────

test('validate: Acme knownRiskTags governs checkInvariants, not tenant #1\'s taxonomy', () => {
  // `crypto` is in Acme's OWN taxonomy → accepted.
  const okBoard = { tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['crypto'] }] };
  assert.equal(checkInvariants(okBoard, undefined, ACME).length, 0, 'crypto is legal under Acme\'s taxonomy');

  // `budget` is a tenant-#1 (FIXTURE_DOMAIN) risk tag that is NOT in Acme's taxonomy → rejected.
  const badBoard = { tasks: [{ id: 'X', status: 'done', priority: 1, risk_tags: ['budget'] }] };
  const problems = checkInvariants(badBoard, undefined, ACME);
  assert.ok(problems.some((p) => /unknown risk_tag 'budget'/.test(p)), 'a tenant-#1-only tag is unknown to Acme');

  // Sanity (same board, tenant #1 config instead): `budget` is fine under tenant #1's own taxonomy
  // — proves it was Acme's taxonomy that rejected it above, not some universal rule.
  assert.equal(checkInvariants(badBoard, undefined, TENANT1).length, 0, 'sanity: tenant #1 config accepts budget');
});

// ─── 3. Governance: the §6 hard-stop loop is driven ENTIRELY by the injected plugin ────────────

test('governance: plannerCycle hard-stops a crypto-tagged story under Acme\'s riskToAction, but the SAME board is unaffected under tenant #1\'s', () => {
  const seedBoard = {
    tasks: [
      {
        id: 'ACME-CRYPTO', type: 'story', title: 'Wallet integration', owner: 'dev',
        status: 'ready-for-impl', priority: 10, risk_tags: ['crypto'], created_at: T0, updated_at: T0,
      },
    ],
  };
  const policy = { sensitive_actions: { spend_money: 'block_and_ask' } };

  // Under Acme: crypto -> spend_money -> block_and_ask -> the planner parks it as a governance hold.
  {
    const db = openDb(':memory:', ACME);
    seedTasks(db, seedBoard);
    plannerCycle(db, { policy, config: ACME });
    const t = getTask(db, 'ACME-CRYPTO');
    assert.equal(t.status, 'blocked', 'Acme riskToAction maps crypto to a block_and_ask action');
    assert.match(t.note, /governance hold/);
    db.close();
  }

  // Under tenant #1's config: its riskToAction has no entry for "crypto" at all, so the SAME
  // task/policy combination is NOT touched by governance — proving the §6 loop is driven
  // entirely by the injected plugin, not some hardcoded tag list in the core module.
  {
    const db = openDb(':memory:', TENANT1);
    seedTasks(db, seedBoard);
    plannerCycle(db, { policy, config: TENANT1 });
    const t = getTask(db, 'ACME-CRYPTO');
    assert.equal(t.status, 'ready-for-impl', 'tenant #1 riskToAction does not know "crypto" -> no governance hold applies');
    db.close();
  }
});

// ─── 4. Routing/review: the reviewer roster comes from the ACTIVE plugin, not another tenant's ─

test('routing: reviewerFor picks from the Acme roster when the Acme config is active, never dev itself, never a tenant-#1 agent', () => {
  const reviewer = reviewerFor('dev', ACME.domain.agents);
  assert.equal(reviewer, 'qa', 'first Acme roster agent other than the writer');
  assert.notEqual(reviewer, 'dev');
  assert.ok(!FIXTURE_DOMAIN.agents.includes(reviewer), 'never a tenant-#1 agent');
});

// ─── 5. Guardrail runner: an honest `skip`, not a fail-open `pass`, when Acme declares none ────

test('guardrails: createCheckRunners honors Acme\'s guardrailCheck:null as an honest skip, not a silent pass', async () => {
  const runners = createCheckRunners(ACME.repoRoot, { config: ACME });
  const guardrailRunner = runners.find((r) => r.name === 'guardrails');
  assert.ok(guardrailRunner, 'a guardrails runner is always present');
  const result = await guardrailRunner.fn({});
  assert.equal(result.status, 'skip', 'Acme declared no guardrail check -> inapplicable, not a fail-open pass');
});

// ─── 6. Status/runner: agent-keyed shapes come from the ACTIVE plugin's roster (§1.4) ───────────
// Before this bite, status.mjs and runner.mjs assumed the roster was always exactly
// {claude, antigravity} (baked-in literals). These prove the dashboard/runner gating now key off
// config.domain.agents for an arbitrary, non-PV roster — Acme's {dev, qa, lead} — with no PV
// agent name appearing anywhere in the result.

test('status: buildStatus keys `agents` and `queue[].routing` off the Acme roster, never claude/antigravity', () => {
  const T = '2026-07-12T00:00:00.000Z';
  const db = openDb(':memory:', ACME);
  seedTasks(db, { tasks: [
    { id: 'ACME-Q1', title: 'sensor calib', owner: 'dev', status: 'ready-for-impl', priority: 10, created_at: T, updated_at: T },
  ] });
  const acmePolicy = { agent_models: { dev: { default: 'acme-dev-model' }, qa: { default: 'acme-qa-model' }, lead: { default: 'acme-lead-model' } } };
  const s = buildStatus({ db, config: ACME, policy: acmePolicy, now: Date.parse(T) });
  assert.deepEqual(Object.keys(s.agents), ['dev', 'qa', 'lead'], 'agents keyed by the Acme roster, in roster order');
  assert.equal(s.agents.dev.model, 'acme-dev-model');
  assert.ok(!('claude' in s.agents) && !('antigravity' in s.agents), 'no PV agent identity leaks into a non-PV tenant');
  const [task] = s.queue;
  assert.deepEqual(Object.keys(task.routing), ['dev', 'qa', 'lead'], 'per-task routing keyed by the Acme roster');
  db.close();
});

test('runner: budget_halt fires only when EVERY Acme roster agent is denied, not just two hardcoded names', () => {
  const acmePolicy = { schedule: { cadence: 'every_30m' }, quiet_hours: { enabled: false } };
  const partialDeny = { kill_switch: false, mayClaim: { dev: false, qa: true, lead: false } };
  assert.equal(runnerStatus({ config: ACME, policy: acmePolicy, budget: partialDeny, runs: [] }).holdReason, null, 'qa may still claim -> not a halt');
  const fullDeny = { kill_switch: false, mayClaim: { dev: false, qa: false, lead: false } };
  assert.equal(runnerStatus({ config: ACME, policy: acmePolicy, budget: fullDeny, runs: [] }).holdReason, 'budget_halt', 'every Acme roster agent denied -> halt');
});
