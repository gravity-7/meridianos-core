import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createCloudServer, openCloudDb } from '../../cloud/cloud-server.mjs';
import { createOrganization, createUser, registerMachine, reportMetadata, aggregateProviderHealth } from '../../cloud/cloud-control-plane.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const PROVIDER_ENV_NAME = /(?:^|_)(?:DEEPSEEK|ZAI|GLM|OPENAI|ANTHROPIC|STRIPE|SENDGRID|MAILGUN|POSTMARK)(?:_|$)/i;
const UNSAFE_EVIDENCE = /(?:password|credential|secret|token|authorization|bearer\s+|api[ _-]?key|raw(?:\s|_|-)?(?:body|content|request|response)?|customer)/i;
const SAFE_CHECKPOINT_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SAFE_STATUSES = new Set(['passed', 'failed', 'abandoned']);

const SYNTHETIC_TELEMETRY = Object.freeze({
  classification: 'local-synthetic',
  scope: Object.freeze({ project: 'northstar-demo', provider: 'synthetic_control' }),
  points: Object.freeze([
    Object.freeze({ at: '2026-08-18T10:00:00.000Z', requests: 12, errors: 0, latencyP95Ms: 180, tokens: 1_200, costUsd: 0.12 }),
    Object.freeze({ at: '2026-08-18T10:05:00.000Z', requests: 18, errors: 1, latencyP95Ms: 240, tokens: 1_680, costUsd: 0.17 }),
    Object.freeze({ at: '2026-08-18T10:10:00.000Z', requests: 15, errors: 0, latencyP95Ms: 205, tokens: 1_440, costUsd: 0.14 }),
  ]),
  alerts: Object.freeze([{ id: 'demo-alert-latency', severity: 'warning', title: 'Synthetic latency sample' }]),
  work: Object.freeze({ activeAgents: 2, queuedTasks: 3, failedRuns: 0, blockedTasks: 0 }),
  budget: Object.freeze({ spendUsd: 0.43, monthlyLimitUsd: 25 }),
});

export const DEMO_CHECKPOINTS = Object.freeze([
  { id: 'client-login', route: '/', expected: 'Fixture-only local root sign-in is visible.', pause: true, recovery: 'Stop and restart the fixture from a clean session.' },
  { id: 'client-health', route: '/', expected: 'Connected fictional machines and aggregate synthetic health are visible.', pause: true, recovery: 'Stop and restart if data does not load.' },
  { id: 'client-preview', route: '/', expected: 'Eligible targets are shown and no policy has been pushed.', pause: true, recovery: 'Discard the run and restart if preview fails.' },
  { id: 'client-confirmation', route: '/', expected: 'Explicit confirmation and rollback-boundary wording are visible.', pause: true, recovery: 'Stop by default; never imply an external effect.' },
  { id: 'client-cleanup', route: '/', expected: 'Temporary fixture root and database are removed.', pause: false, recovery: 'Do not reuse the fixture; start a new session.' },
]);

function validatePort(port) {
  if (!Number.isInteger(port)) throw new TypeError('the selected port must be an integer');
  if (port < 0 || port > 65_535) throw new RangeError('the selected port must be between 0 and 65535');
  return port;
}

function rejectProviderEnvironment() {
  // Deliberately inspect names only: no inherited secret value is read, logged, or retained.
  if (Object.keys(process.env).some((name) => PROVIDER_ENV_NAME.test(name))) {
    throw new Error('provider-related environment variables are not allowed for client demo');
  }
}

