import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelemetryCollector } from '../control-plane-telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '.test-telemetry.db');

function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
}

describe('telemetry (opt-in, local-only)', () => {
  after(cleanup);

  test('recordEvent is a no-op when telemetry is not opted in', () => {
    cleanup();
    const collector = new TelemetryCollector(TEST_DB_PATH, { env: {} });
    try {
      assert.equal(collector.isEnabled(), false);
      const result = collector.record('project_create', { project_id: 'p1' });
      assert.deepEqual(result, { recorded: false, reason: 'opted_out' });
      assert.deepEqual(collector.summarize(), { total: 0, byEvent: {}, days: 30 });
    } finally {
      collector.close();
    }
  });

  test('MERIDIAN_TELEMETRY=1 enables local recording', () => {
    cleanup();
    const collector = new TelemetryCollector(TEST_DB_PATH, { env: { MERIDIAN_TELEMETRY: '1' } });
    try {
      assert.equal(collector.isEnabled(), true);
      const result = collector.record('project_create', { project_id: 'p1', template: 'blank' });
      assert.deepEqual(result, { recorded: true });

      const summary = collector.summarize();
      assert.equal(summary.total, 1);
      assert.equal(summary.byEvent.project_create, 1);
    } finally {
      collector.close();
    }
  });

  test('MERIDIAN_TELEMETRY_OPT_IN=true also enables recording', () => {
    cleanup();
    const collector = new TelemetryCollector(TEST_DB_PATH, { env: { MERIDIAN_TELEMETRY_OPT_IN: 'true' } });
    try {
      assert.equal(collector.isEnabled(), true);
    } finally {
      collector.close();
    }
  });

  test('summarize aggregates multiple events by name within the trailing window', () => {
    cleanup();
    const collector = new TelemetryCollector(TEST_DB_PATH, { env: { MERIDIAN_TELEMETRY: '1' } });
    try {
      collector.record('project_create', { project_id: 'p1' });
      collector.record('project_create', { project_id: 'p2' });
      collector.record('project_start', { project_id: 'p1' });

      const summary = collector.summarize({ days: 30 });
      assert.equal(summary.total, 3);
      assert.equal(summary.byEvent.project_create, 2);
      assert.equal(summary.byEvent.project_start, 1);
    } finally {
      collector.close();
    }
  });

  test('recorded events never leave the local DB — no network call is ever made', () => {
    cleanup();
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (...args) => { fetchCalled = true; return originalFetch(...args); };
    const collector = new TelemetryCollector(TEST_DB_PATH, { env: { MERIDIAN_TELEMETRY: '1' } });
    try {
      collector.record('project_create', { project_id: 'p1' });
      collector.summarize();
      assert.equal(fetchCalled, false, 'telemetry must never call fetch/network');
    } finally {
      globalThis.fetch = originalFetch;
      collector.close();
    }
  });

  test('a malformed payload does not throw — telemetry never breaks the caller', () => {
    cleanup();
    const collector = new TelemetryCollector(TEST_DB_PATH, { env: { MERIDIAN_TELEMETRY: '1' } });
    try {
      // Circular reference can't be JSON.stringified — record() must swallow the error.
      const circular = {};
      circular.self = circular;
      const result = collector.record('bad_event', circular);
      assert.equal(result.recorded, false);
      assert.equal(result.reason, 'error');
    } finally {
      collector.close();
    }
  });
});
