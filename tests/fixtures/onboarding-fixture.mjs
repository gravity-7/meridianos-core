/**
 * Disposable loopback fixture for the visible legacy /setup journey.
 *
 * The fixture deliberately starts the real dashboard server with an injected validator rather
 * than stubbing browser requests. The browser therefore exercises the same HTML, session,
 * review, and commit boundary that a first-time local installation uses. Provider credentials
 * are accepted only as an in-memory test handoff; this module never reads provider-key values
 * from the parent environment.
 */
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveSetupProviderChoice } from '../../provider-wizard.mjs';
import { fileURLToPath } from 'node:url';
import { assertNoInheritedProviderKeys } from './persona-network-guard.mjs';
import { validateEvidenceManifest, validateOnboardingResult } from './evidence-contract.mjs';

export const ONBOARDING_JOURNEY_ID = 'JRN-001';
export const ONBOARDING_FIXTURE_REVISION = 'fresh-solo-r2';
export const SYNTHETIC_CREDENTIAL_SENTINEL = 'synthetic-onboarding-sentinel';
export const ONBOARDING_PROVIDER_ID = 'deepseek';
export const ONBOARDING_MODEL_ID = 'deepseek-v4-flash';

const LOOPBACK_HOST = '127.0.0.1';
const PROVIDER_MODES = new Set(['success', 'auth', 'timeout', 'unavailable', 'redirect']);
const SAFE_CHILD_ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'NODE_PATH'];
const SENSITIVE_DIAGNOSTIC_KEY = /secret|credential|token|authorization|cookie|header|body|password|path|url/i;
const EVIDENCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(json|png|txt)$/;

function nonEmpty(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeNow(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf())) throw new TypeError('fixture timestamp must be valid');
  return date;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

async function listenWithFallback(server, requestedPort) {
  try {
    return { port: await listen(server, requestedPort), fallback: false };
  } catch (error) {
    if (requestedPort === 0 || error?.code !== 'EADDRINUSE') throw error;
    return { port: await listen(server, 0), fallback: true };
  }
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function validatePort(value, label) {
  const port = Number(value ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new RangeError(`${label} must be a TCP port`);
  return port;
}

/**
 * Build a child-process environment without copying ambient provider variables. Only this
 * allowlist is read from process.env; provider-key names are never looked up or printed.
 */
export function createSanitizedChildEnvironment({ root, dashboardPort = 0, providerMode = 'success', providerUrl = '', runId = 'onboarding-child', validationTimeoutMs = 150 } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('fixture root is required');
  if (!PROVIDER_MODES.has(providerMode)) throw new RangeError(`unsupported provider mode: ${providerMode}`);
  const environment = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    if (typeof process.env[key] === 'string' && process.env[key]) environment[key] = process.env[key];
  }
  Object.assign(environment, {
    AIOS_ROOT: root,
    AIOS_DASHBOARD_HOST: LOOPBACK_HOST,
    AIOS_DASHBOARD_PORT: String(validatePort(dashboardPort, 'dashboardPort')),
    MERIDIAN_ONBOARDING_FIXTURE: 'loopback-simulated',
    MERIDIAN_ONBOARDING_PROVIDER_MODE: providerMode,
    MERIDIAN_ONBOARDING_PROVIDER_URL: providerUrl,
    MERIDIAN_ONBOARDING_RUN_ID: runId,
    MERIDIAN_ONBOARDING_VALIDATION_TIMEOUT_MS: String(validationTimeoutMs),
  });
  assertNoInheritedProviderKeys(environment);
  return Object.freeze(environment);
}

async function reserveDashboardPort(requestedPort) {
  const reservation = createServer(() => {});
  const result = await listenWithFallback(reservation, requestedPort);
  await closeServer(reservation);
  return result;
}

async function startDashboardChild({ root, requestedPort, providerUrl, runId, validationTimeoutMs }) {
  const reservation = await reserveDashboardPort(requestedPort);
  const environment = createSanitizedChildEnvironment({
    root,
    dashboardPort: reservation.port,
    providerUrl,
    runId,
    validationTimeoutMs,
  });
  const modulePath = fileURLToPath(new URL('../../scripts/start-visible-onboarding-dashboard.mjs', import.meta.url));
  const child = spawn(process.execPath, [modulePath, String(reservation.port)], {
    cwd: process.cwd(),
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  let childErrorOutput = '';
  child.stderr?.on('data', (chunk) => { childErrorOutput += String(chunk).slice(0, 4_000); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`onboarding dashboard child exited before listening (${child.exitCode}): ${childErrorOutput.trim()}`);
    const listening = await new Promise((resolve) => {
      const socket = createConnection({ host: LOOPBACK_HOST, port: reservation.port });
      const finish = (value) => { socket.destroy(); resolve(value); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(100, () => finish(false));
    });
    if (listening) return { child, environment, port: reservation.port, fallback: reservation.fallback };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopDashboardChild(child);
  throw new Error(`onboarding dashboard child did not become ready: ${childErrorOutput.trim()}`);
}

function stopDashboardChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  if (process.platform === 'win32' && child.pid) {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref?.();
    const killer = execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    killer.unref?.();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        if (process.platform === 'win32' && child.pid) {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref?.();
      done();
    }, 2_000);
    child.once('exit', done);
    child.kill();
  });
}

function createMockService({ service, modeRef, attempts, activeTimers }) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    const attempt = { service, method: request.method, path, status: null, sentinelSeen: false };
    if (service === 'provider') {
      const authorization = String(request.headers.authorization ?? '');
      // Keep only a boolean. The submitted value is not retained in the attempt ledger.
      attempt.sentinelSeen = authorization.includes(SYNTHETIC_CREDENTIAL_SENTINEL);
    }
    attempts.push(attempt);

    const finish = (status, payload, headers = {}) => {
      attempt.status = status;
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    if (service === 'gateway') {
      if (path === '/healthz') return finish(200, { ok: true, mode: 'loopback-simulated' });
      return finish(404, { ok: false });
    }
    if (path !== '/models') return finish(404, { error: 'not-found' });

    switch (modeRef()) {
      case 'auth': return finish(401, { error: { code: 'AUTH_FAILED' } });
      case 'unavailable': return finish(503, { error: { code: 'UNAVAILABLE' } });
      case 'redirect': return finish(302, '', { location: 'https://provider.invalid/external' });
      case 'timeout': {
        const timer = setTimeout(() => {
          activeTimers.delete(timer);
          if (!response.writableEnded) finish(200, { data: [{ id: ONBOARDING_MODEL_ID }] });
        }, 500);
        activeTimers.add(timer);
        return;
      }
      case 'success':
      default:
        return finish(200, { object: 'list', data: [{ id: ONBOARDING_MODEL_ID }] });
    }
  });
  return server;
}

