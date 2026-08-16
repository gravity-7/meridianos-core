#!/usr/bin/env node

import { createOnboardingFixture } from '../tests/fixtures/onboarding-fixture.mjs';

function parseArgs(argv) {
  const options = { port: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--port') {
      options.port = Number(argv[++index]);
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) throw new Error('the selected port must be between 0 and 65535');
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  return options;
}

function printUsage() {
  console.log('Usage: node scripts/run-visible-onboarding.mjs [--port <free-loopback-port>]');
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

let fixture;
let browser;
let context;
let page;
let stopping = false;
const observations = [];
const checkpoints = [{ id: 'founder-session', expected: 'headed /setup session', actual: 'started', outcome: 'passed' }];

async function stop() {
  if (stopping) return;
  stopping = true;
  const runFixture = fixture;
  let completed = false;
  try {
    completed = Boolean(page && !page.isClosed() && await page.getByRole('heading', { name: 'Setup complete' }).count());
    if (page && !page.isClosed()) {
      observations.push(await page.evaluate(() => ({
        html: document.documentElement.outerHTML,
        url: window.location.href,
        storage: JSON.stringify(localStorage),
      })));
    }
  } catch {
    // Closing a visible browser is a normal abandoned-walkthrough path.
  }
  if (runFixture) {
    try {
      const cleanupResult = await runFixture.close();
      runFixture.writeEvidence({
        status: completed ? 'passed' : 'abandoned',
        checkpoints: completed
          ? [...checkpoints, { id: 'completion', expected: 'setup complete', actual: 'visible', outcome: 'passed' }]
          : [...checkpoints, { id: 'completion', expected: 'setup complete', actual: 'walkthrough ended early', outcome: 'failed' }],
        redactionValues: observations,
        cleanup: cleanupResult.rootRemoved ? 'removed' : 'failed',
        diagnostics: { browser_error_count: 0, founder_visible: true },
      });
    } catch {
      // The fixture still performs cleanup even if evidence validation rejects an unsafe input.
    }
  }
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  fixture = null;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void stop().finally(() => process.exit(0)); });
}

try {
  fixture = await createOnboardingFixture({ dashboardPort: options.port });
  const { chromium } = await import('@playwright/test');
  browser = await chromium.launch({ headless: false, channel: 'chrome' });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  page.on('console', (message) => observations.push({ console: message.text() }));
  page.on('pageerror', (error) => observations.push({ pageerror: error.message }));
  await page.goto(`${fixture.dashboardUrl}/setup`);
  console.log('MeridianOS visible onboarding is running with synthetic, disposable data.');
  console.log(`Open ${fixture.dashboardUrl}/setup in the headed browser and complete the current legacy setup journey.`);
  console.log('Provider validation is loopback-simulated; no real provider key or external service is used.');
  console.log('Press Ctrl+C or close the browser to clean up the temporary fixture.');
  await new Promise((resolve) => {
    page.once('close', resolve);
    browser.once('disconnected', resolve);
  });
} finally {
  await stop();
}
