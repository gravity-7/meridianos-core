import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaths, createAios, reviewerFor } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// Independently computed expected repo root (three dirs up from tools/aios/tests/).
const EXPECTED_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Run `fn` with the given env vars set, always restoring the prior values afterward. */
function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// ---- domain is REQUIRED (★③.2 Part B: core has no default tenant) ----------------------------

test('resolvePaths() with no domain THROWS — there is no default tenant to fall back to', () => {
  assert.throws(() => resolvePaths(), /DomainPlugin is required/);
});

test('resolvePaths({domain: null}) THROWS the same clear error', () => {
  assert.throws(() => resolvePaths({ domain: null }), /DomainPlugin is required/);
});

test('createAios() with no domain THROWS — same requirement as resolvePaths()', () => {
  assert.throws(() => createAios(), /DomainPlugin is required/);
});

test('resolvePaths({domain: {}}) does NOT throw — an empty (but non-null) plugin is valid, just yields undefined fields', () => {
  const p = resolvePaths({ domain: {} });
  assert.equal(p.domain.boardTitle, undefined);
  assert.deepEqual(p.domain.agents, undefined);
});

test('resolvePaths() with an injected FIXTURE_DOMAIN matches today\'s literal repo-relative path defaults', () => {
  withEnv({ AIOS_ROOT: undefined, AIOS_DB: undefined }, () => {
    const p = resolvePaths({ domain: FIXTURE_DOMAIN });
    assert.equal(p.repoRoot, EXPECTED_REPO_ROOT);
    assert.equal(p.dbPath, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'aios.db'));
    assert.equal(p.defaultDbPath, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'aios.db'));
    assert.equal(p.boardJson, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'board.json'));
    assert.equal(p.boardMd, join(EXPECTED_REPO_ROOT, '.ai', 'board.md'));
    assert.equal(p.policyPath, join(EXPECTED_REPO_ROOT, '.ai', 'policy.yaml'));
    assert.equal(p.runsPath, join(EXPECTED_REPO_ROOT, '.ai', 'runs', 'log.jsonl'));
    assert.equal(p.inboxDir, join(EXPECTED_REPO_ROOT, '.ai', 'inbox'));
    assert.equal(p.feedbackDir, join(EXPECTED_REPO_ROOT, '.ai', 'feedback'));
    assert.equal(p.featuresDir, join(EXPECTED_REPO_ROOT, '.ai', 'features'));
    assert.equal(p.secretFile, join(EXPECTED_REPO_ROOT, '.ai', 'secrets', 'escalation-webhook'));
    assert.equal(p.worktreeRoot, join(EXPECTED_REPO_ROOT, '.ai', 'worktrees'));
    assert.equal(p.pricingPath, join(EXPECTED_REPO_ROOT, 'tools', 'aios', 'pricing.json'));
  });
});

test('createAios({domain: FIXTURE_DOMAIN}).config matches a plain resolvePaths({domain: FIXTURE_DOMAIN}) — same values, no singleton needed', () => {
  withEnv({ AIOS_ROOT: undefined, AIOS_DB: undefined }, () => {
    const p = resolvePaths({ domain: FIXTURE_DOMAIN });
    const { config } = createAios({ domain: FIXTURE_DOMAIN });
    assert.equal(config.repoRoot, p.repoRoot);
    assert.equal(config.boardJson, p.boardJson);
    assert.equal(config.boardMd, p.boardMd);
    assert.equal(config.policyPath, p.policyPath);
    assert.equal(config.pricingPath, p.pricingPath);
    assert.equal(config.worktreeRoot, p.worktreeRoot);
    assert.deepEqual(config.domain, p.domain);
  });
});

test('AIOS_WORKTREE_ROOT overrides worktreeRoot (multi-tenant isolation) without touching other paths', () => {
  const isolated = join(EXPECTED_REPO_ROOT, '.ai', 'worktrees-tenantX');
  withEnv({ AIOS_ROOT: undefined, AIOS_DB: undefined, AIOS_WORKTREE_ROOT: isolated }, () => {
    const p = resolvePaths({ domain: FIXTURE_DOMAIN });
    assert.equal(p.worktreeRoot, isolated, 'worktreeRoot honors AIOS_WORKTREE_ROOT');
    // every OTHER path is unchanged — the override is scoped to the worktree root only
    assert.equal(p.boardJson, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'board.json'));
    assert.equal(p.policyPath, join(EXPECTED_REPO_ROOT, '.ai', 'policy.yaml'));
  });
  // unset ⇒ back to the default inside-repo derivation
  withEnv({ AIOS_ROOT: undefined, AIOS_DB: undefined, AIOS_WORKTREE_ROOT: undefined }, () => {
    assert.equal(resolvePaths({ domain: FIXTURE_DOMAIN }).worktreeRoot, join(EXPECTED_REPO_ROOT, '.ai', 'worktrees'));
  });
});

