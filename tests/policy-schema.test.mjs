import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOperationsPolicy, validateOperationsPolicy } from '../dashboard/policy-schema.mjs';
import { validatePolicy } from '../policy-validate.mjs';

test('operations policy supplies safe defaults', () => {
  assert.deepEqual(resolveOperationsPolicy({}), {
    alertRetentionDays: 365, auditRetentionDays: 365, runPageDefault: 50, runPageMax: 200,
    pollingIntervalMs: 10000,
    sse: { enabled: true, maxConnections: 32, replayEvents: 1000, heartbeatMs: 15000, failureThreshold: 3 },
  });
});

test('operations policy validates bounds and retention relationship', () => {
  assert.equal(validateOperationsPolicy({ dashboard: { operations: { run_page_default: 100, run_page_max: 50 } } }).ok, false);
  assert.equal(validateOperationsPolicy({ dashboard: { operations: { polling_interval_ms: 1000 } } }).ok, false);
  assert.equal(validateOperationsPolicy({ dashboard: { operations: { alert_retention_days: 30, audit_retention_days: 365 } } }).ok, false);
  assert.equal(validateOperationsPolicy({ dashboard: { operations: { run_page_default: 25, run_page_max: 100 } } }).ok, true);
  assert.match(validatePolicy({ dashboard: { operations: { polling_interval_ms: 1000 } } }).errors.join('; '), /polling_interval_ms/);
});
