import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushEscalations, clearPushed, pushedCount, resolveWebhookUrl } from '../escalation-push.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

test('resolveWebhookUrl never reads the secret from the tracked policy value, prefers env/secret', () => {
  // An `env:NAME` pointer resolves from the environment, not from policy text.
  const prevPrimary = process.env.AIOS_ESCALATION_WEBHOOK;
  delete process.env.AIOS_ESCALATION_WEBHOOK; // make the pointer path reachable
  const prev = process.env.AIOS_TEST_HOOK;
  process.env.AIOS_TEST_HOOK = 'https://hooks.slack.com/services/AAA/BBB/ccc';
  assert.equal(resolveWebhookUrl(config, { escalation: { webhook_url: 'env:AIOS_TEST_HOOK' } }), 'https://hooks.slack.com/services/AAA/BBB/ccc');
  // An `env:` pointer with the var unset resolves to null (no secret leaked, no fallback to text).
  delete process.env.AIOS_TEST_HOOK;
  assert.equal(resolveWebhookUrl(config, { escalation: { webhook_url: 'env:AIOS_TEST_HOOK' } }), null);
  if (prev !== undefined) process.env.AIOS_TEST_HOOK = prev;
  if (prevPrimary !== undefined) process.env.AIOS_ESCALATION_WEBHOOK = prevPrimary;
});

test('pushEscalations returns error when no webhook_url configured', async () => {
  const escalations = [{ id: 'esc-1', severity: 'warn', kind: 'test', title: 'Test', detail: 'detail', ts: new Date().toISOString() }];
  const policy = { escalation: { channel: 'push_digest' } };

  const result = await pushEscalations(escalations, { policy });
  assert.equal(result.sent, 0);
  assert.match(result.error, /no webhook/);
});

test('pushEscalations returns error when webhook_url is empty string', async () => {
  const escalations = [{ id: 'esc-2', severity: 'critical', kind: 'kill_switch', title: 'Kill switch', detail: '', ts: new Date().toISOString() }];
  const policy = { escalation: { channel: 'push_digest', webhook_url: '' } };

  const result = await pushEscalations(escalations, { policy });
  assert.equal(result.sent, 0);
  assert.match(result.error, /no webhook/);
});

test('pushEscalations deduplicates by escalation ID', async () => {
  clearPushed();
  const escalations = [];
  const policy = { escalation: { channel: 'push_digest', webhook_url: 'http://localhost:1/nope' } };

  // With no escalations, nothing to send
  const result = await pushEscalations(escalations, { policy });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 0);
});

test('clearPushed resets the dedup set', () => {
  clearPushed();
  assert.equal(pushedCount(), 0);
});

test('pushedCount reports size of dedup set', () => {
  clearPushed();
  assert.equal(pushedCount(), 0);
});
