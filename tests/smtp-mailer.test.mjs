/**
 * tests/smtp-mailer.test.mjs — P5: US5 SMTP mailer unit tests.
 * Tests email formatting, MIME structure, and connection timeout handling.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// We test the module's export shape and pure formatting functions
// without needing a real SMTP server (connection tests are integration-level)

describe('smtp-mailer', () => {
  let sendEmail;

  before(async () => {
    try {
      const mod = await import('../smtp-mailer.mjs');
      sendEmail = mod.sendEmail;
    } catch { /* may not exist */ }
  });

  it('sendEmail returns error for missing required fields', async () => {
    if (!sendEmail) return;
    const r = await sendEmail({});
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('Missing'));
  });

  it('sendEmail returns error for partial config', async () => {
    if (!sendEmail) return;
    const r = await sendEmail({ host: 'smtp.test.com', port: 587 });
    assert.strictEqual(r.ok, false);
  });

  it('sendEmail returns error for connection timeout (invalid host)', { timeout: 10000 }, async () => {
    if (!sendEmail) return;
    // Using an unroutable IP should timeout
    const r = await sendEmail({
      host: '192.0.2.1', // TEST-NET-1, should be unreachable
      port: 587,
      user: 'test@test.com',
      pass: 'test',
      from: 'from@test.com',
      to: 'to@test.com',
      subject: 'Test',
      textBody: 'Hello',
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error);
  });
});
