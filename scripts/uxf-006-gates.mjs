import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const UXF_THRESHOLDS = Object.freeze({
  bundleGzipBytes: 220 * 1024,
  localLcpP75Ms: 2500,
  cloudLcpP75Ms: 3500,
  interactionP95Ms: 100,
  tableFilterSortMs: 100,
  chartRenderMs: 500,
  refreshP95Ms: 1000,
  longTaskMs: 200,
  visualDiffPercent: 0.1,
});

const REQUIRED_SOURCES = Object.freeze([
  'dashboard/search.mjs', 'dashboard/uxf-telemetry.mjs', 'dashboard/static/app-platform.css',
  'browser-tests/uxf-006.spec.mjs', 'docs/legacy-parity-ledger.md', 'docs/uxf-006-rollout.md',
]);

function sourceSnapshot(root) {
  const read = (path) => readFileSync(resolve(root, path), 'utf8');
  const css = read('dashboard/static/app-platform.css');
  const packageJson = read('package.json');
  return {
    missing: REQUIRED_SOURCES.filter((path) => !existsSync(resolve(root, path))),
    reducedMotion: /prefers-reduced-motion/.test(css), forcedColors: /forced-colors/.test(css),
    focusVisible: /:focus-visible/.test(css), narrowViewport: /max-width:\s*320px/.test(css),
    touchTarget: /min-height:\s*2\.75rem/.test(css),
    forbiddenDependencies: /"(?:react|typescript|lucide)["']\s*:/.test(packageJson),
    criticalJsGzipBytes: gzipSync(read('dashboard/static/app-platform.mjs')).length,
  };
}

function finiteAtMost(measurements, key, max, failures) {
  if (!Number.isFinite(Number(measurements?.[key]))) failures.push(`missing measurement: ${key}`);
  else if (Number(measurements[key]) > max) failures.push(`${key} ${measurements[key]} exceeds ${max}`);
}

export function evaluateUxfGates({ source = {}, measurements = null } = {}) {
  const failures = [];
  if (source.missing?.length) failures.push(`missing source evidence: ${source.missing.join(', ')}`);
  for (const key of ['reducedMotion', 'forcedColors', 'focusVisible', 'narrowViewport', 'touchTarget']) if (source[key] !== true) failures.push(`source hook missing: ${key}`);
  if (source.forbiddenDependencies) failures.push('forbidden UI dependency found');
  if (Number.isFinite(Number(source.criticalJsGzipBytes)) && source.criticalJsGzipBytes > UXF_THRESHOLDS.bundleGzipBytes) failures.push(`critical JS gzip ${source.criticalJsGzipBytes} exceeds ${UXF_THRESHOLDS.bundleGzipBytes}`);
  if (!measurements) return { passed: failures.length === 0, failures, mode: 'source' };
  for (const [key, max] of Object.entries(UXF_THRESHOLDS)) finiteAtMost(measurements, key, max, failures);
  if (Number(measurements.a11yViolations) !== 0) failures.push(`a11y violations: ${measurements.a11yViolations}`);
  if (Number(measurements.visualDiffPercent) > UXF_THRESHOLDS.visualDiffPercent) failures.push('visual baseline diff exceeds threshold');
  const browsers = new Set(measurements.browsers ?? []);
  for (const browser of ['chrome', 'edge', 'firefox', 'safari', 'electron']) if (!browsers.has(browser)) failures.push(`browser evidence missing: ${browser}`);
  if (measurements.privacySafe !== true) failures.push('privacy-safe telemetry evidence missing');
  return { passed: failures.length === 0, failures, mode: 'full' };
}

function main() {
  const root = process.cwd(); const evidenceArg = process.argv.find((arg) => arg.startsWith('--evidence='));
  const source = sourceSnapshot(root);
  const measurements = evidenceArg ? JSON.parse(readFileSync(resolve(root, evidenceArg.slice('--evidence='.length)), 'utf8')) : null;
  const result = evaluateUxfGates({ source, measurements });
  console.log(JSON.stringify({ ...result, source }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
