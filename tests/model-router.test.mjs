import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, TASK_CATEGORIES,
  inferCategory, complexityTier, routeModel, categoryIndex, roleForStatus,
} from '../model-router.mjs';
import { openDb } from '../db.mjs';
import { upsertTask, getTask, listTasks } from '../state.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const DEFAULT_MODELS = FIXTURE_DOMAIN.defaultModels;

// ─── Tier ordering ─────────────────────────────────────────────────────────

test('TIERS are ordered from cheapest to most expensive', () => {
  assert.deepEqual(TIERS, ['simple', 'medium', 'medium_high', 'complex', 'critical']);
});

// ─── Category taxonomy ─────────────────────────────────────────────────────

test('every category has a valid tier', () => {
  for (const [name, def] of Object.entries(TASK_CATEGORIES)) {
    assert.ok(TIERS.includes(def.tier), `${name} has invalid tier: ${def.tier}`);
    assert.ok(typeof def.desc === 'string' && def.desc.length > 0, `${name} needs a description`);
  }
});

test('category tiers cover all five levels', () => {
  const found = new Set(Object.values(TASK_CATEGORIES).map(d => d.tier));
  for (const tier of TIERS) {
    assert.ok(found.has(tier), `no category found for tier: ${tier}`);
  }
});

// ─── inferCategory ─────────────────────────────────────────────────────────

test('inferCategory maps auth tag to security', () => {
  assert.equal(inferCategory({ risk_tags: '["auth"]' }), 'security');
});

test('inferCategory maps money-math tag to money-math WITH the PV domain injected', () => {
  assert.equal(inferCategory({ risk_tags: '["money-math"]' }, FIXTURE_DOMAIN), 'money-math');
});

test('inferCategory maps ui tag to ui-component', () => {
  assert.equal(inferCategory({ risk_tags: '["ui"]' }), 'ui-component');
});

test('inferCategory picks highest-tier tag when multiple present', () => {
  const cat = inferCategory({ risk_tags: '["copy", "auth"]' });
  assert.equal(cat, 'security'); // complex > simple
});

test('inferCategory returns null for unknown tags', () => {
  assert.equal(inferCategory({ risk_tags: '["unknown"]' }), null);
});

test('inferCategory handles empty tags', () => {
  assert.equal(inferCategory({ risk_tags: '[]' }), null);
  assert.equal(inferCategory({}), null);
});

// ─── §1.4 full-polish genericization proof ─────────────────────────────────
// Core's own generic taxonomy has ZERO knowledge of PV's money-math/payments taxonomy — it only
// exists once a domain that defines it (e.g. PV_DOMAIN / FIXTURE_DOMAIN) is injected.

test('WITHOUT a domain, money-math is unknown to core (genericization proof)', () => {
  assert.equal(inferCategory({ risk_tags: '["money-math"]' }, undefined), null);
  assert.equal(inferCategory({ risk_tags: '["payments"]' }, undefined), null);
  assert.ok(!('money-math' in TASK_CATEGORIES), 'core TASK_CATEGORIES must not contain money-math');
});

test('WITH the PV domain injected, money-math tag still routes to the money-math/complex category', () => {
  assert.equal(inferCategory({ risk_tags: '["money-math"]' }, FIXTURE_DOMAIN), 'money-math');
  assert.equal(inferCategory({ risk_tags: '["payments"]' }, FIXTURE_DOMAIN), 'money-math');
  assert.equal(complexityTier({ complexity: 1, risk_tags: '["money-math"]' }, FIXTURE_DOMAIN), 'complex');
});

