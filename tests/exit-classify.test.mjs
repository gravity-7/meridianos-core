import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExit, isQuotaText, parseResetAt, resetInstant, MAX_QUOTA_WAIT_MS } from '../exit-classify.mjs';

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
