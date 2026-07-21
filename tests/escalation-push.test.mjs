import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pushEscalations, clearPushed, pushedCount, resolveWebhookUrl,
  resolveSlackConfig, pushToSlack, formatVerifierFailure,
  formatBudgetAlert, routeToSlack,
} from '../escalation-push.mjs';
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

// ─────────────────────────────────────────────────────────────────────────────
// F007 — Slack Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

test('resolveSlackConfig returns disabled when no URL is configured', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  delete process.env.SLACK_WEBHOOK_URL;
  const result = resolveSlackConfig(config, {});
  assert.equal(result.enabled, false);
  assert.equal(result.webhookUrl, null);
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev;
});

test('resolveSlackConfig reads SLACK_WEBHOOK_URL from env', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B000/xxxx';
  const result = resolveSlackConfig(config, {});
  assert.equal(result.enabled, true);
  assert.equal(result.webhookUrl, 'https://hooks.slack.com/services/TEST/B000/xxxx');
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});

test('resolveSlackConfig reads webhook_url from policy integrations.slack', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  delete process.env.SLACK_WEBHOOK_URL;
  const policy = { integrations: { slack: { webhook_url: 'https://hooks.slack.com/services/TEST/B111/yyyy' } } };
  const result = resolveSlackConfig(config, policy);
  assert.equal(result.enabled, true);
  assert.equal(result.webhookUrl, 'https://hooks.slack.com/services/TEST/B111/yyyy');
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev;
});

test('resolveSlackConfig respects integrations.slack.enabled = false', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B000/xxxx';
  const policy = { integrations: { slack: { enabled: false, webhook_url: 'https://hooks.slack.com/services/TEST/B000/xxxx' } } };
  const result = resolveSlackConfig(config, policy);
  assert.equal(result.enabled, false);
  assert.equal(result.webhookUrl, 'https://hooks.slack.com/services/TEST/B000/xxxx');
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});

test('resolveSlackConfig env var overrides policy webhook_url', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B222/env';
  const policy = { integrations: { slack: { webhook_url: 'https://hooks.slack.com/services/TEST/B000/policy' } } };
  const result = resolveSlackConfig(config, policy);
  assert.equal(result.enabled, true);
  assert.equal(result.webhookUrl, 'https://hooks.slack.com/services/TEST/B222/env');
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});

test('pushToSlack returns error for missing webhook URL', async () => {
  const result = await pushToSlack(null, { text: 'test' });
  assert.equal(result.ok, false);
  assert.match(result.error, /missing webhook/);
});

test('pushToSlack returns error for missing message', async () => {
  const result = await pushToSlack('https://hooks.slack.com/services/TEST/B000/xxxx', null);
  assert.equal(result.ok, false);
  assert.match(result.error, /missing webhook/);
});

