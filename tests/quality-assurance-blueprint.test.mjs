import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseYaml } from '../yaml-lite.mjs';
import { assertLoopbackEndpoint, createLoopbackFetch } from './fixtures/persona-network-guard.mjs';
import { isLiveCanaryReady, validateEvidenceManifest, validateLiveCanaryApproval } from './fixtures/evidence-contract.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const qaRoot = join(repoRoot, 'docs', 'quality-assurance');
const catalogPath = join(qaRoot, 'journey-catalog.yaml');
const REQUIRED_PERSONAS = [
  'individual_first_time', 'individual_experienced', 'organization_admin',
  'organization_operator', 'organization_viewer', 'integration_admin', 'desktop_admin',
];
const REQUIRED_DOMAINS = [
  'onboarding', 'projects-tasks', 'access-control', 'providers-models',
  'budget-safety', 'integrations', 'billing-licensing', 'deployment', 'desktop',
];
const REQUIRED_DEPENDENCY_VARIANTS = ['authorization-denied', 'success', 'timeout', 'unavailable', 'validation-error'];
const SECRET_LIKE_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|AIza[\w-]{20,}|ghp_[A-Za-z0-9]{20,})/;
const REQUIRED_ARTIFACTS = [
  ['safe-fixture-design.md', 'Fixture lifecycle'],
  ['evidence-and-release-model.md', 'Evidence classes and storage'],
  ['ai-test-agent-playbook.md', 'Prohibited default actions'],
  ['release-scorecard.md', 'Freshness and exceptions'],
  ['templates/triage-record.md', 'Regression check required'],
  ['templates/live-canary-approval.md', 'Approval statement'],
];

function readCatalog() {
  return parseYaml(readFileSync(catalogPath, 'utf8'));
}

function required(value, label) {
  assert.ok(typeof value === 'string' && value.trim(), `${label} must be a non-empty string`);
}

