import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExit, isQuotaText, isBudgetText, parseResetAt, resetInstant, MAX_QUOTA_WAIT_MS } from '../exit-classify.mjs';

test('classifyExit recognizes a provider quota refusal on stdout and extracts the reset time', () => {
  const c = classifyExit({ code: 1, stdout: "You've hit your session limit · resets 6:20pm (Asia/Karachi)" });
  assert.equal(c.reason, 'quota');
  assert.equal(c.outcome, 'failed');
  assert.equal(c.resetAt, '6:20pm');
});

test('classifyExit maps the other exit shapes to typed reasons', () => {
  assert.equal(classifyExit({ code: 0, stdout: 'done' }).reason, 'ok');
  assert.equal(classifyExit({ code: 0 }).outcome, 'ok');
  assert.equal(classifyExit({ timedOut: true }).reason, 'timeout');
  assert.equal(classifyExit({ spawnError: 'ENOENT' }).reason, 'spawn_error');
  assert.equal(classifyExit({ signal: 'SIGKILL' }).reason, 'signal');
  assert.equal(classifyExit({ code: 2, stderr: 'boom' }).reason, 'nonzero');
});

// A gateway budget deny (PR #29's non-retryable 403) must classify DISTINCTLY from both a plain
// crash ('nonzero') and a provider quota window ('quota') — the three are operationally different
// (budget never self-clears within the run; quota reopens on its own; nonzero is an unknown bug)
// and runner.mjs/the dashboard must be able to tell them apart, not lump every non-zero exit
// together. The exact stdout text below is the REAL string the `claude` CLI prints (verified via
// an offline live spawn against a local denying gateway instance, 2026-07-18) — see
// tests/exit-confirm-e2e.test.mjs for the full end-to-end process-exit proof.
test('classifyExit recognizes a gateway budget deny (#29) distinctly from a crash and from a quota window', () => {
  const c = classifyExit({ code: 1, stdout: 'Failed to authenticate. API Error: 403 gateway: over budget (5h)\n' });
  assert.equal(c.reason, 'budget');
  assert.equal(c.outcome, 'failed');
  assert.equal(c.resetAt, null);
  assert.notEqual(c.reason, 'nonzero');
  assert.notEqual(c.reason, 'quota');

  // The openai-wire deny body carries the identical message text (gateway/server.mjs's denyBody) —
  // same fingerprint must fire regardless of which wire's harness surfaced it.
  const openaiShaped = classifyExit({ code: 1, stdout: '{"error":{"message":"gateway: over budget (week)","type":"permission_error","code":"over_budget"}}' });
  assert.equal(openaiShaped.reason, 'budget');
});

test('isBudgetText', () => {
  assert.equal(isBudgetText('normal output'), false);
  assert.equal(isBudgetText('API Error: 403 gateway: over budget (5h)'), true);
  assert.equal(isBudgetText('gateway: over budget (week)'), true);
});

test('isQuotaText / parseResetAt', () => {
  assert.equal(isQuotaText('normal output'), false);
  assert.equal(isQuotaText('Error: usage limit reached'), true);
  assert.equal(parseResetAt('resets at 11:40pm (Asia/Karachi)'), '11:40pm');
  assert.equal(parseResetAt('no reset here'), null);
});

test('resetInstant returns the next local occurrence, clamped so a stale pm cannot wait a day', () => {
  const noon = new Date(2026, 6, 7, 12, 0, 0).getTime();
  // 2:20pm today is ~2h away
  const twoTwenty = resetInstant('2:20pm', noon);
  assert.ok(twoTwenty > noon && twoTwenty <= noon + MAX_QUOTA_WAIT_MS);
  // a time already passed today (6:00am) rolls to tomorrow but is clamped to the max wait
  const clamped = resetInstant('6:00am', noon);
  assert.equal(clamped, noon + MAX_QUOTA_WAIT_MS);
  assert.equal(resetInstant('garbage', noon), null);
});
