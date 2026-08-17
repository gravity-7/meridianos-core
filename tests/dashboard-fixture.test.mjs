import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createClientDemoFixture } from './fixtures/client-demo-fixture.mjs';

test('Spec 017 fixture contract remains synthetic-only and external-request rejecting', async () => {
  const fixture = await fs.readFile('tests/fixtures/client-demo-fixture.mjs', 'utf8');
  const launcher = await fs.readFile('scripts/run-visible-client-demo.mjs', 'utf8');
  assert.match(fixture, /synthetic/i);
  assert.match(fixture, /loopback|127\.0\.0\.1/i);
  assert.match(fixture, /external|network|request/i);
  assert.match(fixture, /127\.0\.0\.1/);
  assert.match(launcher, /local client demo|loopback/i);
  assert.doesNotMatch(launcher, /DEEPSEEK_KEY|ZAI_KEY|GLM_KEY/);
});

test('fixture telemetry is deterministic, labelled, and never part of normal installation state', async () => {
  const fixture = await createClientDemoFixture({ port: 0 });
  try {
    assert.equal(fixture.telemetry.classification, 'local-synthetic');
    assert.equal(fixture.telemetry.points.length, 3);
    assert.equal(fixture.telemetry.points[0].at, '2026-08-18T10:00:00.000Z');
    assert.equal(fixture.externalAttemptCount, 0);
    assert.match(fixture.dashboardUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  } finally {
    const cleanup = await fixture.close();
    assert.equal(cleanup.rootRemoved, true);
    assert.equal(cleanup.dbRemoved, true);
  }
});
