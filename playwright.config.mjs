import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests', outputDir: 'artifacts/playwright-results', reporter: [['list'], ['html', { outputFolder: 'artifacts/browser/report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4319', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/start-ui-platform-test-server.mjs', url: 'http://127.0.0.1:4319/healthz', reuseExistingServer: false },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
});
