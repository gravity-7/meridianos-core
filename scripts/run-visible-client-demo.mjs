#!/usr/bin/env node

import { createClientDemoFixture, writeDemoEvidence } from '../tests/fixtures/client-demo-fixture.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function validatePort(port) {
  if (!Number.isInteger(port)) throw new TypeError('the selected port must be an integer');
  if (port < 0 || port > 65_535) throw new RangeError('the selected port must be between 0 and 65535');
  return port;
}

function assertOptions(options) {
  const allowed = new Set(['port', 'launchBrowser']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`unsupported launcher option: ${key}`);
}

async function launchHeadedBrowser({ url, headless, channel }) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless, channel });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(url);
  return {
    page,
    waitForClose: new Promise((resolve) => {
      page.once('close', resolve);
      browser.once('disconnected', resolve);
    }),
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/** Start the local, deterministic client-operations walkthrough and return an idempotently stoppable session. */
export async function runVisibleClientDemo(options = {}) {
  assertOptions(options);
  const port = validatePort(options.port ?? 0);
  const fixture = await createClientDemoFixture({ port });
  let browser;
  let stopped = false;
  try {
    fixture.assertBrowserOrigin(fixture.dashboardUrl);
    const launchBrowser = options.launchBrowser ?? launchHeadedBrowser;
    browser = await launchBrowser({ url: fixture.dashboardUrl, headless: false, channel: 'chrome' });
  } catch (error) {
    const cleanup = await fixture.close();
    writeSafeResult(fixture, 'failed', cleanup);
    // No error detail is persisted: it could contain browser or environment content.
    throw new Error(`unable to start the headed local client demo (fixture cleanup: ${cleanup.rootRemoved && cleanup.dbRemoved ? 'removed' : 'failed'})`, { cause: error });
  }
  const session = {
    fixture,
    dashboardUrl: fixture.dashboardUrl,
    browser,
    get stopped() { return stopped; },
    async stop(status = 'abandoned') {
      if (stopped) return this.result;
      stopped = true;
      await browser?.close?.().catch(() => {});
      const cleanup = await fixture.close();
      const evidence = writeSafeResult(fixture, status, cleanup);
      this.result = { cleanup, evidence };
      return this.result;
    },
  };
  return session;
}

function writeSafeResult(fixture, status, cleanup) {
  // writeEvidence intentionally receives only static checkpoint metadata and cleanup state.
  return writeDemoEvidence({ fixture,
    status: ['passed', 'failed', 'abandoned'].includes(status) ? status : 'abandoned',
    checkpoints: [{ id: 'client-cleanup', expected: 'temporary fixture root and database removed', outcome: cleanup.rootRemoved && cleanup.dbRemoved ? 'passed' : 'failed' }],
    cleanup: cleanup.rootRemoved && cleanup.dbRemoved ? 'removed' : 'failed',
  });
}

function parseArgs(argv) {
  const options = { port: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  validatePort(options.port);
  return options;
}

function printUsage() {
  console.log('Usage: node scripts/run-visible-client-demo.mjs [--port <free-loopback-port>]');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printUsage();
  const session = await runVisibleClientDemo({ port: options.port });
  console.log('MeridianOS visible client demo is running with synthetic, disposable data.');
  console.log(`Open ${session.dashboardUrl} in the headed browser; this is the local cloud-control-plane root route.`);
  console.log('No provider key, external provider, payment, or email service is used. Press Ctrl+C or close the browser to clean up.');
  const stop = async () => { await session.stop('abandoned'); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().finally(() => process.exit(0)); });
  await session.browser.waitForClose;
  await stop();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
