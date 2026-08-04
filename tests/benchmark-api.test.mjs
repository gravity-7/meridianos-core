/**
 * benchmark-api.test.mjs — code-review follow-up: "Add performance benchmarks for API
 * endpoints." Exercises scripts/benchmark-api.mjs's `runBenchmark()` directly (small request
 * count, for CI speed) — this proves the benchmark harness itself works end-to-end (spins up a
 * real server, mints real keys, fires real requests, computes real percentiles), not that
 * today's machine happens to be fast. A dedicated `npm run benchmark` invocation with realistic
 * request counts is how you'd actually check SC-004 compliance locally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark } from '../scripts/benchmark-api.mjs';

test('runBenchmark exercises all 4 read endpoints and returns sane percentile stats', async () => {
  const { results, thresholdMs } = await runBenchmark({ requests: 10, concurrency: 3, thresholdMs: 5000 });

  assert.equal(thresholdMs, 5000);
  assert.equal(results.length, 4);
  for (const r of results) {
    assert.equal(r.count, 10);
    assert.equal(r.statusCounts['200'], 10, `${r.endpoint} should have gotten 10x 200 OK`);
    assert.ok(r.p50 >= 0 && r.p50 <= r.p95 && r.p95 <= r.p99, `${r.endpoint} percentiles must be non-decreasing`);
    assert.ok(r.max >= r.p99, `${r.endpoint} max must be >= p99`);
  }
});