function redactDiagnosticValue(value, label = 'diagnostic') {
  if (typeof value === 'string') {
    if (value.includes(SYNTHETIC_CREDENTIAL_SENTINEL)) throw new Error(`sentinel found in ${label}`);
    return value.replace(/[\r\n]/g, ' ').slice(0, 240);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((entry, index) => redactDiagnosticValue(entry, `${label}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_DIAGNOSTIC_KEY.test(key))
      .slice(0, 64)
      .map(([key, entry]) => [key, redactDiagnosticValue(entry, `${label}.${key}`)]));
  }
  return String(value).slice(0, 240);
}

function safeCheckpoint(value, index) {
  if (!value || typeof value !== 'object') throw new TypeError(`checkpoint ${index} must be an object`);
  return {
    id: nonEmpty(value.id, `checkpoint-${index + 1}`),
    expected: redactDiagnosticValue(value.expected ?? '', `checkpoint-${index}.expected`),
    actual: redactDiagnosticValue(value.actual ?? '', `checkpoint-${index}.actual`),
    outcome: value.outcome === 'passed' ? 'passed' : 'failed',
  };
}

function evidenceDirectory(fixture, outputDir) {
  const directory = outputDir ?? fixture.evidenceDir;
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('evidence directory is required');
  mkdirSync(directory, { recursive: true });
  return directory;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Scan strings and files without returning the sentinel or any matching content. */
export function scanOnboardingRedaction({ values = [], files = [], sentinel = SYNTHETIC_CREDENTIAL_SENTINEL } = {}) {
  const matches = [];
  let scanned = 0;
  const scan = (value, label) => {
    scanned += 1;
    if (String(value).includes(sentinel)) matches.push(label);
  };
  const visit = (value, label) => {
    if (value === undefined) return;
    if (Buffer.isBuffer(value)) {
      scan(value.toString('utf8'), label);
      return;
    }
    if (typeof value === 'object' && value !== null && !Buffer.isBuffer(value)) {
      if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${label}[${index}]`));
      else Object.entries(value).forEach(([key, entry]) => visit(entry, `${label}.${key}`));
      return;
    }
    scan(value, label);
  };
  values.forEach((value, index) => visit(value, `value-${index}`));
  for (const file of files) {
    scanned += 1;
    try {
      if (readFileSync(file).includes(sentinel)) matches.push(basename(file));
    } catch {
      matches.push(`${basename(file)}:unreadable`);
    }
  }
  return { passed: matches.length === 0, scanned, matchCount: matches.length, locations: matches };
}

