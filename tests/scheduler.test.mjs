/**
 * scheduler.test.mjs — unit tests for the crash-resilient AIOS daemon.
 *
 * Strategy: no real spawns, no real sockets, no real clock.
 *   • runWatchdogTick / runRunnerCycle are imported and called directly with
 *     all subsystem functions replaced by fast synchronous/async stubs.
 *   • The rotating logger is exercised against a temp directory so the real
 *     filesystem is used but isolated from the daemon's .ai/logs/.
 *   • The unhandledRejection guard is tested by temporarily patching the
 *     process listener list — we never actually trigger a real unhandled
 *     rejection in the test process itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRotatingLogger } from '../daemon-logger.mjs';

// ---------------------------------------------------------------------------
// Helper: build a minimal fake logger (captures calls, never writes to disk)
// ---------------------------------------------------------------------------
function fakeLogger() {
  const calls = [];
  return {
    log:   (tag, msg)       => calls.push({ level: 'log',   tag, msg }),
    error: (tag, msg, err)  => calls.push({ level: 'error', tag, msg, err }),
    close: ()               => {},
    calls,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal stub DB (enough for event-log's .prepare().run())
// ---------------------------------------------------------------------------
function stubDb() {
  return {
    prepare: () => ({ run: () => ({}), all: () => [], get: () => null }),
  };
}

// ---------------------------------------------------------------------------
// 1. Per-tick isolation — a throwing watchdog tick does NOT stop the daemon
// ---------------------------------------------------------------------------

test('runWatchdogTick: a throw inside any subsystem is caught; loop keeps going', async () => {
  const { runWatchdogTick } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  // _tick throws; everything else is a no-op stub
  const _tick = () => { throw new Error('simulated watchdog subsystem failure'); };
  const _plannerCycle   = () => ({ promoted: [] });
  const _pushEscalations = async () => ({ sent: 0 });
  const _verifyCycle    = async () => ({ merged: [], failed: [], pending: [] });
  const _selectModel    = () => 'stub-model';
  const _render         = () => {};
  const _loadMeta       = () => ({});
  const _loadPolicy     = () => ({ work: {}, schedule: {}, quiet_hours: { enabled: false } });
  const _pruneEvents    = () => {};
  const _pruneHistory   = () => {};

  // Must not throw — tick body catches internally
  await assert.doesNotReject(
    runWatchdogTick({
      db, logger, tickCount: 1, startedAt: Date.now(), dryRun: true,
      _tick, _plannerCycle, _pushEscalations, _verifyCycle,
      _selectModel, _render, _loadMeta, _loadPolicy, _pruneEvents, _pruneHistory,
    }),
  );

  // The error must have been surfaced to the logger
  const errEntry = logger.calls.find(c => c.level === 'error');
  assert.ok(errEntry, 'error should have been logged');
});

test('runWatchdogTick: a throwing tick does not prevent subsequent ticks from running', async () => {
  const { runWatchdogTick } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  let callCount = 0;
  const _tick = () => {
    callCount++;
    if (callCount === 1) throw new Error('first tick fails');
    return { reaped: [], escalations: [] };
  };
  const stubs = {
    db, logger, tickCount: 1, startedAt: Date.now(), dryRun: true,
    _tick,
    _plannerCycle:    () => ({ promoted: [] }),
    _pushEscalations: async () => ({ sent: 0 }),
    _verifyCycle:     async () => ({ merged: [], failed: [], pending: [] }),
    _selectModel:     () => 'stub',
    _render:          () => {},
    _loadMeta:        () => ({}),
    _loadPolicy:      () => ({ work: {}, schedule: {}, quiet_hours: { enabled: false } }),
    _pruneEvents:     () => {},
    _pruneHistory:    () => {},
  };

  // First tick throws internally
  await runWatchdogTick({ ...stubs, tickCount: 1 });

  // Second tick should also run without throwing
  await assert.doesNotReject(
    runWatchdogTick({ ...stubs, _tick: () => ({ reaped: [], escalations: [] }), tickCount: 2 }),
  );
});

// ---------------------------------------------------------------------------
// 1b. Per-subsystem isolation — a throw in one subsystem does NOT skip the
//     others within the SAME tick (PR: per-subsystem try/catch)
// ---------------------------------------------------------------------------

test('runWatchdogTick: _tick throwing still lets _plannerCycle and _verifyCycle run, and escalation push no-ops', async () => {
  const { runWatchdogTick } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  let plannerCalled = false;
  let verifyCalled = false;
  let pushCalled = false;

  const _tick = () => { throw new Error('simulated watchdog subsystem failure'); };
  const _plannerCycle = () => { plannerCalled = true; return { promoted: [] }; };
  const _pushEscalations = async () => { pushCalled = true; return { sent: 0 }; };
  const _verifyCycle = async () => { verifyCalled = true; return { merged: [], failed: [], pending: [] }; };

  await assert.doesNotReject(
    runWatchdogTick({
      db, logger, tickCount: 1, startedAt: Date.now(), dryRun: true,
      _tick, _plannerCycle, _pushEscalations, _verifyCycle,
      _selectModel: () => 'stub', _render: () => {}, _loadMeta: () => ({}),
      _loadPolicy: () => ({ work: {}, schedule: {}, quiet_hours: { enabled: false } }),
      _pruneEvents: () => {}, _pruneHistory: () => {},
    }),
  );

  assert.ok(plannerCalled, '_plannerCycle should still run after _tick throws');
  assert.ok(verifyCalled, '_verifyCycle should still run after _tick throws');
  assert.equal(pushCalled, false, 'escalation push should no-op when h is undefined, not throw');

  const errEntry = logger.calls.find(c => c.level === 'error' && c.tag === 'watchdog');
  assert.ok(errEntry, 'watchdog tick-error should have been logged');
});

test('runWatchdogTick: _plannerCycle throwing still lets _tick have run and _verifyCycle still run', async () => {
  const { runWatchdogTick } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  let tickCalled = false;
  let verifyCalled = false;

  const _tick = () => { tickCalled = true; return { reaped: [], escalations: [] }; };
  const _plannerCycle = () => { throw new Error('simulated planner failure'); };
  const _pushEscalations = async () => ({ sent: 0 });
  const _verifyCycle = async () => { verifyCalled = true; return { merged: [], failed: [], pending: [] }; };

  await assert.doesNotReject(
    runWatchdogTick({
      db, logger, tickCount: 1, startedAt: Date.now(), dryRun: true,
      _tick, _plannerCycle, _pushEscalations, _verifyCycle,
      _selectModel: () => 'stub', _render: () => {}, _loadMeta: () => ({}),
      _loadPolicy: () => ({ work: {}, schedule: {}, quiet_hours: { enabled: false } }),
      _pruneEvents: () => {}, _pruneHistory: () => {},
    }),
  );

  assert.ok(tickCalled, '_tick should have run before _plannerCycle threw');
  assert.ok(verifyCalled, '_verifyCycle should still run after _plannerCycle throws');

  const errEntry = logger.calls.find(c => c.level === 'error' && c.tag === 'planner');
  assert.ok(errEntry, 'planner cycle-error should have been logged');
});

test('runWatchdogTick: _verifyCycle throwing still lets earlier subsystems have run and resolves normally', async () => {
  const { runWatchdogTick } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  let tickCalled = false;
  let plannerCalled = false;

  const _tick = () => { tickCalled = true; return { reaped: [], escalations: [] }; };
  const _plannerCycle = () => { plannerCalled = true; return { promoted: [] }; };
  const _pushEscalations = async () => ({ sent: 0 });
  const _verifyCycle = async () => { throw new Error('simulated verify failure'); };

  await assert.doesNotReject(
    runWatchdogTick({
      db, logger, tickCount: 1, startedAt: Date.now(), dryRun: true,
      _tick, _plannerCycle, _pushEscalations, _verifyCycle,
      _selectModel: () => 'stub', _render: () => {}, _loadMeta: () => ({}),
      _loadPolicy: () => ({ work: {}, schedule: {}, quiet_hours: { enabled: false } }),
      _pruneEvents: () => {}, _pruneHistory: () => {},
    }),
  );

  assert.ok(tickCalled, '_tick should have run');
  assert.ok(plannerCalled, '_plannerCycle should have run');

  const errEntry = logger.calls.find(c => c.level === 'error' && c.tag === 'verifier');
  assert.ok(errEntry, 'verifier cycle-error should have been logged');
});

// ---------------------------------------------------------------------------
// 2. Per-tick isolation — a throwing runner cycle does NOT stop the daemon
// ---------------------------------------------------------------------------

test('runRunnerCycle: a throw inside executeRun is caught; no re-throw', async () => {
  const { runRunnerCycle } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  const _executeRun = async () => { throw new Error('simulated runner failure'); };

  await assert.doesNotReject(
    runRunnerCycle({
      db, logger, dryRun: true,
      _executeRun,
      _render:     () => {},
      _loadMeta:   () => ({}),
      _loadPolicy: () => ({ work: {}, schedule: {} }),
      _launchAgent: undefined,
    }),
  );

  const errEntry = logger.calls.find(c => c.level === 'error');
  assert.ok(errEntry, 'error should have been logged');
  // The error detail is captured via the err argument or the msg prefix
  const errText = (errEntry.msg ?? '') + String(errEntry.err ?? '');
  assert.ok(errText.includes('simulated runner failure'), `logged error should reference the failure; got: ${errText}`);
});

test('runRunnerCycle: logs fired runs when executeRun succeeds', async () => {
  const { runRunnerCycle } = await import('../scheduler.mjs');
  const logger = fakeLogger();
  const db = stubDb();

  const _executeRun = async () => ({
    fired: true,
    runs: [{ agent: 'claude', task: 'F-001', outcome: 'ok', note: 'spawned' }],
  });

  await runRunnerCycle({
    db, logger, dryRun: false,
    _executeRun,
    _render:      () => {},
    _loadMeta:    () => ({}),
    _loadPolicy:  () => ({ work: {}, schedule: {} }),
    _launchAgent: () => ({}),
  });

  const fired = logger.calls.find(c => c.level === 'log' && c.msg.includes('fired 1'));
  assert.ok(fired, 'should log "fired 1 run(s)"');
});

// ---------------------------------------------------------------------------
// 3. Global guard — unhandledRejection is logged and process continues
// ---------------------------------------------------------------------------

test('unhandledRejection listener: logs the reason and does NOT call process.exit', () => {
  // The scheduler.mjs module registers an unhandledRejection listener at import time.
  // We locate it by inspecting each listener's source text so we don't accidentally
  // invoke the Node test-runner's re-throwing listener.
  const allListeners = process.listeners('unhandledRejection');
  assert.ok(allListeners.length > 0, 'at least one unhandledRejection listener should be registered');

  // Identify the scheduler's listener: it references 'unhandledRejection' or 'logger'
  // in its source. The Node test runner's listener does not reference these.
  const schedulerListener = allListeners.find(fn =>
    fn.toString().includes('unhandledRejection') || fn.toString().includes('logger'),
  );
  assert.ok(schedulerListener, 'should find the scheduler unhandledRejection listener');

  const originalExit = process.exit;
  let exitCalled = false;
  process.exit = () => { exitCalled = true; };

  const captured = [];
  const originalError = console.error;
  console.error = (...args) => captured.push(args.join(' '));

  try {
    // Call ONLY the scheduler listener, never the test runner's re-throwing listener.
    schedulerListener(new Error('test-rejection-reason'), Promise.resolve());
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  const logged = captured.some(line =>
    line.includes('unhandledRejection') || line.includes('test-rejection-reason'),
  );
  assert.ok(logged, `scheduler's unhandledRejection listener should log to console.error; captured: ${JSON.stringify(captured)}`);
  assert.equal(exitCalled, false, 'process.exit must NOT be called for unhandledRejection');
});

// ---------------------------------------------------------------------------
// 4. Rotating logger — writes lines and caps size with rotation
// ---------------------------------------------------------------------------

test('createRotatingLogger: writes timestamped lines to the log file', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'aios-logger-test-'));
  const logger = createRotatingLogger({ logDir, maxBytes: 1024 * 1024 });

  logger.log('testTag', 'hello from test');
  logger.error('testTag', 'something went wrong', new Error('boom'));
  logger.close();

  const content = readFileSync(join(logDir, 'daemon.log'), 'utf8');
  assert.ok(content.includes('hello from test'), 'log line should appear in file');
  assert.ok(content.includes('something went wrong'), 'error line should appear in file');
  assert.ok(content.includes('boom'), 'error detail should appear in file');
  // Each top-level log entry line should start with an ISO timestamp.
  // Stack trace continuation lines (starting with spaces/"at") are part of the
  // error detail and do not start a new entry.
  const topLines = content.trim().split('\n').filter(l => /^\d{4}/.test(l));
  assert.ok(topLines.length >= 2, 'should have at least 2 top-level log entries');
  for (const line of topLines) {
    assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'each entry line should have ISO timestamp');
  }
});

test('createRotatingLogger: rotates when file size exceeds maxBytes', () => {
  const logDir  = mkdtempSync(join(tmpdir(), 'aios-logger-rotate-'));
  const maxBytes = 200; // tiny cap so we can trigger rotation easily
  const livePath   = join(logDir, 'daemon.log');
  const backupPath = join(logDir, 'daemon.log.1');

  // Pre-seed the log file with content that already exceeds the cap
  const seedContent = 'x'.repeat(maxBytes + 10) + '\n';
  writeFileSync(livePath, seedContent, 'utf8');

  const logger = createRotatingLogger({ logDir, maxBytes });

  // Writing one more line should trigger rotation
  logger.log('rotate', 'trigger rotation');
  logger.close();

  assert.ok(existsSync(backupPath), 'backup file (daemon.log.1) should exist after rotation');
  const liveSize = readFileSync(livePath, 'utf8').length;
  assert.ok(liveSize < maxBytes, `live file (${liveSize} bytes) should be smaller than the cap (${maxBytes} bytes) after rotation`);
});

test('createRotatingLogger: never throws even if logDir is unwritable', () => {
  // Use an invalid path to simulate a write failure
  const logger = createRotatingLogger({ logDir: 'Z:\\nonexistent\\path\\that\\cannot\\exist\\' });
  // Must not throw
  assert.doesNotThrow(() => logger.log('test', 'should not throw'));
  assert.doesNotThrow(() => logger.error('test', 'should not throw', new Error('x')));
  assert.doesNotThrow(() => logger.close());
});

// ---------------------------------------------------------------------------
// 5. maybeStartGateway — opt-in gateway wiring (config.gateway assembly)
// ---------------------------------------------------------------------------

test('maybeStartGateway: policy.gateway absent — no-op, assembleGateway never called', async () => {
  const { maybeStartGateway } = await import('../scheduler.mjs');
  let called = false;
  const _assembleGateway = async () => { called = true; return {}; };

  const result = await maybeStartGateway({ config: {}, policy: {}, _assembleGateway });

  assert.equal(result.gatewayConfig, undefined);
  assert.equal(called, false, '_assembleGateway must not be called when policy.gateway is absent');
  assert.equal(typeof result.close, 'function');
  assert.doesNotThrow(() => result.close());
});

test('maybeStartGateway: policy.gateway.enabled === false — no-op, assembleGateway never called', async () => {
  const { maybeStartGateway } = await import('../scheduler.mjs');
  let called = false;
  const _assembleGateway = async () => { called = true; return {}; };

  const result = await maybeStartGateway({ config: {}, policy: { gateway: { enabled: false } }, _assembleGateway });

  assert.equal(result.gatewayConfig, undefined);
  assert.equal(called, false, '_assembleGateway must not be called when policy.gateway.enabled is false');
});

test('maybeStartGateway: policy.gateway.enabled === true — assembles and returns launcher-shaped config', async () => {
  const { maybeStartGateway } = await import('../scheduler.mjs');
  const fakeRuns = { unregisterRun() {} };
  const fakeRegistry = { tenant: 'dev', routes: {} };
  const fakeClose = () => {};
  let callArgs = null;
  const _assembleGateway = async (args) => {
    callArgs = args;
    return {
      url: 'http://localhost:9999',
      runs: fakeRuns,
      store: { get: () => fakeRegistry },
      close: fakeClose,
    };
  };

  const config = { some: 'config' };
  const policy = { gateway: { enabled: true } };
  const result = await maybeStartGateway({ config, policy, _assembleGateway });

  assert.deepEqual(result.gatewayConfig, {
    enabled: true,
    url: 'http://localhost:9999',
    runs: fakeRuns,
    registry: fakeRegistry,
  });
  assert.equal(result.close, fakeClose);

  assert.equal(callArgs.config, config);
  assert.equal(callArgs.policy, policy);
  assert.equal(callArgs.port, 0, 'default port should be 0 (ephemeral)');
  assert.equal(callArgs.tenant, 'pv', 'default tenant should be pv');
});

test('maybeStartGateway: passes port/tenant through to assembleGateway', async () => {
  const { maybeStartGateway } = await import('../scheduler.mjs');
  let callArgs = null;
  const _assembleGateway = async (args) => {
    callArgs = args;
    return {
      url: 'http://localhost:4318',
      runs: { unregisterRun() {} },
      store: { get: () => ({}) },
      close: () => {},
    };
  };

  await maybeStartGateway({
    config: {},
    policy: { gateway: { enabled: true } },
    port: 4318,
    tenant: 'devx',
    _assembleGateway,
  });

  assert.equal(callArgs.port, 4318);
  assert.equal(callArgs.tenant, 'devx');
});
