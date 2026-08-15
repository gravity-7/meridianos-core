import { test } from '@playwright/test';

// Phase 2 owns executable browser automation. Keeping the journey name stable lets the Phase 1
// UI contract tests protect the same visible setup surface without creating browser evidence yet.
test.describe.skip('legacy /setup onboarding journey (Phase 2)', () => {});