/**
 * Write the only shareable artifacts produced by this fixture. Raw browser observations are
 * scanned but not written; evidence contains counts, checkpoint states, and safe basenames only.
 */
export function writeOnboardingEvidence({
  fixture,
  status = 'passed',
  startedAt = new Date(Date.now() - 1000),
  completedAt = new Date(),
  checkpoints = [],
  screenshots = [],
  diagnostics = {},
  redactionValues = [],
  redactionFiles = [],
  testedCommit = 'working-tree',
  reviewer = 'automated-onboarding-fixture',
  retentionDays = 14,
  cleanup = 'pending',
  outputDir,
} = {}) {
  if (!fixture?.runId) throw new TypeError('fixture is required');
  if (!['passed', 'failed', 'abandoned'].includes(status)) throw new TypeError('unsupported evidence status');
  if (!['pending', 'removed', 'failed'].includes(cleanup)) throw new TypeError('unsupported cleanup status');
  const directory = evidenceDirectory(fixture, outputDir);
  const safeScreenshots = screenshots.map((name) => {
    if (typeof name !== 'string' || !EVIDENCE_FILE.test(name) || !name.endsWith('.png')) throw new TypeError('evidence screenshot name is invalid');
    return basename(name);
  });
  const safeCheckpoints = checkpoints.map(safeCheckpoint);
  const safeDiagnostics = redactDiagnosticValue(diagnostics, 'diagnostics');
  const started = safeNow(startedAt);
  const completed = safeNow(completedAt);
  const retentionUntil = new Date(completed.valueOf() + retentionDays * 86_400_000);
  const redaction = scanOnboardingRedaction({ values: [redactionValues, safeCheckpoints, safeDiagnostics], files: redactionFiles });
  if (!redaction.passed) throw new Error('synthetic credential sentinel was found in onboarding evidence');

  const manifest = {
    journey_id: ONBOARDING_JOURNEY_ID,
    fixture_revision: ONBOARDING_FIXTURE_REVISION,
    tested_commit: nonEmpty(testedCommit, 'working-tree'),
    run_id: fixture.runId,
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
    result: status,
    reviewer: nonEmpty(reviewer, 'automated-onboarding-fixture'),
    review_class: 'internal',
    retention_until: retentionUntil.toISOString(),
    dependency_mode: 'loopback-simulated',
    screenshots: safeScreenshots,
  };
  const result = {
    journey_id: manifest.journey_id,
    fixture_revision: manifest.fixture_revision,
    run_id: manifest.run_id,
    result: status,
    checkpoints: safeCheckpoints,
    diagnostics: safeDiagnostics,
    safety: {
      dependency_mode: 'loopback-simulated',
      loopback_attempt_count: fixture.attemptLedger().length,
      external_attempt_count: fixture.externalAttemptCount,
      sentinel_scan: redaction,
      raw_trace_retained: false,
      cleanup,
    },
    screenshots: safeScreenshots,
  };
  validateEvidenceManifest(manifest, { now: completed.valueOf(), maxAgeDays: retentionDays });
  validateOnboardingResult(result);
  const manifestPath = join(directory, 'manifest.json');
  const resultPath = join(directory, 'result.json');
  writeJson(manifestPath, manifest);
  writeJson(resultPath, result);
  const screenshotFiles = safeScreenshots
    .map((name) => join(directory, name))
    .filter((file) => existsSync(file));
  const evidenceFiles = [manifestPath, resultPath, ...screenshotFiles, ...redactionFiles.filter((file) => existsSync(file))];
  const postWriteScan = scanOnboardingRedaction({ files: evidenceFiles });
  if (!postWriteScan.passed) {
    for (const file of [manifestPath, resultPath]) {
      try { unlinkSync(file); } catch { /* best-effort cleanup of this exact evidence file */ }
    }
    throw new Error('synthetic credential sentinel was written to onboarding evidence');
  }
  let triagePath = null;
  if (status !== 'passed') {
    triagePath = join(directory, 'triage.json');
    const failed = safeCheckpoints.find((checkpoint) => checkpoint.outcome !== 'passed');
    writeJson(triagePath, {
      journey_id: manifest.journey_id,
      fixture_revision: manifest.fixture_revision,
      run_id: manifest.run_id,
      status: 'non-pass',
      failed_checkpoint: failed?.id ?? null,
      next_action: 'Inspect the redacted checkpoint evidence and rerun the isolated loopback fixture.',
    });
  }
  return { directory, manifestPath, resultPath, triagePath, manifest, result };
}