test('a domain with a DIFFERENT roster routes correctly via its own defaultModels/agentHarness', () => {
  const ZETA_DOMAIN = {
    agents: ['zeta'],
    defaultModels: {
      zeta: {
        simple: 'zeta-nano', medium: 'zeta-lite', medium_high: 'zeta-lite',
        complex: 'zeta-max', critical: 'zeta-ultra',
      },
    },
    agentHarness: { zeta: 'opencode' },
  };
  const zetaPolicy = { model_routing: { zeta: ZETA_DOMAIN.defaultModels.zeta } };

  const simple = routeModel('zeta', { complexity: 1, risk_tags: '[]' }, zetaPolicy, 'ok', ZETA_DOMAIN);
  assert.equal(simple.model, 'zeta-nano');
  assert.equal(simple.harness, 'opencode');

  const complex = routeModel('zeta', { complexity: 5, risk_tags: '[]' }, zetaPolicy, 'ok', ZETA_DOMAIN);
  assert.equal(complex.model, 'zeta-max');
  assert.equal(complex.harness, 'opencode');

  // zeta's roster/taxonomy stays fully isolated from PV's — no money-math awareness.
  assert.equal(inferCategory({ risk_tags: '["money-math"]' }, ZETA_DOMAIN), null);
});

// ─── complexityTier ────────────────────────────────────────────────────────

test('complexity=1 → simple', () => {
  assert.equal(complexityTier({ complexity: 1, risk_tags: '[]' }), 'simple');
});

test('complexity=3 → medium', () => {
  assert.equal(complexityTier({ complexity: 3, risk_tags: '[]' }), 'medium');
});

test('complexity=4 → medium_high', () => {
  assert.equal(complexityTier({ complexity: 4, risk_tags: '[]' }), 'medium_high');
});

test('complexity=5 → complex', () => {
  assert.equal(complexityTier({ complexity: 5, risk_tags: '[]' }), 'complex');
});

test('risk_tags can push tier higher than numeric complexity', () => {
  // complexity=1 (simple) but auth tag → security (complex) wins
  assert.equal(complexityTier({ complexity: 1, risk_tags: '["auth"]' }), 'complex');
});

test('numeric complexity can push tier higher than category', () => {
  // copy tag → simple, but complexity=5 → complex wins
  assert.equal(complexityTier({ complexity: 5, risk_tags: '["copy"]' }), 'complex');
});

test('explicit task_type is respected', () => {
  assert.equal(complexityTier({ complexity: 1, risk_tags: '[]', task_type: 'architecture' }), 'complex');
});

// ─── routeModel ────────────────────────────────────────────────────────────

const policy = {
  model_routing: {
    claude: DEFAULT_MODELS.claude,
    antigravity: DEFAULT_MODELS.antigravity,
  },
  agent_budget: { auto_downgrade_at_warn: true },
};

test('routes simple task to Haiku for claude', () => {
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'claude-haiku-4-5-20251001');
  assert.equal(r.tier, 'simple');
});

