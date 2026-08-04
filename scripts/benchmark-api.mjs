#!/usr/bin/env node
/**
 * benchmark-api — latency benchmark for the public REST API (code-review follow-up: "Add
 * performance benchmarks for API endpoints"), checking against SC-004's "all endpoints respond
 * correctly within 200ms."
 *
 * Spins up a REAL createDashboardServer() over an isolated temp repo (no external dependency,
 * no real provider calls needed for the read endpoints benchmarked here), mints one API key per
 * endpoint (so concurrent load on one doesn't trip another's rate-limit budget), fires a
 * configurable number of requests at a configurable concurrency, and reports p50/p95/p99 per
 * endpoint. Exits non-zero if any endpoint's p95 exceeds the threshold, so this is CI-usable, not
 * just a manual tool.
 *
 * Usage:
 *   node scripts/benchmark-api.mjs [--requests=80] [--concurrency=10] [--threshold-ms=200]
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createDashboardServer } from '../dashboard/server.mjs';
import { resolvePaths } from '../config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const FIXTURE_DOMAIN = {
  agents: ['agent-a', 'agent-b'],
  prompts: { implRules: [], reviewCriteria: [] },
  guardrailCheck: null,
  boardTitle: 'Benchmark',
  riskToAction: {},
  knownRiskTags: [],
};

const ENDPOINTS = [
  { name: 'GET /api/v1/tasks', method: 'GET', path: '/api/v1/tasks', scopes: ['tasks:read'] },
  { name: 'GET /api/v1/costs', method: 'GET', path: '/api/v1/costs', scopes: ['costs:read'] },
  { name: 'GET /api/v1/providers', method: 'GET', path: '/api/v1/providers', scopes: ['providers:read'] },
  { name: 'GET /api/v1/config', method: 'GET', path: '/api/v1/config', scopes: ['config:read'] },
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function percentile(sortedLatencies, p) {
  if (sortedLatencies.length === 0) return 0;
  const idx = Math.min(sortedLatencies.length - 1, Math.ceil((p / 100) * sortedLatencies.length) - 1);
  return sortedLatencies[Math.max(0, idx)];
}

async function timedFetch(url, opts) {
  const start = performance.now();
  const res = await fetch(url, opts);
  await res.arrayBuffer(); // drain the body so the request is FULLY complete before stopping the clock
  return { ms: performance.now() - start, status: res.status };
}

/** Run `total` requests at `concurrency` in flight, return sorted latencies + status counts. */
async function loadTest({ total, concurrency, makeRequest }) {
  const latencies = [];
  const statusCounts = {};
  let completed = 0;

  async function worker() {
    while (completed < total) {
      completed++;
      const { ms, status } = await makeRequest();
      latencies.push(ms);
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  latencies.sort((a, b) => a - b);
  return { latencies, statusCounts };
}

export async function runBenchmark({ requests = 80, concurrency = 10, thresholdMs = 200 } = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'benchmark-'));
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  const config = resolvePaths({ root: repoRoot, domain: FIXTURE_DOMAIN });

  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const indexHtml = await (await fetch(`${base}/`)).text();
    const dashToken = indexHtml.match(/const AIOS_TOKEN = "([^"]+)"/)?.[1];

    const results = [];
    for (const endpoint of ENDPOINTS) {
      const created = await (await fetch(`${base}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aios-token': dashToken },
        body: JSON.stringify({ name: `benchmark-${endpoint.name}`, scopes: endpoint.scopes }),
      })).json();

      const { latencies, statusCounts } = await loadTest({
        total: requests,
        concurrency,
        makeRequest: () => timedFetch(`${base}${endpoint.path}`, {
          method: endpoint.method,
          headers: { authorization: `Bearer ${created.id}` },
        }),
      });

      results.push({
        endpoint: endpoint.name,
        count: latencies.length,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: latencies[latencies.length - 1] ?? 0,
        statusCounts,
      });
    }
    return { results, thresholdMs };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function printReport({ results, thresholdMs }) {
  console.log(`\nAPI latency benchmark (threshold: p95 < ${thresholdMs}ms — SC-004)\n`);
  console.log('Endpoint'.padEnd(28), 'p50'.padStart(8), 'p95'.padStart(8), 'p99'.padStart(8), 'max'.padStart(8), '  status');
  let anyFailed = false;
  for (const r of results) {
    const failed = r.p95 >= thresholdMs;
    if (failed) anyFailed = true;
    console.log(
      r.endpoint.padEnd(28),
      `${r.p50.toFixed(1)}ms`.padStart(8),
      `${r.p95.toFixed(1)}ms`.padStart(8),
      `${r.p99.toFixed(1)}ms`.padStart(8),
      `${r.max.toFixed(1)}ms`.padStart(8),
      ' ', JSON.stringify(r.statusCounts), failed ? '  ⚠ p95 over threshold' : '',
    );
  }
  return anyFailed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const opts = {
    requests: Number(args.requests) || 80,
    concurrency: Number(args.concurrency) || 10,
    thresholdMs: Number(args['threshold-ms']) || 200,
  };
  const report = await runBenchmark(opts);
  const anyFailed = printReport(report);
  if (anyFailed) {
    console.error('\n[meridianos] One or more endpoints exceeded the latency threshold.');
    process.exit(1);
  }
  console.log('\n[meridianos] All endpoints within threshold.');
}
