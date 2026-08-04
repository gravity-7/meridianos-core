/**
 * local-agent — the customer-machine side of the hybrid cloud control plane (US6). Runs as its
 * own process (`node cloud/local-agent.mjs`, per quickstart.md Scenario 6), separate from the
 * daemon — it reads the SAME on-disk ledger/policy files the daemon writes, rather than reaching
 * into the daemon's in-process state, so it works whether or not the daemon happens to be up.
 *
 * Privacy (FR-021): only token counts, costs, provider/model names, and latency are read from the
 * ledger and sent — `queryRecentEvents` below selects exactly those columns, nothing else, so
 * there is no code path here that could forward a prompt, a response, or an API key.
 */
import { openLedger } from '../gateway/ledger.mjs';
import { writePolicy } from '../policy-write.mjs';
import { RETENTION } from './cloud-control-plane.mjs';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../db.mjs';
import { parseYaml } from '../yaml-lite.mjs';
import { recordCloudConnected } from '../telemetry.mjs';

const DEFAULT_INTERVAL_SEC = 60;

/** Where the agent persists its status (T094) — a separate process (the daemon/dashboard) reads
 *  this file to show "Connected to cloud control plane" without any IPC between the two. */
export function statusFilePath(config) {
  return join(config.repoRoot, '.ai', 'cloud-agent-status.json');
}

/** Anonymized token events reported since `sinceTs` (unix seconds) — provider/model/tokens/cost
 *  only, matching cloud_metadata's columns exactly. */
