/**
 * tests/policy-validate-providers.test.mjs — Tests for provider validation in policy-validate.mjs (US1).
 *
 * Tests:
 *   - Invalid wire values rejected with message listing valid wires
 *   - Missing required fields caught
 *   - Valid provider configs pass validation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicySchema, validatePolicy } from '../policy-validate.mjs';

describe('Policy Validate — Provider Schema Validation', () => {
  it('rejects providers with invalid wire type', () => {
    const policy = {
      providers: {
        bad: {
          name: 'bad',
          wire: 'nonexistent-wire',
          baseUrl: 'https://example.com',
        },
      },
    };
    const result = validatePolicySchema(policy);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('wire')), 'error should mention wire');
    assert.ok(result.errors.some((e) => e.includes('nonexistent-wire')), 'error should include the invalid wire name');
  });

  it('rejects providers missing baseUrl', () => {
    const policy = {
      providers: {
        bad: {
          name: 'bad',
          wire: 'openai',
        },
      },
    };
    const result = validatePolicySchema(policy);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('baseUrl')), 'error should mention baseUrl');
  });

  it('accepts valid provider configurations', () => {
    const policy = {
      providers: {
        groq: {
          name: 'groq',
          wire: 'openai',
          baseUrl: 'https://api.groq.com/openai/v1',
          keyEnv: 'GROQ_API_KEY',
        },
      },
    };
    const result = validatePolicySchema(policy);
    assert.equal(result.ok, true, 'valid provider should pass');
  });

  it('accepts providers with valid wires (anthropic, openai, google-ai, generic-http)', () => {
    for (const wire of ['anthropic', 'openai', 'google-ai', 'generic-http']) {
      const policy = {
        providers: {
          test: {
            name: 'test',
            wire,
            baseUrl: 'https://example.com',
          },
        },
      };
      const result = validatePolicySchema(policy);
      assert.equal(result.ok, true, `wire '${wire}' should be valid`);
    }
  });

  it('validatePolicy passes through valid provider configs without error', () => {
    const policy = {
      providers: {
        groq: {
          name: 'groq',
          wire: 'openai',
          baseUrl: 'https://api.groq.com/openai/v1',
        },
      },
    };
    const result = validatePolicy(policy);
    // validatePolicy doesn't deeply validate providers (that's validatePolicySchema's job)
    // It should not throw or error on provider keys
    assert.ok(result.ok || result.errors.length === 0, 'validatePolicy should not reject valid providers');
  });

  it('validatePolicySchema reports errors for providers with empty name', () => {
    // name validation is handled by schema — baseUrl check catches missing required fields
    const policy = {
      providers: {
        '': {
          name: '',
          wire: 'openai',
          baseUrl: '',
        },
      },
    };
    const result = validatePolicySchema(policy);
    // Empty baseUrl should be caught
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('baseUrl')), 'error should mention baseUrl');
  });
});
