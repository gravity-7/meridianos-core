const DEFAULTS = Object.freeze({
  alertRetentionDays: 365,
  auditRetentionDays: 365,
  runPageDefault: 50,
  runPageMax: 200,
  pollingIntervalMs: 10_000,
  sse: Object.freeze({ enabled: true, maxConnections: 32, replayEvents: 1000, heartbeatMs: 15_000, failureThreshold: 3 }),
});

const int = (value, fallback) => Number.isInteger(Number(value)) ? Number(value) : fallback;

export function resolveOperationsPolicy(policy = {}) {
  const ops = policy?.dashboard?.operations ?? {};
  const sse = ops.sse ?? {};
  return {
    alertRetentionDays: int(ops.alert_retention_days, DEFAULTS.alertRetentionDays),
    auditRetentionDays: int(ops.audit_retention_days, DEFAULTS.auditRetentionDays),
    runPageDefault: int(ops.run_page_default, DEFAULTS.runPageDefault),
    runPageMax: int(ops.run_page_max, DEFAULTS.runPageMax),
    pollingIntervalMs: int(ops.polling_interval_ms, DEFAULTS.pollingIntervalMs),
    sse: {
      enabled: sse.enabled !== false,
      maxConnections: int(sse.max_connections, DEFAULTS.sse.maxConnections),
      replayEvents: int(sse.replay_events, DEFAULTS.sse.replayEvents),
      heartbeatMs: int(sse.heartbeat_ms, DEFAULTS.sse.heartbeatMs),
      failureThreshold: int(sse.failure_threshold, DEFAULTS.sse.failureThreshold),
    },
  };
}

export function validateOperationsPolicy(policy = {}) {
  const value = resolveOperationsPolicy(policy);
  const errors = [];
  if (value.alertRetentionDays < 1 || value.alertRetentionDays > 3650) errors.push('dashboard.operations.alert_retention_days must be 1–3650');
  if (value.auditRetentionDays < 1 || value.auditRetentionDays > 3650) errors.push('dashboard.operations.audit_retention_days must be 1–3650');
  if (value.alertRetentionDays < value.auditRetentionDays) errors.push('dashboard.operations.alert_retention_days must be at least audit_retention_days');
  if (value.runPageDefault < 1 || value.runPageDefault > value.runPageMax) errors.push('dashboard.operations.run_page_default must be 1..run_page_max');
  if (value.runPageMax < 1 || value.runPageMax > 200) errors.push('dashboard.operations.run_page_max must be 1–200');
  if (value.pollingIntervalMs < 5000 || value.pollingIntervalMs > 300_000) errors.push('dashboard.operations.polling_interval_ms must be 5000–300000');
  if (value.sse.maxConnections < 1 || value.sse.maxConnections > 1000) errors.push('dashboard.operations.sse.max_connections must be 1–1000');
  if (value.sse.replayEvents < 1 || value.sse.replayEvents > 100_000) errors.push('dashboard.operations.sse.replay_events must be 1–100000');
  if (value.sse.heartbeatMs < 5000 || value.sse.heartbeatMs > 300_000) errors.push('dashboard.operations.sse.heartbeat_ms must be 5000–300000');
  if (value.sse.failureThreshold < 1 || value.sse.failureThreshold > 10) errors.push('dashboard.operations.sse.failure_threshold must be 1–10');
  return { ok: errors.length === 0, errors, value };
}

export { DEFAULTS as DEFAULT_OPERATIONS_POLICY };