test('quality-assurance blueprint is a local, safe, complete source of truth', () => {
  const source = readFileSync(catalogPath, 'utf8');
  const catalog = readCatalog();
  const personas = Object.entries(catalog.personas ?? {});
  const fixtures = catalog.fixture_profiles ?? {};
  const journeys = Object.entries(catalog.journeys ?? {});

  const sourceJourneyIds = [...source.matchAll(/^  (JRN-\d{3}):\s*$/gm)].map((match) => match[1]);
  assert.ok(sourceJourneyIds.length >= 15, 'raw YAML must contain at least fifteen journey IDs');
  assert.equal(new Set(sourceJourneyIds).size, sourceJourneyIds.length, 'raw YAML journey IDs must be unique');
  assert.ok(personas.length >= 7, 'catalog must contain at least seven personas');
  assert.deepEqual(REQUIRED_PERSONAS.filter((id) => !catalog.personas[id]), [], 'catalog includes every required persona');
  assert.ok(Object.keys(fixtures).length >= 6, 'catalog must contain at least six fixture profiles');
  assert.ok(journeys.length >= 15, 'catalog must contain at least fifteen journeys');
  for (const [scenarioId, scenario] of Object.entries(catalog.dependency_scenarios ?? {})) {
    assert.deepEqual([...scenario.required_variants].sort(), REQUIRED_DEPENDENCY_VARIANTS, `${scenarioId} defines every controlled dependency behavior`);
  }
  assert.deepEqual(journeys.map(([id]) => id).filter((id) => !/^JRN-\d{3}$/.test(id)), [], 'journey IDs use stable JRN-NNN form');
  const coveredDomains = new Set();

  for (const [id, journey] of journeys) {
    for (const field of ['title', 'persona', 'user_goal', 'business_value', 'priority', 'risk_level', 'preconditions', 'fixture_profile', 'synthetic_data_needs', 'dependency_scenarios', 'numbered_actions', 'expected_outcomes', 'recovery_expectations', 'verification_method', 'truth_state', 'evidence_status', 'review_status', 'owner', 'domains']) {
      required(journey[field], `${id}.${field}`);
    }
    required(id, 'journey ID');
    assert.ok(fixtures[journey.fixture_profile], `${id} references a known fixture profile`);
    assert.ok(catalog.personas[journey.persona], `${id} references a known persona`);
    assert.match(journey.numbered_actions, /^1\s/, `${id} records replayable numbered actions`);
    for (const scenario of journey.dependency_scenarios.split(';').map((value) => value.trim())) {
      assert.ok(catalog.dependency_scenarios[scenario], `${id} references a known dependency scenario`);
    }
    if (journey.dependency_scenarios.split(';').map((value) => value.trim()).includes('provider')) {
      assert.equal(fixtures[journey.fixture_profile].ai_traffic_path, 'test-gateway -> loopback-provider', `${id} routes simulated AI traffic through the test gateway`);
    }
    for (const domain of journey.domains.split(';').map((value) => value.trim())) coveredDomains.add(domain);
  }
  assert.deepEqual(REQUIRED_DOMAINS.filter((domain) => !coveredDomains.has(domain)), [], 'catalog spans every required product domain');

  const p1Journeys = journeys.filter(([, journey]) => journey.priority === 'P1');
  assert.ok(p1Journeys.length >= 8, 'catalog must define the first eight P1 journeys');
  for (const [id, journey] of p1Journeys) {
    for (const field of ['owner', 'expected_outcomes', 'verification_lanes', 'browser_expectations', 'browser_desktop', 'browser_narrow', 'browser_keyboard', 'browser_recovery', 'evidence_status', 'runbook']) {
      required(journey[field], `${id}.${field}`);
    }
    const runbookPath = join(qaRoot, journey.runbook);
    assert.ok(existsSync(runbookPath), `${id} runbook exists`);
    const runbook = readFileSync(runbookPath, 'utf8');
    assert.match(runbook, new RegExp(`journey_id: ${id}`), `${id} runbook declares its matching ID`);
    assert.match(runbook, /Synthetic data: yes/i, `${id} runbook carries the synthetic-data label`);
    assert.doesNotMatch(runbook, SECRET_LIKE_PATTERN, `${id} runbook contains no secret-like value`);
    assert.doesNotMatch(runbook, /https?:\/\/|\b(?:localhost|127\.0\.0\.1|::1)\b/i, `${id} runbook contains no internal hostname or direct URL`);
    assert.match(runbook, /artifacts\/qa\/<run-id>\//, `${id} runbook points raw evidence only to the permitted internal placeholder`);
    for (const heading of ['Customer value', 'Preconditions', 'Visible steps', 'Recovery', 'Truth and claim boundaries', 'Evidence']) {
      assert.match(runbook, new RegExp(`## ${heading}`), `${id} runbook includes ${heading}`);
    }
    assert.match(runbook, /\| 1 \|/, `${id} runbook includes a numbered visible step`);
    assert.ok(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'MANUAL-CANARY', 'PHASE-2-PENDING'].includes(journey.evidence_status), `${id} uses an explicit release evidence status`);
    if (['PASS', 'MANUAL-CANARY'].includes(journey.evidence_status)) {
      required(journey.evidence_reference, `${id}.evidence_reference`);
      assert.match(journey.evidence_reference, /^artifacts\/qa\//, `${id} keeps release evidence in the approved artifact location`);
      const evidencePath = resolve(repoRoot, journey.evidence_reference);
      assert.ok(evidencePath.startsWith(resolve(repoRoot, 'artifacts', 'qa')), `${id} evidence path stays under artifacts/qa`);
      assert.ok(existsSync(evidencePath), `${id} evidence manifest exists`);
      const expectedCommit = process.env.GITHUB_SHA ?? process.env.QUALITY_ASSURANCE_COMMIT ?? null;
      const manifest = validateEvidenceManifest(JSON.parse(readFileSync(evidencePath, 'utf8')), { expectedCommit });
      assert.equal(manifest.journey_id, id, `${id} evidence manifest matches the catalog journey`);
      assert.equal(manifest.fixture_revision, fixtures[journey.fixture_profile].revision, `${id} evidence manifest matches the active fixture revision`);
    }
    if (journey.evidence_status === 'MANUAL-CANARY') {
      required(journey.live_canary_approval, `${id}.live_canary_approval`);
      assert.match(journey.live_canary_approval, /^artifacts\/qa\//, `${id} keeps canary approval in the approved artifact location`);
      const approvalPath = resolve(repoRoot, journey.live_canary_approval);
      assert.ok(approvalPath.startsWith(resolve(repoRoot, 'artifacts', 'qa')), `${id} approval path stays under artifacts/qa`);
      assert.ok(existsSync(approvalPath), `${id} canary approval exists`);
      validateLiveCanaryApproval(JSON.parse(readFileSync(approvalPath, 'utf8')), manifest);
    }
  }

  assert.doesNotMatch(source, SECRET_LIKE_PATTERN, 'catalog must not contain secret-like values');
  for (const endpoint of source.match(/https?:\/\/[^\s'"`]+/g) ?? []) assertLoopbackEndpoint(endpoint);
  for (const [relativePath, marker] of REQUIRED_ARTIFACTS) {
    const artifact = join(qaRoot, relativePath);
    assert.ok(existsSync(artifact), `${relativePath} exists`);
    assert.match(readFileSync(artifact, 'utf8'), new RegExp(marker), `${relativePath} contains its required safety contract`);
  }

  const scorecard = readFileSync(join(qaRoot, 'release-scorecard.md'), 'utf8');
  for (const [id, journey] of p1Journeys) {
    const rows = scorecard.split(/\r?\n/).filter((line) => line.startsWith(`| ${id} `));
    assert.equal(rows.length, 1, `${id} has exactly one release-scorecard row`);
    const cells = rows[0].split('|').map((cell) => cell.trim());
    required(cells[3], `${id} scorecard last execution`);
    required(cells[4], `${id} scorecard commit and fixture revision`);
    required(cells[5], `${id} scorecard evidence reference`);
    required(cells[6], `${id} scorecard freshness`);
    assert.equal(cells[7], journey.evidence_status, `${id} scorecard status matches the catalog`);
    assert.equal(cells[8], journey.owner, `${id} scorecard owner matches the catalog`);
    required(cells[9], `${id} scorecard next action`);
  }
});

test('fixture network guard permits only exact credential-free loopback endpoints', () => {
  for (const safeUrl of ['http://localhost:4317', 'http://127.0.0.1:4319/path', 'http://[::1]:4320']) {
    assert.doesNotThrow(() => assertLoopbackEndpoint(safeUrl));
  }
  for (const unsafeUrl of ['http://localhost.evil.example', 'http://localhost@evil.example', 'https://example.test', 'file:///tmp/provider']) {
    assert.throws(() => assertLoopbackEndpoint(unsafeUrl));
  }

  let receivedInit;
  const guardedFetch = createLoopbackFetch((_, init) => {
    receivedInit = init;
    return Promise.resolve({ ok: true });
  });
  guardedFetch('http://localhost:4317/health');
  assert.throws(() => guardedFetch('http://localhost.evil.example/health'));
  assert.deepEqual(guardedFetch.attempts.map((attempt) => attempt.allowed), [true, false]);
  assert.equal(guardedFetch.externalAttemptCount, 1);
  assert.equal(receivedInit.redirect, 'error', 'fixture requests reject automatic redirects');
});

test('evidence and live-canary contracts reject stale or incomplete release claims', () => {
  const now = Date.parse('2026-08-14T12:00:00Z');
  const manifest = {
    journey_id: 'JRN-001', fixture_revision: 'fresh-solo-r1', tested_commit: '0123456789ab',
    run_id: 'qa-20260814-001', completed_at: '2026-08-14T11:00:00Z',
    reviewer: 'qa-owner', retention_until: '2026-08-21T11:00:00Z',
    result: 'passed', dependency_mode: 'loopback-simulated',
  };
  assert.doesNotThrow(() => validateEvidenceManifest(manifest, { now, expectedCommit: '0123456789ab' }));
  assert.throws(() => validateEvidenceManifest({ ...manifest, completed_at: '2026-07-01T11:00:00Z' }, { now }));
  assert.throws(() => validateEvidenceManifest({ ...manifest, completed_at: '2026-08-14T13:00:00Z' }, { now }));
  assert.throws(() => validateEvidenceManifest(manifest, { now, expectedCommit: 'different-commit' }));
  const approval = {
    journey_id: 'JRN-001', run_id: 'qa-20260814-001', approver: 'release-owner', key_owner: 'local-key-owner',
    provider: 'deepseek', model: 'deepseek-v4-flash', scope: 'single test account provider check',
    max_spend_usd: '1.00', max_duration_minutes: '10', approved_at: '2026-08-14T10:30:00Z', expires_at: '2026-08-15T11:30:00Z',
    rollback: 'revoke test credential', stop_condition: 'stop on any non-test data or cost boundary breach',
    evidence_classification: 'LIVE-CANARY-RESTRICTED', key_revocation: 'local-key-owner revokes the key after the run',
  };
  assert.doesNotThrow(() => validateLiveCanaryApproval(approval, manifest, { now }));
  assert.equal(isLiveCanaryReady(approval, manifest, { now }), true);
  for (const field of ['approver', 'key_owner', 'provider', 'model', 'max_spend_usd', 'max_duration_minutes', 'stop_condition', 'rollback', 'evidence_classification', 'key_revocation']) {
    const incomplete = { ...approval };
    delete incomplete[field];
    assert.equal(isLiveCanaryReady(incomplete, manifest, { now }), false, `missing ${field} cannot mark a canary ready`);
  }
  assert.equal(isLiveCanaryReady({ ...approval, provider: 'zai', model: 'glm-4' }, manifest, { now }), false);
  assert.equal(isLiveCanaryReady(approval, { ...manifest, result: 'failed' }, { now }), false);
  assert.throws(() => validateLiveCanaryApproval({ ...approval, max_spend_usd: '-1.00' }, manifest, { now }));
  assert.throws(() => validateLiveCanaryApproval({ ...approval, journey_id: 'JRN-003' }, manifest, { now }));
  assert.throws(() => validateLiveCanaryApproval({ ...approval, run_id: 'other-run' }, manifest, { now }));
  assert.throws(() => validateLiveCanaryApproval({ ...approval, approved_at: '2026-08-14T12:30:00Z' }, manifest, { now }));
});
