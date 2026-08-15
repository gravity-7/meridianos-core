import { test } from 'node:test';

// Phase 2 owns the loopback fixture implementation. This Phase 1 scaffold reserves the
// focused test location without starting browser/process orchestration early.
test.skip('Phase 2: isolated onboarding fixture enforces loopback-only dependencies', () => {});
