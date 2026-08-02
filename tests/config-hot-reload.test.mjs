import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  watchPolicy,
  unwatchPolicy,
  unwatchAll,
  getHotReloadedConfig,
  pickHotReloadable,
  HOT_RELOADABLE_PATHS
} from '../config-hot-reload.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = path.join(__dirname, '.test-hot-reload-policy.yaml');

const VALID_POLICY = `version: 1
kill_switch: false
work:
  max_parallel: 3
  wip_per_agent: 2
agent_budget:
  warn_pct: 80
quiet_hours:
  enabled: false
  from: "01:00"
  to: "07:00"
schedule:
  cadence: hourly
auto_merge: founder_only
sensitive_actions:
  deploy: block_and_ask
`;

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor: timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe('config-hot-reload', () => {
  after(() => {
    unwatchAll();
    if (fs.existsSync(POLICY_PATH)) fs.unlinkSync(POLICY_PATH);
  });

  test('pickHotReloadable projects only the whitelisted dotted paths', () => {
    const full = { work: { max_parallel: 5, secret_internal: 'x' }, gateway: { tenant: 'acme' } };
    const picked = pickHotReloadable(full, ['work.max_parallel']);
    assert.deepEqual(picked, { work: { max_parallel: 5 } });
    assert.equal(picked.gateway, undefined);
  });

  test('HOT_RELOADABLE_PATHS excludes security-sensitive fields', () => {
    for (const critical of ['gateway.tenant', 'kill_switch', 'jwt', 'secret']) {
      assert.ok(!HOT_RELOADABLE_PATHS.includes(critical), `${critical} must not be hot-reloadable`);
    }
  });

  test('watchPolicy returns an initial snapshot synchronously', () => {
    fs.writeFileSync(POLICY_PATH, VALID_POLICY);
    const snapshot = watchPolicy(POLICY_PATH);
    assert.equal(snapshot.work.max_parallel, 3);
    assert.equal(snapshot.quiet_hours.enabled, false);
    unwatchPolicy(POLICY_PATH);
  });

  test('watchPolicy is idempotent for an already-watched path', () => {
    fs.writeFileSync(POLICY_PATH, VALID_POLICY);
    const a = watchPolicy(POLICY_PATH);
    const b = watchPolicy(POLICY_PATH);
    assert.equal(a, b); // same object reference — second call was a no-op
    unwatchPolicy(POLICY_PATH);
  });

  test('a live edit to policy.yaml updates the hot-reloaded snapshot', async () => {
    fs.writeFileSync(POLICY_PATH, VALID_POLICY);
    watchPolicy(POLICY_PATH);
    assert.equal(getHotReloadedConfig(POLICY_PATH).work.max_parallel, 3);

    fs.writeFileSync(POLICY_PATH, VALID_POLICY.replace('max_parallel: 3', 'max_parallel: 9'));

    await waitFor(() => getHotReloadedConfig(POLICY_PATH).work.max_parallel === 9);
    assert.equal(getHotReloadedConfig(POLICY_PATH).work.max_parallel, 9);
    unwatchPolicy(POLICY_PATH);
  });

  test('an invalid edit is ignored — last-known-good snapshot is kept', async () => {
    fs.writeFileSync(POLICY_PATH, VALID_POLICY);
    watchPolicy(POLICY_PATH);
    assert.equal(getHotReloadedConfig(POLICY_PATH).schedule.cadence, 'hourly');

    // An invalid cadence value fails validatePolicySchema.
    fs.writeFileSync(POLICY_PATH, VALID_POLICY.replace('cadence: hourly', 'cadence: not_a_real_cadence'));

    let sawInvalid = false;
    // Give the debounced watcher a beat to process the change, then assert it did NOT adopt it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const current = getHotReloadedConfig(POLICY_PATH);
    assert.equal(current.schedule.cadence, 'hourly', 'invalid edit must not overwrite the last-known-good snapshot');
    unwatchPolicy(POLICY_PATH);
  });

  test('unwatchPolicy stops future updates from being picked up', async () => {
    fs.writeFileSync(POLICY_PATH, VALID_POLICY);
    watchPolicy(POLICY_PATH);
    unwatchPolicy(POLICY_PATH);
    assert.deepEqual(getHotReloadedConfig(POLICY_PATH), {}); // watcher state was cleared

    fs.writeFileSync(POLICY_PATH, VALID_POLICY.replace('max_parallel: 3', 'max_parallel: 42'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(getHotReloadedConfig(POLICY_PATH), {}, 'no watcher means no snapshot at all');
  });

  test('getHotReloadedConfig returns {} for a path never watched', () => {
    assert.deepEqual(getHotReloadedConfig('/nonexistent/policy.yaml'), {});
  });

  test('watchPolicy on a nonexistent file returns {} without throwing', () => {
    const missing = path.join(__dirname, '.test-hot-reload-missing.yaml');
    const snapshot = watchPolicy(missing);
    assert.deepEqual(snapshot, {});
    unwatchPolicy(missing);
  });
});
