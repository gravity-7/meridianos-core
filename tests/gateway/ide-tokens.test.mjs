/**
 * Tests for IDE traffic token attribution in the gateway ledger.
 * Verifies ide_name and billing_type columns work correctly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeTokenEvent, validateTokenEvent } from '../../gateway/token-event.mjs';

describe('token-event IDE attribution', () => {
  it('makeTokenEvent includes ideName and billingType fields', () => {
    const event = makeTokenEvent({
      agent: 'test-agent',
      session: 'test-session',
      requestId: 'req-001',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      wire: 'anthropic',
      source: 'ide',
      ideName: 'vscode-copilot',
      billingType: 'api_key',
    });

    assert.strictEqual(event.source, 'ide');
    assert.strictEqual(event.ideName, 'vscode-copilot');
    assert.strictEqual(event.billingType, 'api_key');
  });

  it('makeTokenEvent defaults billingType to api_key', () => {
    const event = makeTokenEvent({
      agent: 'test-agent',
      session: 'test-session',
      requestId: 'req-001',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      wire: 'anthropic',
    });

    assert.strictEqual(event.billingType, 'api_key');
    assert.strictEqual(event.ideName, null);
  });

  it('makeTokenEvent accepts subscription billing type', () => {
    const event = makeTokenEvent({
      agent: 'test-agent',
      session: 'test-session',
      requestId: 'req-002',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      wire: 'anthropic',
      source: 'ide',
      ideName: 'claude-code',
      billingType: 'subscription',
    });

    assert.strictEqual(event.billingType, 'subscription');
    assert.strictEqual(event.ideName, 'claude-code');
  });

  it('validateTokenEvent rejects null agent', () => {
    assert.throws(() => {
      validateTokenEvent(makeTokenEvent({
        agent: null,
        session: 'test',
        requestId: 'req-003',
        provider: 'openai',
        model: 'gpt-4',
        wire: 'openai',
      }));
    }, /agent/);
  });
});
