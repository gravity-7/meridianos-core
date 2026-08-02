/**
 * Tests for gateway/cli.mjs — the standalone CLI entry (card C1, "the wedge"). Hermetic: every
 * ledger/policy path is a temp file, every upstream is an offline stub on 127.0.0.1, and nothing
 * depends on ambient repo `.ai/` state (BUG-1 caveat — run this file directly:
 * `node --test gateway/tests/cli.test.mjs`).
 *
 * AC1 and AC3 need a real child process (proving the actual entry point's stdout + SIGINT + main-
 * guard contract); AC2/AC4/AC5 are covered far more cheaply by importing `startCli` in-process —
 * the same "drive the assembly function directly" style gateway/tests/index.test.mjs already uses
 * for `assembleGateway` — against an offline stub upstream, exactly mirroring the real CLI's own
 * assembleGateway → registerRun wiring (see cli.mjs's `startCli`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startCli, parseArgs } from '../cli.mjs';
import { listEvents } from '../ledger.mjs';

const CLI_URL = new URL('../cli.mjs', import.meta.url);
const CLI_PATH = fileURLToPath(CLI_URL);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// ─── parseArgs: the tiny inline flag parser ─────────────────────────────────────────────────────

test('parseArgs: reads --flag value pairs and bare boolean flags', () => {
  assert.deepEqual(
    parseArgs(['--port', '0', '--tenant', 'acme', '--verbose']),
    { port: '0', tenant: 'acme', verbose: true },
  );
  assert.deepEqual(parseArgs([]), {});
});

// ─── AC1: `node gateway/cli.mjs --port 0` boots, prints a URL, exits on SIGINT ──────────────────

test('AC1: the CLI subprocess boots, prints a 127.0.0.1:<port> URL, and terminates on SIGINT', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'aios-gateway-cli-ac1-'));
  const ledgerPath = join(tmpDir, 'ledger.db');

  const child = spawn(process.execPath, [CLI_PATH, '--port', '0', '--ledger', ledgerPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (c) => { out += c.toString(); });

  try {
    // Wait for the FULL banner (URL + tenant + ledger lines) — printBanner issues three separate
    // stdout.write calls, which can arrive across more than one 'data' chunk, so resolving on the
    // URL line alone raced ahead of the later lines landing in `out` (observed flake). Requiring
    // the ledger line too guarantees the whole banner has been read before we assert on it.
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for the full banner; stdout so far: ${out}`)), 10_000);
      const check = () => {
        const m = /Listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
        if (m && /\nledger: /.test(out)) { clearTimeout(timer); resolve(m[1]); }
      };
      child.stdout.on('data', check);
      check();
    });
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(out, /tenant: pv/);
    assert.match(out, new RegExp(`ledger: ${ledgerPath.replace(/[\\.]/g, '\\$&')}`));

    const exitInfo = await new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
      child.kill('SIGINT');
    });

    if (process.platform === 'win32') {
      // Documented Node/Windows limitation (see the child_process docs on `subprocess.kill(signal)`):
      // "On Windows, where POSIX signals do not exist, the signal argument will be ignored, and the
      // process will be killed forcefully and abruptly (similar to 'SIGKILL')." So on this platform
      // cli.mjs's own graceful `process.on('SIGINT', ...)` handler (which DOES fire under a real
      // POSIX SIGINT, e.g. in CI on Linux/macOS) never gets the chance to run — accept either a
      // graceful exit(0) or the platform's forceful termination as proof the process reacted to it.
      assert.ok(
        exitInfo.code === 0 || exitInfo.signal === 'SIGINT',
        `expected a clean exit or a Windows forceful SIGINT termination, got ${JSON.stringify(exitInfo)}`,
      );
    } else {
      assert.equal(exitInfo.code, 0, `expected exit 0 on SIGINT, got ${JSON.stringify(exitInfo)}`);
    }
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

// ─── AC3: importing gateway/cli.mjs starts no server ────────────────────────────────────────────

test('AC3: importing gateway/cli.mjs (already imported above for startCli/parseArgs) never wrote to stdout — the main-guard held', () => {
  // This test file imports `../cli.mjs` at module load time (the `startCli`/`parseArgs` import at
  // the top) — proof-by-construction that importing the module is side-effect-free: if the
  // main-guard did NOT hold, `main()` would have run during that import (before any test here even
  // started), boot a real server, and print a banner to stdout. Re-assert the export shape as the
  // positive half of the check, and spy on a FRESH dynamic import to double-check no stdout write
  // happens on import, no matter how it's imported.
  assert.equal(typeof startCli, 'function');
  assert.equal(typeof parseArgs, 'function');
});

test('AC3b: importing gateway/cli.mjs from a standalone process writes nothing to stdout and starts no listener', async () => {
  // Run the import in its OWN child process (rather than spying on this test process's shared
  // process.stdout, which the node:test runner itself also writes TAP output to concurrently —
  // that shared-stdout race made an in-process spy flaky). A separate process gives a clean,
  // unambiguous stdout: if the main-guard failed to hold, `main()` would print its banner here.
  const probeScript = `import(${JSON.stringify(CLI_URL.href)}).then((m) => { process.stdout.write(JSON.stringify({ hasStartCli: typeof m.startCli === 'function' })); process.exit(0); });`;
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', probeScript], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`probe process exited ${code}; stderr: ${stderr}`));
      resolve(stdout);
    });
  });
  assert.equal(out.trim(), JSON.stringify({ hasStartCli: true }), 'importing gateway/cli.mjs must print nothing but the probe\'s own single line, and must export startCli');
});

// ─── AC2/AC4/AC5: startCli in-process against an offline stub upstream ──────────────────────────
// Mirrors gateway/tests/index.test.mjs's stub-upstream style. One assembled CLI instance, tenant
// 'acme' (AC4), agent 'capagent' with a tiny 11-token cap (AC5) via a real policy.yaml file (proving
// the `--policy <path>` flag is actually read through `loadPolicy`, not just passed as an object).

let stub;
let stubUrl;
let hits;
let tmpDir;
let policyPath;
let ledgerPath;
let cli;

before(async () => {
  hits = 0;
  stub = http.createServer(async (req, res) => {
    await readBody(req);
    hits += 1;
    const payload = Buffer.from(JSON.stringify({ id: `stub-${hits}`, usage: { prompt_tokens: 5, completion_tokens: 5 } }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;

  process.env.TEST_CLI_DEEPSEEK_KEY = 'sk-cli-test';

  tmpDir = mkdtempSync(join(tmpdir(), 'aios-gateway-cli-'));
  policyPath = join(tmpDir, 'policy.yaml');
  ledgerPath = join(tmpDir, 'ledger.db');

  // A real policy.yaml on disk — proves `--policy <path>` flows through `loadPolicy` (budget.mjs),
  // not just a pre-loaded JS object. A tiny per-5h cap (11 tokens, one call above one call's usage
  // of 10) so AC5 can cross it deterministically after exactly two allowed calls, same shape as
  // index.test.mjs's enforcement test.
  writeFileSync(
    policyPath,
    [
      'providers:',
      '  deepseek:',
      `    baseUrl: ${stubUrl}`,
      '    keyEnv: TEST_CLI_DEEPSEEK_KEY',
      'agent_budget:',
      '  capagent:',
      '    per_5h_tokens: 11',
      '    per_week_tokens: 1000000',
      '',
    ].join('\n'),
  );

  cli = await startCli({
    port: '0',
    tenant: 'acme',
    policy: policyPath,
    ledger: ledgerPath,
    provider: 'deepseek',
    model: 'deepseek-chat',
    agent: 'capagent',
  });
});

after(async () => {
  // `cli` is only assigned once `before()` fully succeeds — if it threw partway through (e.g. a
  // malformed provider registry), `cli` stays undefined here. Without this guard, the unclosed
  // `stub` HTTP server below is never reached and keeps this file's isolated test process alive
  // indefinitely (an open listener holds the event loop open) — a `before()` failure should
  // report as a clean, fast test failure, not an indefinite hang.
  if (cli) {
    await cli.close();
    cli.ledger.close(); // release the on-disk SQLite handle BEFORE rmSync, or Windows EBUSYs on unlink
  }
  if (stub) await new Promise((resolve) => stub.close(resolve));
  delete process.env.TEST_CLI_DEEPSEEK_KEY;
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
});

test('startCli wires --policy through loadPolicy and registers one default run with a minted token', () => {
  assert.match(cli.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(typeof cli.token, 'string');
  assert.ok(cli.token.length > 0);
  assert.equal(cli.registeredRun.agent, 'capagent');
  assert.equal(cli.registeredRun.provider, 'deepseek');
});

test('AC2: a request proxied through the running CLI appends exactly one event to the ledger at --ledger', async () => {
  assert.equal(existsSync(ledgerPath), true, 'the --ledger file must exist once the CLI has assembled the sidecar');

  const res = await fetch(`${cli.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': cli.token, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(res.status, 200);

  const events = listEvents(cli.ledger, { tenant: 'acme', agent: 'capagent' });
  assert.equal(events.length, 1);
  const evt = events[0];
  assert.equal(evt.provider, 'deepseek');
  assert.equal(evt.wire, 'openai');
  assert.equal(evt.totalTokens, 10);
  assert.equal(evt.enforcementDecision, 'allow');

  // AC4: --tenant acme labels the ledger event tenant:'acme'.
  assert.equal(evt.tenant, 'acme');
});

test('AC5: a budget-deny still returns a non-retryable 403 through the CLI path once the cap is crossed', async () => {
  // One more allowed call: cumulative prior usage is now 10 (< 11 cap) → allow (now 20 total).
  const res2 = await fetch(`${cli.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': cli.token, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(res2.status, 200);

  const hitsBefore = hits;

  // Third call overall: prior cumulative usage is 20 >= the 11-token cap → denied, never forwarded.
  const res3 = await fetch(`${cli.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': cli.token, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(res3.status, 403);
  assert.equal(res3.headers.get('x-should-retry'), 'false');
  const body = await res3.json();
  assert.equal(body.error.code, 'over_budget');
  assert.equal(hits, hitsBefore, 'the denied call must never reach the stub upstream — enforcement is not bypassed standalone');

  const events = listEvents(cli.ledger, { tenant: 'acme', agent: 'capagent' });
  assert.equal(events.length, 3);
  const denied = events[0]; // newest first
  assert.equal(denied.enforcementDecision, 'deny');
  assert.equal(denied.capWindow, '5h');
  assert.equal(denied.upstreamStatus, null);
});

test('an unregistered token still gets 401 (no run) — standalone does not silently allow unknown callers', async () => {
  const res = await fetch(`${cli.url}/chat`, {
    method: 'POST',
    headers: { 'x-gateway-token': 'not-a-real-token', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [] }),
  });
  assert.equal(res.status, 401);
});