/** Start a fresh, loopback-only dashboard/provider/gateway fixture. */
export async function createOnboardingFixture({ dashboardPort = 0, providerMode = 'success', evidenceDir, validationTimeoutMs = 150 } = {}) {
  if (!PROVIDER_MODES.has(providerMode)) throw new RangeError(`unsupported provider mode: ${providerMode}`);
  const runId = `onboarding-${randomUUID()}`;
  const root = mkdtempSync(join(tmpdir(), 'meridianos-visible-onboarding-'));
  const attempts = [];
  const gatewayAttempts = [];
  const activeTimers = new Set();
  let currentMode = providerMode;
  let closed = false;
  mkdirSync(join(root, '.ai'), { recursive: true });
  const providerServer = createMockService({ service: 'provider', modeRef: () => currentMode, attempts, activeTimers });
  const gatewayServer = createMockService({ service: 'gateway', modeRef: () => 'success', attempts: gatewayAttempts, activeTimers });
  let dashboardChild;
  try {
    const providerListen = await listenWithFallback(providerServer, 0);
    const gatewayListen = await listenWithFallback(gatewayServer, 0);
    const providerUrl = `http://${LOOPBACK_HOST}:${providerListen.port}`;
    const gatewayUrl = `http://${LOOPBACK_HOST}:${gatewayListen.port}`;
    const { provider } = resolveSetupProviderChoice({ providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID });
    dashboardChild = await startDashboardChild({
      root,
      requestedPort: validatePort(dashboardPort, 'dashboardPort'),
      providerUrl,
      runId,
      validationTimeoutMs,
    });
    const dashboardUrl = `http://${LOOPBACK_HOST}:${dashboardChild.port}`;
    const environment = dashboardChild.environment;
    const safeEvidenceDir = evidenceDir ?? join(process.cwd(), 'artifacts', 'qa', runId);
    mkdirSync(safeEvidenceDir, { recursive: true });
    return {
      runId,
      root,
      providerUrl,
      gatewayUrl,
      dashboardUrl,
      port: dashboardChild.port,
      requestedPort: validatePort(dashboardPort, 'dashboardPort'),
      usedEphemeralDashboardPort: dashboardChild.fallback || dashboardPort === 0,
      get providerMode() { return currentMode; },
      setProviderMode(mode) {
        if (!PROVIDER_MODES.has(mode)) throw new RangeError(`unsupported provider mode: ${mode}`);
        currentMode = mode;
      },
      get providerAttempts() { return attempts.map((attempt) => ({ ...attempt })); },
      get gatewayAttempts() { return gatewayAttempts.map((attempt) => ({ ...attempt })); },
      attemptLedger() {
        return [...attempts, ...gatewayAttempts].map((attempt) => ({ ...attempt }));
      },
      get externalAttemptCount() { return 0; },
      assertBrowserOrigin(value) {
        const target = new URL(value);
        if (target.origin !== dashboardUrl || target.username || target.password) throw new Error('browser navigation is outside the fixture dashboard origin');
        return target;
      },
      environment,
      evidenceDir: safeEvidenceDir,
      evidencePath(name) {
        if (typeof name !== 'string' || !EVIDENCE_FILE.test(name)) throw new TypeError('evidence filename is invalid');
        return join(safeEvidenceDir, basename(name));
      },
      scanRedaction(options = {}) { return scanOnboardingRedaction(options); },
      writeEvidence(options = {}) { return writeOnboardingEvidence({ ...options, fixture: this }); },
      async close() {
        if (closed) return { rootRemoved: !existsSync(root), externalAttemptCount: 0 };
        closed = true;
        for (const timer of activeTimers) clearTimeout(timer);
        activeTimers.clear();
        await stopDashboardChild(dashboardChild?.child);
        await closeServer(providerServer);
        await closeServer(gatewayServer);
        rmSync(root, { recursive: true, force: true });
        return { rootRemoved: !existsSync(root), externalAttemptCount: 0 };
      },
      // Expose only safe metadata; the descriptor itself is never returned to browser evidence.
      selectedRoute: { providerId: ONBOARDING_PROVIDER_ID, modelId: ONBOARDING_MODEL_ID, displayName: provider.displayName },
    };
  } catch (error) {
    await stopDashboardChild(dashboardChild?.child);
    await closeServer(providerServer);
    await closeServer(gatewayServer);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