test('AIOS_ROOT redirects every derived path under the new root', () => {
  const tmpRoot = join(EXPECTED_REPO_ROOT, '.tmp-aios-root-test');
  withEnv({ AIOS_ROOT: tmpRoot, AIOS_DB: undefined }, () => {
    const p = resolvePaths({ domain: FIXTURE_DOMAIN });
    assert.equal(p.repoRoot, tmpRoot);
    assert.equal(p.dbPath, join(tmpRoot, '.ai', 'state', 'aios.db'));
    assert.equal(p.defaultDbPath, join(tmpRoot, '.ai', 'state', 'aios.db'));
    assert.equal(p.boardJson, join(tmpRoot, '.ai', 'state', 'board.json'));
    assert.equal(p.boardMd, join(tmpRoot, '.ai', 'board.md'));
    assert.equal(p.policyPath, join(tmpRoot, '.ai', 'policy.yaml'));
    assert.equal(p.runsPath, join(tmpRoot, '.ai', 'runs', 'log.jsonl'));
    assert.equal(p.inboxDir, join(tmpRoot, '.ai', 'inbox'));
    assert.equal(p.feedbackDir, join(tmpRoot, '.ai', 'feedback'));
    assert.equal(p.featuresDir, join(tmpRoot, '.ai', 'features'));
    assert.equal(p.secretFile, join(tmpRoot, '.ai', 'secrets', 'escalation-webhook'));
    assert.equal(p.pricingPath, join(tmpRoot, 'tools', 'aios', 'pricing.json'));
    // worktreeRoot is inside the repo under `.ai/worktrees/` (gitignored) — self-isolating per tenant.
    assert.equal(p.worktreeRoot, join(tmpRoot, '.ai', 'worktrees'));
  });
});

test('an explicit {root} option overrides AIOS_ROOT and the computed default', () => {
  const explicitRoot = join(EXPECTED_REPO_ROOT, '.tmp-explicit-root-test');
  withEnv({ AIOS_ROOT: join(EXPECTED_REPO_ROOT, '.tmp-env-root-test'), AIOS_DB: undefined }, () => {
    const p = resolvePaths({ root: explicitRoot, domain: FIXTURE_DOMAIN });
    assert.equal(p.repoRoot, explicitRoot);
    assert.equal(p.boardJson, join(explicitRoot, '.ai', 'state', 'board.json'));
  });
});

test('AIOS_DB overrides just the DB path, leaving every other path at its repo-root default', () => {
  const customDb = join(EXPECTED_REPO_ROOT, '.tmp-custom.db');
  withEnv({ AIOS_ROOT: undefined, AIOS_DB: customDb }, () => {
    const p = resolvePaths({ domain: FIXTURE_DOMAIN });
    assert.equal(p.dbPath, customDb);
    // defaultDbPath is the literal repo-relative default, unaffected by the AIOS_DB override —
    // this is what launcher/worktree wire into a spawned agent's env as the CANONICAL db path.
    assert.equal(p.defaultDbPath, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'aios.db'));
    assert.equal(p.repoRoot, EXPECTED_REPO_ROOT);
    assert.equal(p.boardJson, join(EXPECTED_REPO_ROOT, '.ai', 'state', 'board.json'));
  });
});

test('AIOS_DB is read live — changing it between two reads of the same resolved paths object changes dbPath', () => {
  withEnv({ AIOS_ROOT: undefined, AIOS_DB: undefined }, () => {
    const p = resolvePaths({ domain: FIXTURE_DOMAIN });
    const before = p.dbPath;
    process.env.AIOS_DB = join(EXPECTED_REPO_ROOT, '.tmp-live.db');
    try {
      assert.notEqual(p.dbPath, before);
      assert.equal(p.dbPath, process.env.AIOS_DB);
    } finally {
      delete process.env.AIOS_DB;
    }
  });
});

// ---- agent roster (2.1b) --------------------------------------------------------------------
// $AIOS_AGENTS overrides ONLY apply when the injected plugin itself omits `agents` — see
// agent-roster-env.test.mjs for the full env-override behavior. Here we just confirm an explicit
// plugin roster passes through untouched.

test('resolvePaths({domain}) resolves the roster from the injected plugin', () => {
  withEnv({ AIOS_AGENTS: undefined }, () => {
    assert.deepEqual(resolvePaths({ domain: FIXTURE_DOMAIN }).domain.agents, FIXTURE_DOMAIN.agents);
  });
});