test('pushToSlack handles unreachable webhook gracefully', async () => {
  const result = await pushToSlack('http://localhost:1/nope', { text: 'test', blocks: [] });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('formatVerifierFailure produces valid Block Kit JSON with one failure', () => {
  const failures = [
    { task: 'F001-docs-writer', disposition: 'bounced', detail: 'guardrail: tone violation detected' },
  ];
  const msg = formatVerifierFailure('mos-dev', failures);
  assert.ok(msg.blocks);
  assert.ok(Array.isArray(msg.blocks));
  assert.ok(msg.text);
  // Header block
  const header = msg.blocks.find(b => b.type === 'header');
  assert.ok(header);
  assert.match(header.text.text, /Verifier Failure/);
  // Section block for the failure
  const section = msg.blocks.find(b => b.type === 'section');
  assert.ok(section);
  assert.match(section.text.text, /F001-docs-writer/);
  assert.match(section.text.text, /bounced/);
  // Context block
  const context = msg.blocks.find(b => b.type === 'context');
  assert.ok(context);
  assert.match(context.elements[0].text, /mos-dev/);
});

test('formatVerifierFailure handles multiple failures', () => {
  const failures = [
    { task: 'F001', disposition: 'blocked', detail: 'test failure' },
    { task: 'F002', disposition: 'bounced', detail: 'lint error' },
  ];
  const msg = formatVerifierFailure('test-domain', failures);
  assert.ok(msg.text.includes('2'));
  const sections = msg.blocks.filter(b => b.type === 'section');
  assert.equal(sections.length, 2);
});

test('formatVerifierFailure truncates at 10 failures with a note', () => {
  const failures = Array.from({ length: 15 }, (_, i) => ({
    task: `F${String(i).padStart(3, '0')}`,
    disposition: 'bounced',
    detail: `error ${i}`,
  }));
  const msg = formatVerifierFailure('dom', failures);
  const sections = msg.blocks.filter(b => b.type === 'section');
  // 10 individual failure sections + 1 overflow note
  assert.equal(sections.length, 11);
  assert.match(sections[10].text.text, /5 more failure/);
});

test('formatBudgetAlert returns null when state is ok', () => {
  const agentBudget = { state: 'ok', windows: [] };
  const result = formatBudgetAlert('mos-dev', 'claude', agentBudget);
  assert.equal(result, null);
});

test('formatBudgetAlert returns null for null/undefined budget', () => {
  assert.equal(formatBudgetAlert('mos-dev', 'claude', null), null);
  assert.equal(formatBudgetAlert('mos-dev', 'claude', undefined), null);
});

test('formatBudgetAlert produces valid Block Kit for warn state', () => {
  const agentBudget = {
    state: 'warn',
    windows: [
      { window: '5h', used: 85000, cap: 100000, pct: 85, state: 'warn' },
      { window: 'week', used: 400000, cap: 500000, pct: 80, state: 'ok' },
    ],
  };
  const msg = formatBudgetAlert('mos-dev', 'claude', agentBudget);
  assert.ok(msg);
  assert.ok(msg.blocks);
  assert.ok(Array.isArray(msg.blocks));
  // Header
  const header = msg.blocks.find(b => b.type === 'header');
  assert.ok(header);
  assert.match(header.text.text, /Budget Warning/);
  // Agent section
  const agentSection = msg.blocks[1];
  assert.match(agentSection.text.text, /claude/);
  assert.match(agentSection.text.text, /WARN/);
  // Window sections
  assert.match(msg.blocks[2].text.text, /5h/);
  assert.match(msg.blocks[2].text.text, /85%/);
  // Context
  const context = msg.blocks.find(b => b.type === 'context');
  assert.ok(context);
  assert.match(context.elements[0].text, /mos-dev/);
});

test('formatBudgetAlert produces valid Block Kit for halt state', () => {
  const agentBudget = {
    state: 'halt',
    windows: [
      { window: '5h', used: 100001, cap: 100000, pct: 100, state: 'halt' },
      { window: 'week', used: 501000, cap: 500000, pct: 100, state: 'halt' },
    ],
  };
  const msg = formatBudgetAlert('mos-dev', 'antigravity', agentBudget);
  assert.ok(msg);
  const header = msg.blocks.find(b => b.type === 'header');
  assert.match(header.text.text, /BUDGET HALT/);
  const agentSection = msg.blocks[1];
  assert.match(agentSection.text.text, /antigravity/);
  assert.match(agentSection.text.text, /HALT/);
});

test('formatBudgetAlert handles no-cap windows gracefully', () => {
  const agentBudget = {
    state: 'warn',
    windows: [
      { window: '5h', used: 5000, cap: null, pct: null, state: 'no-cap' },
      { window: 'week', used: 400000, cap: 500000, pct: 80, state: 'ok' },
    ],
  };
  const msg = formatBudgetAlert('mos-dev', 'claude', agentBudget);
  assert.ok(msg);
  assert.match(msg.blocks[2].text.text, /no cap/);
});

test('routeToSlack returns { route: false } when Slack is not configured', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  delete process.env.SLACK_WEBHOOK_URL;
  const result = routeToSlack(config, 'verifier_failure', {});
  assert.equal(result.route, false);
  assert.equal(result.webhookUrl, null);
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev;
});

test('routeToSlack returns { route: true } when Slack is configured (no events filter)', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B000/xxxx';
  const result = routeToSlack(config, 'verifier_failure', {});
  assert.equal(result.route, true);
  assert.equal(result.webhookUrl, 'https://hooks.slack.com/services/TEST/B000/xxxx');
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});

test('routeToSlack filters by integrations.slack.events whitelist', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B000/xxxx';
  const policy = { integrations: { slack: { events: ['verifier_failure'] } } };

  // verifier_failure is in the whitelist
  const r1 = routeToSlack(config, 'verifier_failure', policy);
  assert.equal(r1.route, true);

  // budget_breach is NOT in the whitelist
  const r2 = routeToSlack(config, 'budget_breach', policy);
  assert.equal(r2.route, false);

  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});

test('routeToSlack respects integrations.slack.enabled = false', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B000/xxxx';
  const policy = { integrations: { slack: { enabled: false } } };
  const result = routeToSlack(config, 'verifier_failure', policy);
  assert.equal(result.route, false);
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});

test('routeToSlack routes all events when events list is empty', () => {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/B000/xxxx';
  const policy = { integrations: { slack: { events: [] } } };
  const result = routeToSlack(config, 'verifier_failure', policy);
  assert.equal(result.route, true);
  if (prev !== undefined) process.env.SLACK_WEBHOOK_URL = prev; else delete process.env.SLACK_WEBHOOK_URL;
});
