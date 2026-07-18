#!/usr/bin/env node
/**
 * cli — the standalone entry point for the gateway sidecar (card C1, "the wedge"): ONE command to
 * boot cost-governed metering across Claude/DeepSeek/etc, no tenant loop, no DomainPlugin, no
 * daemon required. Thin by design: all real behavior already lives in `assembleGateway`
 * (index.mjs) / `startGateway` (server.mjs) — this module only parses flags, wires them straight
 * through, prints where the sidecar came up, and shuts down cleanly on SIGINT. Nothing here is
 * reimplemented from those modules.
 *
 * Importing this module starts NOTHING (see the main-guard at the bottom, which mirrors
 * scheduler.mjs's own `fileURLToPath(import.meta.url) === process.argv[1]` idiom) — only running
 * it directly (`node gateway/cli.mjs ...` or the `meridian-gateway` bin) boots a server.
 *
 * Registering ONE default run: a bare `assembleGateway()` has no runs registered, so nothing could
 * ever route through it (every request 401s — see run-registry.mjs). Standalone has no launcher to
 * mint per-run tokens (that's `gateway/inject.mjs`, daemon-only), so when `--provider` is given this
 * CLI registers a single default run via the assembled gateway's own public `runs.registerRun` API
 * (no new registration mechanism, no touching run-registry.mjs itself) and prints the minted token
 * so an operator can point one BYO-key agent's base URL + auth header at this sidecar. Omit
 * `--provider` and the sidecar still boots — just with nothing registered to route through it yet.
 *
 * Never logs a provider key: only `keyEnv` NAMES ever flow through this module (via `--provider`
 * matching a route in the registry) — the real secret is resolved server-side, at forward-time,
 * inside server.mjs's `resolveKey`, and never touches this process's stdout.
 */
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assembleGateway } from './index.mjs';
import { loadPolicy } from '../budget.mjs';

/**
 * Minimal inline flag parser (no dependency): `--flag value` pairs, plus bare `--flag` boolean
 * switches when the next token is missing or is itself another flag. That's the entire surface
 * this CLI needs — no `=`-form, no short flags, no positionals.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * Assembles + starts one standalone gateway sidecar from parsed CLI flags. Exported separately
 * from `main` so tests can drive it in-process (no child-process spawn needed) — exactly like
 * `gateway/tests/index.test.mjs` already does for `assembleGateway` itself. Only `main()` (the
 * main-guarded path below) needs a real subprocess, to prove the stdout/SIGINT contract.
 *
 * Returns `{ ...assembled, token, registeredRun }` (see `assembleGateway`'s own return shape for
 * `gateway`/`ledger`/`runs`/`store`/`url`/`close`). `token` is the minted gateway token for the one
 * default run registered when `--provider` is given; `null` when it isn't (nothing registered).
 */
export async function startCli(flags = {}) {
  const port = flags.port !== undefined ? Number(flags.port) : 0;
  const tenant = flags.tenant ?? 'pv';
  // `assembleGateway`'s own default (`policy ?? loadPolicy(undefined, config)`) requires a
  // `config` when `policy` is omitted (it reads `config.policyPath`) — this CLI deliberately never
  // passes a `config` (standalone means no tenant AiosConfig), so an empty policy object is passed
  // explicitly rather than `undefined` here, matching what an empty/missing policy.yaml would
  // parse to anyway (`loadPolicy`'s own read-failure fallback is `{}`, per budget.mjs).
  const policy = flags.policy && typeof flags.policy === 'string' ? loadPolicy(flags.policy) : {};
  const ledgerPath = typeof flags.ledger === 'string' ? flags.ledger : undefined;

  const assembled = await assembleGateway({ policy, port, tenant, ledgerPath });

  let token = null;
  let registeredRun = null;
  if (flags.provider && typeof flags.provider === 'string') {
    token = typeof flags.token === 'string' ? flags.token : randomUUID();
    registeredRun = {
      tenant,
      agent: typeof flags.agent === 'string' ? flags.agent : 'cli',
      session: typeof flags.session === 'string' ? flags.session : randomUUID(),
      task: null,
      runId: null,
      provider: flags.provider,
      model: typeof flags.model === 'string' ? flags.model : null,
      tier: 'medium',
    };
    assembled.runs.registerRun(token, registeredRun);
  }

  return { ...assembled, tenant, ledgerPath, token, registeredRun };
}

function printBanner({ url, tenant, ledgerPath, token, registeredRun }) {
  process.stdout.write(`meridian-gateway listening at ${url}\n`);
  process.stdout.write(`tenant: ${tenant}\n`);
  process.stdout.write(`ledger: ${ledgerPath ?? '(default .ai/gateway/ledger.db)'}\n`);
  if (token) {
    const modelPart = registeredRun.model ? ` model=${registeredRun.model}` : '';
    process.stdout.write(`default run registered: agent=${registeredRun.agent} provider=${registeredRun.provider}${modelPart}\n`);
    process.stdout.write(`gateway token (send as x-gateway-token, x-api-key, or Authorization: Bearer): ${token}\n`);
  } else {
    process.stdout.write('no --provider given: sidecar is up but no run is registered yet (every request will 401)\n');
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cli = await startCli(flags);
  printBanner(cli);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cli.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run the CLI when this file is the direct process entry point (mirrors scheduler.mjs's own
// main-guard) — importing this module (e.g. from a test) starts no server.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`meridian-gateway: fatal: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