test('createAios({domain}).config has the same resolved roster as resolvePaths({domain})', () => {
  withEnv({ AIOS_AGENTS: undefined }, () => {
    assert.deepEqual(createAios({ domain: FIXTURE_DOMAIN }).config.domain.agents, FIXTURE_DOMAIN.agents);
  });
});

test('an explicit {domain:{agents}} option wins over AIOS_AGENTS', () => {
  withEnv({ AIOS_AGENTS: 'env-x,env-y,env-z' }, () => {
    assert.deepEqual(resolvePaths({ domain: { agents: ['solo'] } }).domain.agents, ['solo']);
  });
});

test('reviewerFor returns the other agent for a 2-agent roster (binary swap)', () => {
  assert.equal(reviewerFor('agent-a', ['agent-a', 'agent-b']), 'agent-b');
  assert.equal(reviewerFor('agent-b', ['agent-a', 'agent-b']), 'agent-a');
});

test('reviewerFor picks a different agent for an N=3 roster', () => {
  const roster = ['agent-a', 'agent-b', 'agent-c'];
  assert.equal(reviewerFor('agent-a', roster), 'agent-b');
  assert.equal(reviewerFor('agent-b', roster), 'agent-a');
  assert.equal(reviewerFor('agent-c', roster), 'agent-a');
});

test('reviewerFor requires an explicit roster — there is no ambient default to fall back to', () => {
  const roster = resolvePaths({ domain: FIXTURE_DOMAIN }).domain.agents; // caller supplies it explicitly, e.g. from config
  assert.equal(reviewerFor('agent-a', roster), 'agent-b');
});

test('reviewerFor is null/undefined-safe', () => {
  assert.equal(reviewerFor('agent-a', null), undefined);
  assert.equal(reviewerFor('agent-a', undefined), undefined);
  assert.equal(reviewerFor(undefined, ['agent-a', 'agent-b']), 'agent-a');
  assert.equal(reviewerFor(null, []), undefined);
});

// ---- domain prompt prose (2.1c) --------------------------------------------------------------

test('resolvePaths({domain}) resolves prompts from the injected plugin verbatim', () => {
  const p = resolvePaths({ domain: FIXTURE_DOMAIN });
  assert.deepEqual(p.domain.prompts.implRules, FIXTURE_DOMAIN.prompts.implRules);
  assert.deepEqual(p.domain.prompts.reviewCriteria, FIXTURE_DOMAIN.prompts.reviewCriteria);
});

test('an explicit {domain:{prompts}} option is honored — no env var for multi-line prose', () => {
  const custom = { implRules: ['- Custom rule'], reviewCriteria: ['- Custom criterion'] };
  const p = resolvePaths({ domain: { prompts: custom } });
  assert.deepEqual(p.domain.prompts.implRules, ['- Custom rule']);
  assert.deepEqual(p.domain.prompts.reviewCriteria, ['- Custom criterion']);
});

// ---- cliPath (configurable tenant runner CLI) -------------------------------------------------

test('resolvePaths({domain}) defaults domain.cliPath to \'tools/aios/cli.mjs\' when the plugin omits it', () => {
  assert.equal(resolvePaths({ domain: FIXTURE_DOMAIN }).domain.cliPath, 'tools/aios/cli.mjs');
});

test('an explicit {domain:{cliPath}} option overrides the default', () => {
  const p = resolvePaths({ domain: { ...FIXTURE_DOMAIN, cliPath: '/abs/dev-runner/cli.mjs' } });
  assert.equal(p.domain.cliPath, '/abs/dev-runner/cli.mjs');
});

// ---- guardrail check-runner (2.1d) ------------------------------------------------------------

test('resolvePaths({domain}) resolves guardrailCheck from the injected plugin verbatim', () => {
  const custom = { cmd: 'node', script: 'scripts/check.mjs' };
  assert.deepEqual(resolvePaths({ domain: { ...FIXTURE_DOMAIN, guardrailCheck: custom } }).domain.guardrailCheck, custom);
});

test('an explicit {domain:{guardrailCheck: null}} declares "no guardrail check" — distinct from a real runner', () => {
  assert.equal(resolvePaths({ domain: FIXTURE_DOMAIN }).domain.guardrailCheck, null, 'FIXTURE_DOMAIN itself declares no check');
  const withCheck = resolvePaths({ domain: { ...FIXTURE_DOMAIN, guardrailCheck: { cmd: 'node', script: 'x.mjs' } } });
  assert.notEqual(withCheck.domain.guardrailCheck, null);
});