function queryRecentEvents(ledger, tenant, sinceTs) {
  try {
    return ledger.prepare(
      `SELECT ts, provider, model, total_tokens, cost_usd
         FROM token_events WHERE tenant = ? AND ts >= ? ORDER BY ts ASC`,
    ).all(tenant, new Date(sinceTs * 1000).toISOString()).map((r) => ({
      timestamp: Math.floor(Date.parse(r.ts) / 1000),
      provider: r.provider, model: r.model, tokens: r.total_tokens ?? 0, cost: r.cost_usd ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Build a fresh nested YAML block for a dotted path not yet present anywhere in policy.yaml
 *  (e.g. the very first cloud push to a brand-new machine, whose policy.yaml doesn't have an
 *  `agent_budget:` section yet). Appended, not surgically inserted — the ONE tradeoff being that
 *  a partially-existing parent key elsewhere in the file could end up duplicated; every
 *  SUBSEQUENT push of the same already-present path goes through policy-write.mjs's exact-line
 *  `setPolicyValue` instead, which has no such caveat. */
// `value` is expected to be a JSON-primitive scalar (number, boolean, or a string without
// characters JSON.stringify would need to backslash-escape) — the cloud control plane's own
// policyUpdates payload only ever pushes budget/lever numbers and simple flags. A string
// containing a backslash or embedded quote would round-trip through JSON.stringify but may not
// re-parse cleanly via yaml-lite.mjs; acceptable since this append path only runs as a fallback
// when writePolicy's exact-line update already failed (see caller).
function appendPolicyPath(text, path, value) {
  const parts = path.split('.');
  const lines = parts.map((part, i) => `${'  '.repeat(i)}${part}${i === parts.length - 1 ? `: ${JSON.stringify(value)}` : ':'}`);
  const block = lines.join('\n') + '\n';
  return text.length && !text.endsWith('\n') ? `${text}\n${block}` : `${text}${block}`;
}

/**
 * Create a local cloud agent. Nothing runs until `.start()` is called — matches every other
 * factory in this repo (createRotatingLogger, createRateLimiter, ...) being side-effect-free at
 * construction time.
 * @param {{config: object, cloudUrl: string, machineApiKey: string, reportingIntervalSec?: number,
 *           fetchImpl?: Function, getHealthSnapshot?: () => Array<{provider,status}>, logger?: object}} opts
 */
export function createLocalAgent({
  config, cloudUrl, machineApiKey, reportingIntervalSec = DEFAULT_INTERVAL_SEC,
  fetchImpl = fetch, getHealthSnapshot = () => [], logger,
} = {}) {
  if (reportingIntervalSec < RETENTION.MIN_REPORTING_INTERVAL || reportingIntervalSec > RETENTION.MAX_REPORTING_INTERVAL) {
    throw new Error(`reportingIntervalSec must be between ${RETENTION.MIN_REPORTING_INTERVAL} and ${RETENTION.MAX_REPORTING_INTERVAL}`);
  }
  const log = logger ?? { log() {}, error() {} };

  let timer = null;
  let lastReportAt = null;
  let lastError = null;
  let sinceTs = Math.floor(Date.now() / 1000);
  let hasRecordedConnection = false;

  /** T104 — best-effort, opt-in telemetry, fired once per agent instance on the FIRST
   *  successful report (not every report — this counts connections, not report volume). */
  function recordConnectionTelemetry() {
    if (hasRecordedConnection || !config?.repoRoot) return;
    hasRecordedConnection = true;
    try {
      const policyPath = config.policyPath ?? join(config.repoRoot, '.ai', 'policy.yaml');
      if (!existsSync(policyPath)) return;
      const policy = parseYaml(readFileSync(policyPath, 'utf8'));
      if (policy?.telemetry?.enabled !== true) return;
      const db = openDb(undefined, config);
      recordCloudConnected(db, { orgId: null }, { policy }); // orgId isn't known locally — the cloud side already has it
      db.close?.();
    } catch { /* telemetry is best-effort */ }
  }

  /** Apply policy updates the cloud pushed down — writes policy.yaml; the daemon (a SEPARATE
   *  process) picks up the change on its own next scheduler tick, since every tick re-reads
   *  policy.yaml from disk rather than caching it (T093). Each path is applied independently so
   *  one path that needs the append-fallback doesn't block a sibling path that doesn't. */
  function applyPolicyUpdates(updates) {
    if (!updates || updates.length === 0) return;
    const applied = [];
    for (const { path, value } of updates) {
      try {
        writePolicy({ [path]: value }, { config });
        applied.push(path);
      } catch (err) {
        // Either the path doesn't exist yet within an existing policy.yaml, or policy.yaml
        // itself doesn't exist yet (ENOENT, a brand-new machine) — both fall back to append.
        if (!/policy path not found|ENOENT/.test(String(err.message))) {
          log.error('cloud-agent', `failed to apply cloud-pushed policy update '${path}'`, err);
          continue;
        }
        try {
          const policyPath = config.policyPath;
          mkdirSync(join(config.repoRoot, '.ai'), { recursive: true });
          const current = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';
          writeFileSync(policyPath, appendPolicyPath(current, path, value), 'utf8');
          applied.push(path);
        } catch (err2) {
          log.error('cloud-agent', `failed to append new cloud-pushed policy path '${path}'`, err2);
        }
      }
    }
    if (applied.length) log.log('cloud-agent', `applied ${applied.length} policy update(s) from cloud: ${applied.join(', ')}`);
  }

  function persistStatus() {
    if (!config?.repoRoot) return;
    try {
      mkdirSync(join(config.repoRoot, '.ai'), { recursive: true });
      writeFileSync(statusFilePath(config), JSON.stringify(getStatusSnapshot()), 'utf8');
    } catch { /* status persistence is best-effort — never block reporting on it */ }
  }

  function getStatusSnapshot() {
    const connected = lastReportAt != null && Date.now() - lastReportAt < reportingIntervalSec * 1000 * 3;
    return { connected, lastReportAt, lastError, reportingIntervalSec };
  }

  async function reportOnce() {
    const tenant = config?.gateway?.registry?.tenant ?? config?.gateway?.tenant ?? 'default';
    let metadata = [];
    let ledger;
    try {
      ledger = openLedger(undefined, { config });
      metadata = queryRecentEvents(ledger, tenant, sinceTs);
    } catch (err) {
      log.error('cloud-agent', 'failed to read local ledger for reporting', err);
    } finally {
      try { ledger?.close(); } catch { /* ignore */ }
    }

    const providerHealth = getHealthSnapshot();

    try {
      const res = await fetchImpl(`${cloudUrl}/api/cloud/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-machine-key': machineApiKey },
        body: JSON.stringify({ metadata, providerHealth }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

      lastReportAt = Date.now();
      lastError = null;
      sinceTs = Math.floor(Date.now() / 1000);
      applyPolicyUpdates(body.policyUpdates);
      recordConnectionTelemetry();
      log.log('cloud-agent', `reported ${metadata.length} metadata event(s) to cloud control plane`);
    } catch (err) {
      lastError = String(err?.message || err);
      log.error('cloud-agent', 'cloud metadata report failed', err);
    }
    persistStatus();
  }

  return {
    /** Report once immediately, then every `reportingIntervalSec`. */
    start() {
      if (timer) return;
      reportOnce();
      timer = setInterval(reportOnce, reportingIntervalSec * 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    /** One-shot report, for tests and for a manual "sync now" action. */
    reportOnce,
    /** T094 — connection status the local dashboard shows ("Connected to cloud control plane"). */
    getStatus() {
      return getStatusSnapshot();
    },
  };
}

// CLI entrypoint: `node cloud/local-agent.mjs` (quickstart.md Scenario 6). Configured entirely
// via env vars since this is a standalone process, not wired into the daemon's own CLI parsing.
//   AIOS_CLOUD_URL              — cloud control plane base URL (required)
//   AIOS_CLOUD_MACHINE_KEY      — this machine's mck-{...} key from a prior registerMachine() call (required)
//   AIOS_CLOUD_REPORT_INTERVAL  — seconds, 30-300 (default 60)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createAios } = await import('../config.mjs');
  const { createRotatingLogger } = await import('../daemon-logger.mjs');

  const cloudUrl = process.env.AIOS_CLOUD_URL;
  const machineApiKey = process.env.AIOS_CLOUD_MACHINE_KEY;
  if (!cloudUrl || !machineApiKey) {
    console.error('[meridianos] AIOS_CLOUD_URL and AIOS_CLOUD_MACHINE_KEY are required to start the cloud agent.');
    process.exit(1);
  }

  const { config } = createAios({});
  const logger = createRotatingLogger({ config });
  const agent = createLocalAgent({
    config, cloudUrl, machineApiKey,
    reportingIntervalSec: Number(process.env.AIOS_CLOUD_REPORT_INTERVAL) || DEFAULT_INTERVAL_SEC,
    logger,
  });

  console.log(`[meridianos] Cloud agent starting — reporting to ${cloudUrl} every ${agent.getStatus().reportingIntervalSec}s`);
  agent.start();
  process.on('SIGINT', () => { agent.stop(); process.exit(0); });
  process.on('SIGTERM', () => { agent.stop(); process.exit(0); });
}
