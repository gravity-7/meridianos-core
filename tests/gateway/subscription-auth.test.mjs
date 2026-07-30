/**
 * Tests for subscription-based authentication in the gateway.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeTokenEvent } from '../../gateway/token-event.mjs';

describe('subscription auth', () => {
  it('token events distinguish subscription from api_key billing', () => {
    const subEvent = makeTokenEvent({
      agent: 'claude',
      session: 's1',
      requestId: 'sub-req-001',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      wire: 'anthropic',
      source: 'ide',
      ideName: 'claude-code',
      billingType: 'subscription',
    });

    const apiKeyEvent = makeTokenEvent({
      agent: 'builder',
      session: 's2',
      requestId: 'api-req-001',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      wire: 'anthropic',
      source: 'agent',
      billingType: 'api_key',
    });

    assert.strictEqual(subEvent.billingType, 'subscription');
    assert.strictEqual(apiKeyEvent.billingType, 'api_key');
    assert.notStrictEqual(subEvent.billingType, apiKeyEvent.billingType);
  });

  it('subscription events carry ide attribution', () => {
    const event = makeTokenEvent({
      agent: 'claude',
      session: 's3',
      requestId: 'sub-req-002',
      provider: 'anthropic',
      model: 'claude-opus-4-20250514',
      wire: 'anthropic',
      source: 'ide',
      ideName: 'claude-code',
      billingType: 'subscription',
    });

    assert.strictEqual(event.source, 'ide');
    assert.strictEqual(event.ideName, 'claude-code');
    assert.strictEqual(event.billingType, 'subscription');
  });

  it('default billing type is api_key for backward compatibility', () => {
    // Existing code that doesn't pass billingType should still work
    const event = makeTokenEvent({
      agent: 'builder',
      session: 's4',
      requestId: 'legacy-req-001',
      provider: 'deepseek',
      model: 'deepseek-chat',
      wire: 'openai',
    });

    assert.strictEqual(event.billingType, 'api_key');
    assert.strictEqual(event.ideName, null);
  });
});