function assertOptions(options) {
  const allowed = new Set(['port']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new TypeError(`unsupported fixture option: ${key}`);
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function assertSafeEvidence(value, label = 'evidence') {
  if (typeof value === 'string') {
    if (UNSAFE_EVIDENCE.test(value)) throw new TypeError(`unsafe evidence content in ${label}`);
    return value.replace(/[\r\n]/g, ' ').slice(0, 240);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((entry, index) => assertSafeEvidence(entry, `${label}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (UNSAFE_EVIDENCE.test(key)) throw new TypeError(`unsafe evidence field: ${key}`);
      return [key, assertSafeEvidence(entry, `${label}.${key}`)];
    }));
  }
  if (value === undefined) return undefined;
  throw new TypeError(`unsafe evidence value in ${label}`);
}

function safeCheckpoint(checkpoint, index) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) throw new TypeError(`unsafe evidence checkpoint ${index}`);
  const allowed = new Set(['id', 'expected', 'outcome']);
  for (const key of Object.keys(checkpoint)) if (!allowed.has(key)) throw new TypeError(`unsafe evidence field: ${key}`);
  if (!SAFE_CHECKPOINT_ID.test(checkpoint.id ?? '')) throw new TypeError(`unsafe evidence checkpoint id: ${index}`);
  if (checkpoint.outcome !== 'passed' && checkpoint.outcome !== 'failed') throw new TypeError(`unsafe evidence checkpoint outcome: ${index}`);
  return {
    id: checkpoint.id,
    expected: assertSafeEvidence(String(checkpoint.expected ?? ''), `checkpoint-${index}.expected`),
    outcome: checkpoint.outcome,
  };
}

function safeTime(value, fallback) {
  const date = value === undefined ? fallback : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new TypeError('unsafe evidence timestamp');
  return date.toISOString();
}

export function writeDemoEvidence({ fixture, status = 'passed', checkpoints = [], cleanup = 'pending', startedAt, endedAt, ...extra } = {}) {
  if (!fixture?.runId || fixture.workflow !== 'client-operations') throw new TypeError('client demo fixture is required');
  if (Object.keys(extra).length) throw new TypeError(`unsafe evidence field: ${Object.keys(extra)[0]}`);
  if (!SAFE_STATUSES.has(status)) throw new TypeError('unsafe evidence status');
  if (!['pending', 'removed', 'failed'].includes(cleanup)) throw new TypeError('unsafe evidence cleanup result');
  const safeCheckpoints = checkpoints.map(safeCheckpoint);
  const started = safeTime(startedAt, fixture.startedAt);
  const ended = safeTime(endedAt, new Date());
  const manifest = {
    run_id: fixture.runId,
    workflow: fixture.workflow,
    classification: 'local-synthetic',
    route: '/',
    result: status,
    started_at: started,
    ended_at: ended,
    owner_role: 'Demo Engineering',
    redaction_status: 'passed',
  };
  const result = {
    run_id: fixture.runId,
    workflow: fixture.workflow,
    result: status,
    checkpoints: safeCheckpoints,
    cleanup,
    external_request_count: fixture.externalAttemptCount,
    raw_trace_retained: false,
  };
  mkdirSync(fixture.evidenceDir, { recursive: true });
  const manifestPath = join(fixture.evidenceDir, 'manifest.json');
  const resultPath = join(fixture.evidenceDir, 'result.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  let triagePath = null;
  if (status !== 'passed') {
    triagePath = join(fixture.evidenceDir, 'triage.json');
    writeFileSync(triagePath, `${JSON.stringify({ run_id: fixture.runId, status, next_action: 'Close the isolated fixture and restart a clean local demonstration.' }, null, 2)}\n`, 'utf8');
  }
  return { directory: fixture.evidenceDir, manifestPath, resultPath, triagePath, manifest, result };
}

export async function createClientDemoFixture(options = {}) {
  assertOptions(options);
  const port = validatePort(options.port ?? 0);
  rejectProviderEnvironment();
  const runId = `client-demo-${randomUUID()}`;
  const root = mkdtempSync(join(tmpdir(), 'meridianos-client-demo-'));
  const dbPath = join(root, 'cloud-control-plane.sqlite');
  const evidenceDir = join(process.cwd(), 'artifacts', 'qa', 'client-demo', runId);
  let db;
  let server;
  let closed = false;
  const startedAt = new Date();
  try {
    db = openCloudDb(dbPath);
    const organization = createOrganization(db, 'Northstar Demonstration Cooperative');
    const credentials = { email: 'demo-admin@synthetic.invalid', password: 'fixture-only-passphrase' };
    await createUser(db, { orgId: organization.id, ...credentials, role: 'admin' });
    const machines = [
      registerMachine(db, { orgId: organization.id, name: 'aurora-console', osType: 'windows', meridianosVersion: '0.3.9-demo' }),
      registerMachine(db, { orgId: organization.id, name: 'beacon-laptop', osType: 'linux', meridianosVersion: '0.3.9-demo' }),
    ];
    for (const machine of machines) {
      reportMetadata(db, machine.apiKey, { providerHealth: [{ provider: 'synthetic_control', status: 'ok' }] });
    }
    const health = aggregateProviderHealth(db, organization.id);
    server = createCloudServer(db);
    const actualPort = await listen(server, port);
    const dashboardUrl = `http://${LOOPBACK_HOST}:${actualPort}/`;
    const dataset = Object.freeze({
      label: 'synthetic, disposable client demo',
      organization: organization.name,
      machines: [{ name: 'aurora-console' }, { name: 'beacon-laptop' }],
      health,
    });
    const fixture = {
      runId,
      workflow: 'client-operations',
      root,
      dbPath,
      evidenceDir,
      dashboardUrl,
      port: actualPort,
      startedAt,
      credentials: Object.freeze({ ...credentials }),
      policyExample: Object.freeze({ path: 'agent_budget.warn_pct', value: 85 }),
      telemetry: SYNTHETIC_TELEMETRY,
      dataset,
      get externalAttemptCount() { return 0; },
      assertBrowserOrigin(value) {
        const target = new URL(value);
        if (target.origin !== dashboardUrl.slice(0, -1) || target.pathname !== '/' || target.search || target.hash || target.username || target.password) {
          throw new Error('browser navigation is outside the local fixture root route');
        }
        return target;
      },
      start() {
        if (closed) throw new Error('client demo fixture is already closed and cannot be reused');
        return this;
      },
      writeEvidence(result = {}) {
        if (closed) throw new Error('client demo fixture is already closed and cannot write evidence');
        return writeDemoEvidence({ fixture: this, ...result });
      },
      async close() {
        if (closed) return { rootRemoved: !existsSync(root), dbRemoved: !existsSync(dbPath) };
        closed = true;
        await closeServer(server).catch(() => {});
        db?.close();
        rmSync(root, { recursive: true, force: true });
        return { rootRemoved: !existsSync(root), dbRemoved: !existsSync(dbPath) };
      },
    };
    return fixture;
  } catch (error) {
    await closeServer(server).catch(() => {});
    db?.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
