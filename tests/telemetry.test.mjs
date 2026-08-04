/**
 * telemetry.test.mjs — T104: opt-in, local-only Phase 7 usage counters.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { createAios } from '../config.mjs';
import { recordEvent, recordBinaryInstalled, recordPluginInstalled, recordCloudConnected, summarize } from '../telemetry.mjs';

const { config } = createAios({ domain: { agents: ['claude', 'antigravity'] } });

describe('telemetry (T104)', () => {
  test('recordEvent is a no-op when telemetry is not explicitly enabled', () => {
    const db = openDb(':memory:', config);
    recordEvent(db, 'binary.installed', { platform: 'win32' }, { policy: {} });
    recordEvent(db, 'binary.installed', { platform: 'win32' }); // no policy at all
    assert.deepEqual(summarize(db), {});
  });

  test('recordEvent records when policy.telemetry.enabled is true', () => {
    const db = openDb(':memory:', config);
    const policy = { telemetry: { enabled: true } };
    recordBinaryInstalled(db, { platform: 'win32', mechanism: 'sc.exe' }, { policy });
    recordPluginInstalled(db, { pluginId: 'jira-source' }, { policy });
    recordPluginInstalled(db, { pluginId: 'linear-source' }, { policy });
    recordCloudConnected(db, { orgId: 'org-1' }, { policy });

    const counts = summarize(db);
    assert.deepEqual(counts, { 'binary.installed': 1, 'plugin.installed': 2, 'cloud.connected': 1 });
  });

  test('recordEvent never throws even if the db is unusable', () => {
    const brokenDb = { prepare() { throw new Error('boom'); } };
    assert.doesNotThrow(() => recordEvent(brokenDb, 'x', {}, { policy: { telemetry: { enabled: true } } }));
  });

  test('summarize only counts telemetry-sourced events (not the rest of the events table)', () => {
    const db = openDb(':memory:', config);
    db.prepare("INSERT INTO events (ts, level, source, event, detail) VALUES (?, 'info', 'scheduler', 'tick', NULL)").run(new Date().toISOString());
    recordBinaryInstalled(db, { platform: 'linux', mechanism: 'systemd' }, { policy: { telemetry: { enabled: true } } });
    assert.deepEqual(summarize(db), { 'binary.installed': 1 });
  });
});
