import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnboardingDraft,
  clearOnboardingDraft,
  deserializeOnboardingDraft,
  loadOnboardingDraft,
  persistOnboardingDraft,
  serializeOnboardingDraft,
  validateOnboardingDraft,
} from '../dashboard/static/onboarding-draft.mjs';

describe('OnboardingDraft', () => {
  it('persists only the non-secret setup state', () => {
    const draft = createOnboardingDraft({
      installationName: 'Test Co', agents: ['builder'], monthlyBudgetUsd: 100,
      provider: { id: 'deepseek', metadata: { baseUrl: 'https://api.example.test' } },
      credential: 'never-persist-me', rawError: 'also-never-persist-me',
    });
    const serialized = serializeOnboardingDraft(draft);
    assert.doesNotMatch(serialized, /never-persist-me/);
    assert.deepEqual(deserializeOnboardingDraft(serialized).agents, ['builder']);
  });

  it('requires a positive budget, an agent, and a provider before review', () => {
    assert.throws(() => validateOnboardingDraft({ installationName: 'x', agents: [], monthlyBudgetUsd: 10 }), /agent/i);
    assert.throws(() => validateOnboardingDraft({ installationName: 'x', agents: ['builder'], monthlyBudgetUsd: 0 }), /budget/i);
    assert.throws(() => validateOnboardingDraft({ installationName: 'x', agents: ['builder'], monthlyBudgetUsd: 1 }), /provider/i);
  });

  it('drops a validation result when its provider no longer matches', () => {
    const restored = deserializeOnboardingDraft(JSON.stringify({
      version: 1, installationName: 'x', agents: ['builder'], monthlyBudgetUsd: 1,
      provider: { id: 'deepseek' }, validation: { providerId: 'anthropic', status: 'valid' }, lastSafeStep: 'provider',
    }));
    assert.equal(restored.validation, null);
  });

  it('clears a persisted draft and recovers safely from unavailable storage', () => {
    const store = new Map();
    const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
    const draft = createOnboardingDraft({ provider: { id: 'deepseek' }, agents: ['builder'] });
    assert.equal(persistOnboardingDraft(storage, 'draft', draft), true);
    assert.equal(loadOnboardingDraft(storage, 'draft').provider.id, 'deepseek');
    assert.equal(clearOnboardingDraft(storage, 'draft'), true);
    assert.equal(loadOnboardingDraft(storage, 'draft').lastSafeStep, 'identity');
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    assert.equal(persistOnboardingDraft(blocked, 'draft', draft), false);
    assert.equal(loadOnboardingDraft(blocked, 'draft').validation, null);
    assert.equal(clearOnboardingDraft(blocked, 'draft'), false);
  });
});
