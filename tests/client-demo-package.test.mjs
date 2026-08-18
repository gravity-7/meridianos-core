import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClientDemoFixture, DEMO_CHECKPOINTS } from './fixtures/client-demo-fixture.mjs';
import { runVisibleClientDemo } from '../scripts/run-visible-client-demo.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('client-demo route contract presents /setup, keeps /app/setup redirect-only, and excludes static cloud route', () => {
  const runbook = read('../docs/client-demo-presenter-runbook.md');
  const launcher = read('../scripts/run-visible-client-demo.mjs');
  assert.match(runbook, /run-visible-onboarding\.mjs --port 4317/);
  assert.match(runbook, /`\/setup`/);
  assert.match(runbook, /`\/app\/setup` only redirects/);
  assert.match(runbook, /`\/cloud\/dashboard\/index\.html` is test-static only/);
  assert.doesNotMatch(launcher, /cloud\/dashboard\/index\.html/);
});

test('existing visible onboarding launcher retains its help and port contract', async () => {
  const launcher = read('../scripts/run-visible-onboarding.mjs');
  assert.match(launcher, /Usage: node scripts\/run-visible-onboarding\.mjs \[--port <free-loopback-port>\]/);
  assert.match(launcher, /headless: false/);
  assert.match(launcher, /\/setup/);
});

test('visible client launcher enters its CLI handler when invoked with the documented relative path', () => {
  const output = execFileSync(process.execPath, ['scripts/run-visible-client-demo.mjs', '--help'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
  });
  assert.match(output, /Usage: node scripts\/run-visible-client-demo\.mjs \[--port <free-loopback-port>\]/);
});

test('client fixture exposes fixed fictional data, loopback root route, and ordered checkpoints', async () => {
  const fixture = await createClientDemoFixture({ port: 0 });
  try {
    assert.match(fixture.dashboardUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(fixture.dataset.label, 'synthetic, disposable client demo');
    assert.equal(fixture.dataset.organization, 'Northstar Demonstration Cooperative');
    assert.deepEqual(fixture.dataset.machines.map(({ name }) => name), ['aurora-console', 'beacon-laptop']);
    assert.equal(fixture.dataset.health.synthetic_control.overall, 'ok');
    assert.deepEqual(fixture.policyExample, { path: 'agent_budget.warn_pct', value: 85 });
    assert.deepEqual(DEMO_CHECKPOINTS.map(({ id }) => id), ['client-login', 'client-health', 'client-preview', 'client-confirmation', 'client-cleanup']);
    assert.equal(fixture.externalAttemptCount, 0);
  } finally {
    await fixture.close();
  }
});

test('client fixture rejects provider-related inherited environment values and non-loopback inputs without reading values', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'must-never-be-read';
  await assert.rejects(() => createClientDemoFixture({ port: 0 }), /provider-related environment variables are not allowed/);
  if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = previous;
  await assert.rejects(() => createClientDemoFixture({ port: 0, host: '0.0.0.0' }), /unsupported fixture option/);
  await assert.rejects(() => createClientDemoFixture({ port: -1 }), /between 0 and 65535/);
});

test('client evidence accepts only safe fields and rejects credential-like or raw content', async () => {
  const fixture = await createClientDemoFixture({ port: 0 });
  try {
    const evidence = fixture.writeEvidence({ status: 'passed', checkpoints: [{ id: 'client-login', expected: 'fixture sign-in', outcome: 'passed' }], cleanup: 'removed' });
    assert.ok(existsSync(evidence.manifestPath));
    assert.deepEqual(Object.keys(evidence.manifest).sort(), ['classification', 'ended_at', 'owner_role', 'redaction_status', 'result', 'route', 'run_id', 'started_at', 'workflow'].sort());
    assert.equal(evidence.manifest.owner_role, 'Demo Engineering');
    assert.equal(evidence.manifest.classification, 'local-synthetic');
    assert.doesNotMatch(readFileSync(evidence.manifestPath, 'utf8'), /password|token|authorization|raw/i);
    assert.throws(() => fixture.writeEvidence({ status: 'passed', diagnostics: { password: 'not-safe' } }), /unsafe evidence/);
    assert.throws(() => fixture.writeEvidence({ status: 'passed', checkpoints: [{ id: 'client-login', expected: 'Bearer secret', outcome: 'passed' }] }), /unsafe evidence/);
  } finally {
    const cleanup = await fixture.close();
    rmSync(fixture.evidenceDir, { recursive: true, force: true });
    assert.equal(cleanup.rootRemoved, true);
  }
});

test('presentation package records founder self-review ownership and makes no readiness overclaim', () => {
  const runbook = read('../docs/client-demo-presenter-runbook.md');
  const captureBrief = read('../docs/client-demo-capture-brief.md');
  assert.match(runbook, /Founder \(self-review\)/);
  assert.match(captureBrief, /Founder self-review/);
  assert.match(runbook, /sole named owner/);
  assert.match(runbook, /not a customer environment/);
  assert.match(runbook, /does not establish production\/client readiness, release approval/);
  for (const gate of ['Safari/macOS approval', 'NVDA/VoiceOver approval', 'Electron approval', 'performance evidence', 'visual-baseline approval', 'canary approval']) {
    assert.ok(runbook.includes(gate), `runbook must retain unresolved ${gate} gate`);
  }
});

test('client fixture cleanup is idempotent, removes its database/root, and forbids reuse', async () => {
  const fixture = await createClientDemoFixture({ port: 0 });
  const dbPath = fixture.dbPath;
  const root = fixture.root;
  const first = await fixture.close();
  const second = await fixture.close();
  assert.deepEqual(first, { rootRemoved: true, dbRemoved: true });
  assert.deepEqual(second, { rootRemoved: true, dbRemoved: true });
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(dbPath), false);
  assert.throws(() => fixture.start(), /already closed/);
  rmSync(fixture.evidenceDir, { recursive: true, force: true });
});

test('visible client launcher validates inputs, opens headed root route, and cleans up on stop', async () => {
  await assert.rejects(() => runVisibleClientDemo({ port: '4318' }), /integer/);
  await assert.rejects(() => runVisibleClientDemo({ port: 65536 }), /between 0 and 65535/);
  await assert.rejects(() => runVisibleClientDemo({ port: 0, providerUrl: 'https://example.test' }), /unsupported launcher option/);
  const calls = [];
  const session = await runVisibleClientDemo({
    port: 0,
    launchBrowser: async (options) => {
      calls.push(options);
      return { close: async () => { calls.push({ closed: true }); } };
    },
  });
  assert.match(session.dashboardUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(calls[0].headless, false);
  assert.equal(calls[0].channel, 'chrome');
  assert.equal(calls[0].url, session.dashboardUrl);
  const stopped = await session.stop('abandoned');
  assert.equal(stopped.cleanup.rootRemoved, true);
  assert.equal(stopped.cleanup.dbRemoved, true);
  assert.equal(existsSync(session.fixture.root), false);
  rmSync(session.fixture.evidenceDir, { recursive: true, force: true });
});
