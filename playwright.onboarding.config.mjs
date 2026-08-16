import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  testMatch: 'legacy-setup-onboarding.spec.mjs',
  workers: 1,
  outputDir: 'artifacts/playwright-onboarding',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
