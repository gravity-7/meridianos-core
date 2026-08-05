import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, listProfiles, resolveActivePolicy } from '../profiles.mjs';

test('resolveProfile returns a profile with no extends as-is (minus the extends key)', () => {
  const policy = { profiles: { base: { budget: { monthlyUsd: 100 } } } };
  assert.deepEqual(resolveProfile(policy, 'base'), { budget: { monthlyUsd: 100 } });
});

test('resolveProfile merges a one-level extends chain, child overrides win', () => {
  const policy = {
    profiles: {
      base: { agents: { builder: { defaultTier: 'medium' } }, budget: { monthlyUsd: 100 } },
      dev: { extends: 'base', budget: { monthlyUsd: 25 } },
    },
  };
  const resolved = resolveProfile(policy, 'dev');
  assert.deepEqual(resolved, { agents: { builder: { defaultTier: 'medium' } }, budget: { monthlyUsd: 25 } });
});

test('resolveProfile merges a multi-level extends chain (grandparent -> parent -> child)', () => {
  const policy = {
    profiles: {
      base: { agents: { builder: { defaultTier: 'medium' } }, budget: { monthlyUsd: 100 } },
      mid: { extends: 'base', budget: { monthlyUsd: 200 } },
      leaf: { extends: 'mid', agents: { builder: { defaultTier: 'complex' } } },
    },
  };
  const resolved = resolveProfile(policy, 'leaf');
  assert.deepEqual(resolved, { agents: { builder: { defaultTier: 'complex' } }, budget: { monthlyUsd: 200 } });
});

test('resolveProfile deep-merges nested objects rather than replacing them wholesale', () => {
  const policy = {
    profiles: {
      base: { agents: { builder: { defaultTier: 'medium' }, reviewer: { defaultTier: 'complex' } } },
      dev: { extends: 'base', agents: { builder: { defaultTier: 'quick' } } },
    },
  };
  const resolved = resolveProfile(policy, 'dev');
  // reviewer must survive even though dev only overrides builder
  assert.deepEqual(resolved.agents, { builder: { defaultTier: 'quick' }, reviewer: { defaultTier: 'complex' } });
});

test('resolveProfile throws a clear error for an unknown profile name', () => {
  const policy = { profiles: { base: {} } };
  assert.throws(() => resolveProfile(policy, 'nonexistent'), /unknown profile 'nonexistent'/i);
});

test('resolveProfile throws a clear error when extends points at an unknown profile', () => {
  const policy = { profiles: { dev: { extends: 'missing-base' } } };
  assert.throws(() => resolveProfile(policy, 'dev'), /extends unknown profile 'missing-base'/i);
});

test('resolveProfile throws a clear error on direct circular extends (A -> A)', () => {
  const policy = { profiles: { loopy: { extends: 'loopy' } } };
  assert.throws(() => resolveProfile(policy, 'loopy'), /circular profile inheritance/i);
});

test('resolveProfile throws a clear error on indirect circular extends (A -> B -> A)', () => {
  const policy = { profiles: { a: { extends: 'b' }, b: { extends: 'a' } } };
  assert.throws(() => resolveProfile(policy, 'a'), /circular profile inheritance/i);
});

test('resolveProfile throws when policy has no profiles defined at all', () => {
  assert.throws(() => resolveProfile({}, 'dev'), /unknown profile 'dev'/i);
});

test('listProfiles returns every profile name with its extends parent (or null)', () => {
  const policy = {
    profiles: {
      base: { budget: { monthlyUsd: 100 } },
      dev: { extends: 'base', budget: { monthlyUsd: 25 } },
    },
  };
  assert.deepEqual(listProfiles(policy), [
    { name: 'base', extends: null },
    { name: 'dev', extends: 'base' },
  ]);
});

test('listProfiles returns an empty array when no profiles are defined', () => {
  assert.deepEqual(listProfiles({}), []);
});

test('resolveActivePolicy returns policy unchanged when no active_profile is set', () => {
  const policy = { schedule: { cadence: 'default' } };
  assert.equal(resolveActivePolicy(policy), policy);
});

test('resolveActivePolicy overlays the active profile onto the base policy, stripping metadata keys', () => {
  const policy = {
    active_profile: 'dev',
    schedule: { cadence: 'default' },
    profiles: {
      base: { budget: { monthlyUsd: 100 } },
      dev: { extends: 'base', budget: { monthlyUsd: 25 } },
    },
  };
  const resolved = resolveActivePolicy(policy);
  assert.deepEqual(resolved, { schedule: { cadence: 'default' }, budget: { monthlyUsd: 25 } });
  assert.equal(resolved.profiles, undefined);
  assert.equal(resolved.active_profile, undefined);
});

test('resolveActivePolicy propagates a clear error for an unknown active_profile rather than booting silently wrong', () => {
  const policy = { active_profile: 'nonexistent', profiles: { base: {} } };
  assert.throws(() => resolveActivePolicy(policy), /unknown profile 'nonexistent'/i);
});