test('routes simple task to GPT-OSS for antigravity', () => {
  const r = routeModel('antigravity', { complexity: 1, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'gpt-oss-120b');
  assert.equal(r.tier, 'simple');
});

test('routes medium task to Sonnet 5 for claude', () => {
  const r = routeModel('claude', { complexity: 3, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'claude-sonnet-5');
  assert.equal(r.tier, 'medium');
});

test('routes medium task to Flash for antigravity', () => {
  const r = routeModel('antigravity', { complexity: 3, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'gemini-3.5-flash');
  assert.equal(r.tier, 'medium');
});

test('routes complex task (auth tag) to Opus 4.8 for claude', () => {
  const r = routeModel('claude', { complexity: 3, risk_tags: '["auth"]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'claude-opus-4-8');
  assert.equal(r.tier, 'complex');
});

test('routes complex task to Pro for antigravity', () => {
  const r = routeModel('antigravity', { complexity: 5, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'gemini-3-pro');
  assert.equal(r.tier, 'complex');
});

test('budget warn downgrades one tier', () => {
  const r = routeModel('claude', { complexity: 5, risk_tags: '[]' }, policy, 'warn', FIXTURE_DOMAIN);
  assert.equal(r.tier, 'medium_high'); // complex → medium_high
  assert.equal(r.baseTier, 'complex');
  assert.equal(r.model, 'claude-sonnet-5');
});

test('budget warn does not downgrade below simple', () => {
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]' }, policy, 'warn', FIXTURE_DOMAIN);
  assert.equal(r.tier, 'simple');
  assert.equal(r.model, 'claude-haiku-4-5-20251001');
});

test('routeModel includes reason string', () => {
  const r = routeModel('claude', { complexity: 3, risk_tags: '["copy"]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.ok(typeof r.reason === 'string');
  assert.ok(r.reason.length > 0);
});

test('routeModel with no model_routing in policy returns null model/provider/harness', () => {
  const r = routeModel('claude', { complexity: 3, risk_tags: '[]' }, {}, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, null);
  assert.equal(r.provider, null);
  assert.equal(r.harness, null);
  assert.match(r.reason, /not configured/);
});

// ─── provider + harness (1.4) ───────────────────────────────────────────────

test('legacy string routing resolves to native anthropic + the agent\'s own harness', () => {
  const rc = routeModel('claude', { complexity: 1, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(rc.provider, 'anthropic');
  assert.equal(rc.harness, 'claude-code');
  const ra = routeModel('antigravity', { complexity: 1, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.equal(ra.provider, 'anthropic');
  assert.equal(ra.harness, 'antigravity');
});

test('object-form routing uses the named provider, explicit model, explicit harness', () => {
  const p = {
    model_routing: { claude: { simple: { provider: 'deepseek', model: 'deepseek-chat', harness: 'opencode' } } },
  };
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]' }, p, 'ok');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-chat');
  assert.equal(r.harness, 'opencode');
});

test('object-form routing defaults model via modelForTier when omitted', () => {
  const p = { model_routing: { claude: { simple: { provider: 'deepseek' } } } };
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]' }, p, 'ok');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-v4-flash'); // deepseek's own simple-tier model
});

test('object-form routing defaults harness: anthropic → claude-code, third-party → opencode', () => {
  const anthropicEntry = routeModel('claude', { complexity: 1, risk_tags: '[]' }, { model_routing: { claude: { simple: { provider: 'anthropic' } } } }, 'ok');
  assert.equal(anthropicEntry.harness, 'claude-code');
  const thirdParty = routeModel('claude', { complexity: 1, risk_tags: '[]' }, { model_routing: { claude: { simple: { provider: 'deepseek' } } } }, 'ok');
  assert.equal(thirdParty.harness, 'opencode');
});

test('object-form routing throws on an unknown provider name', () => {
  const p = { model_routing: { claude: { simple: { provider: 'not-a-real-provider' } } } };
  assert.throws(() => routeModel('claude', { complexity: 1, risk_tags: '[]' }, p, 'ok'), /unknown provider/);
});

test('object-form routing throws when the resolved model is empty', () => {
  const p = {
    providers: { partial: { name: 'partial', baseUrl: 'https://x', wire: 'openai', keyEnv: null, models: { simple: '', medium: 'm', medium_high: 'm', complex: 'm', critical: 'm' } } },
    model_routing: { claude: { simple: { provider: 'partial' } } },
  };
  assert.throws(() => routeModel('claude', { complexity: 1, risk_tags: '[]' }, p, 'ok'), /no model/);
});

test('routeModel reason mentions the resolved provider', () => {
  const r = routeModel('claude', { complexity: 3, risk_tags: '["copy"]' }, policy, 'ok', FIXTURE_DOMAIN);
  assert.match(r.reason, /anthropic/);
});

// ─── categoryIndex ─────────────────────────────────────────────────────────

test('categoryIndex returns all tiers with categories', () => {
  const idx = categoryIndex();
  for (const tier of TIERS) {
    assert.ok(Array.isArray(idx[tier]), `${tier} should be an array`);
    assert.ok(idx[tier].length > 0, `${tier} should have categories`);
  }
});

test('categoryIndex merges domain.taskCategories over the generic defaults', () => {
  const withoutDomain = categoryIndex();
  assert.ok(!withoutDomain.complex.some(c => c.name === 'money-math'), 'money-math must not appear without a domain');

  const withDomain = categoryIndex(FIXTURE_DOMAIN);
  assert.ok(withDomain.complex.some(c => c.name === 'money-math'), 'money-math must appear once the PV domain is injected');
});

// ─── Real task routing ─────────────────────────────────────────────────────

test('route actual tasks from the board', () => {
  const tasks = [
    { id: 'F1-copy-prep', complexity: 1, risk_tags: '["copy"]', owner: 'antigravity' },
    { id: 'F1-1.3-auth', complexity: 4, risk_tags: '["auth"]', owner: 'claude' },
    { id: 'F1-1.4', complexity: 3, risk_tags: '[]', owner: 'antigravity' },
    { id: 'F2', complexity: 4, risk_tags: '["external","payments"]', owner: 'both' },
  ];

  const routes = tasks.map(t => ({
    id: t.id,
    claude: routeModel('claude', t, policy, 'ok', FIXTURE_DOMAIN),
    antigravity: routeModel('antigravity', t, policy, 'ok', FIXTURE_DOMAIN),
  }));

  // copy task (complexity=1) → simple for both agents
  assert.equal(routes[0].antigravity.tier, 'simple');
  assert.equal(routes[0].antigravity.model, 'gpt-oss-120b');

  // auth task → complex for claude (auth tag pushes to complex)
  assert.equal(routes[1].claude.tier, 'complex');
  assert.equal(routes[1].claude.model, 'claude-opus-4-8');

  // no tags, complexity 3 → medium
  assert.equal(routes[2].antigravity.tier, 'medium');

  // payments tag → money-math → complex
  assert.equal(routes[3].claude.tier, 'complex');
});

// ─── task_type persists through the DB round trip and drives routing ───────
// Regression test for the latent bug: the `tasks` table never had a task_type column, so
// every row read back from SQLite had task_type === undefined, and §11 category routing
// (constitution) silently never fired — complexityTier always fell back to the numeric
// complexity tier. schema.sql + db.mjs + state.mjs now persist the column; this proves the
// whole path — upsert → read back → route — actually carries task_type end to end.

test('task_type survives upsertTask → getTask round trip through real SQLite', () => {
  const db = openDb(':memory:');
  upsertTask(db, { id: 'T-a11y-1', title: 'Accessibility audit', task_type: 'a11y', complexity: 1, risk_tags: '[]' });

  const row = getTask(db, 'T-a11y-1');
  assert.equal(row.task_type, 'a11y', 'task_type must survive the INSERT + SELECT round trip');

  const listed = listTasks(db).find(t => t.id === 'T-a11y-1');
  assert.equal(listed.task_type, 'a11y', 'task_type must be present on listTasks() rows too');
});

test('an explicit task_type from the DB overrides the numeric-complexity tier in routing', () => {
  const db = openDb(':memory:');
  // complexity=1 alone maps to 'simple' (COMPLEXITY_TO_TIER[1]) — but task_type='a11y' is
  // TASK_CATEGORIES.a11y => tier 'medium_high', which must win (complexityTier takes the max).
  upsertTask(db, { id: 'T-a11y-2', title: 'Keyboard nav pass', task_type: 'a11y', complexity: 1, risk_tags: '[]' });
  const task = getTask(db, 'T-a11y-2');

  assert.equal(complexityTier(task), 'medium_high', 'explicit task_type must lift the tier above what complexity=1 alone would give');

  const routed = routeModel('claude', task, undefined, 'ok');
  assert.equal(routed.category, 'a11y', 'routeModel must report the category the task_type actually resolved to');
  assert.equal(routed.tier, 'medium_high');
});

test('a task with no task_type keeps falling back to inferCategory / numeric complexity (no regression)', () => {
  const db = openDb(':memory:');
  upsertTask(db, { id: 'T-plain-1', title: 'Plain task', complexity: 3, risk_tags: ['auth'] });
  const task = getTask(db, 'T-plain-1');

  assert.equal(task.task_type, null, 'task_type is nullable and defaults to null when not set');
  assert.equal(complexityTier(task), 'complex', 'falls back to inferCategory("auth") => security => complex');

  const routed = routeModel('claude', task, undefined, 'ok');
  assert.equal(routed.category, 'security');
});

// ─── roleForStatus ─────────────────────────────────────────────────────────

test('roleForStatus maps spec → spec', () => {
  assert.equal(roleForStatus('spec'), 'spec');
});

test('roleForStatus maps designing → design', () => {
  assert.equal(roleForStatus('designing'), 'design');
});

test('roleForStatus maps ready-for-impl → impl', () => {
  assert.equal(roleForStatus('ready-for-impl'), 'impl');
});

test('roleForStatus maps in-progress → impl', () => {
  assert.equal(roleForStatus('in-progress'), 'impl');
});

test('roleForStatus falls back to impl for unknown/null/undefined status', () => {
  assert.equal(roleForStatus('some-unknown-status'), 'impl');
  assert.equal(roleForStatus(null), 'impl');
  assert.equal(roleForStatus(undefined), 'impl');
});

// ─── stage/role axis routing (model_routing.<agent>.roles.<role>) ──────────

test('a roles.spec entry wins over the tier route for a status:"spec" task, regardless of complexity', () => {
  const p = {
    model_routing: {
      claude: {
        ...DEFAULT_MODELS.claude,
        roles: { spec: { provider: 'anthropic', model: 'claude-opus-4-8' } },
      },
    },
  };
  // complexity=1 would normally route to Haiku (simple tier) — the role route must override it.
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]', status: 'spec' }, p, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.model, 'claude-opus-4-8');
  assert.match(r.reason, /^role:spec/);
});

test('a roles.spec entry is ignored for a status:"ready-for-impl" task — falls through to the tier route', () => {
  const p = {
    model_routing: {
      claude: {
        ...DEFAULT_MODELS.claude,
        roles: { spec: { provider: 'anthropic', model: 'claude-opus-4-8' } },
      },
    },
  };
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]', status: 'ready-for-impl' }, p, 'ok', FIXTURE_DOMAIN);
  assert.equal(r.model, 'claude-haiku-4-5-20251001'); // ordinary simple-tier route, unaffected
  assert.equal(r.tier, 'simple');
  assert.ok(!r.reason.startsWith('role:'));
});

test('a policy with no roles block routes byte-identical to today for every stage (no regression)', () => {
  for (const status of ['spec', 'designing', 'ready-for-impl', 'in-progress', undefined, 'some-other-status']) {
    const withStatus = routeModel('claude', { complexity: 3, risk_tags: '[]', status }, policy, 'ok', FIXTURE_DOMAIN);
    const withoutStatus = routeModel('claude', { complexity: 3, risk_tags: '[]' }, policy, 'ok', FIXTURE_DOMAIN);
    assert.deepEqual(withStatus, withoutStatus, `status=${status} must route identically to no status when policy has no roles block`);
  }
});

test('bare-string role form names a PROVIDER (not a literal model id) — model resolves via modelForTier', () => {
  const p = { model_routing: { claude: { simple: { provider: 'anthropic' }, roles: { spec: 'deepseek' } } } };
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]', status: 'spec' }, p, 'ok');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-v4-flash'); // deepseek's own tier model, via modelForTier
  assert.match(r.reason, /^role:spec/);
});

test('object role form omitting model defaults it via modelForTier, same as a tier entry would', () => {
  const p = { model_routing: { claude: { simple: { provider: 'anthropic' }, roles: { spec: { provider: 'deepseek' } } } } };
  const r = routeModel('claude', { complexity: 1, risk_tags: '[]', status: 'spec' }, p, 'ok');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-v4-flash');
  assert.match(r.reason, /^role:spec/);
});

test('role route with an unknown provider throws, referencing the roles.<role> path', () => {
  const p = { model_routing: { claude: { roles: { spec: { provider: 'not-a-real-provider' } } } } };
  assert.throws(
    () => routeModel('claude', { complexity: 1, risk_tags: '[]', status: 'spec' }, p, 'ok'),
    /model_routing\.claude\.roles\.spec references unknown provider/,
  );
});

test('role route respects budget-warn downgrade for the model default, same as the tier route', () => {
  const p = {
    model_routing: { claude: { roles: { spec: { provider: 'deepseek' } } } },
    agent_budget: { auto_downgrade_at_warn: true },
  };
  const r = routeModel('claude', { complexity: 5, risk_tags: '[]', status: 'spec' }, p, 'warn', FIXTURE_DOMAIN);
  assert.equal(r.baseTier, 'complex');
  assert.equal(r.tier, 'medium_high'); // downgraded one tier from complex
  assert.equal(r.model, 'deepseek-v4-flash'); // deepseek's medium_high-tier model
  assert.match(r.reason, /^role:spec/);
  assert.match(r.reason, /downgraded to medium_high/);
});
