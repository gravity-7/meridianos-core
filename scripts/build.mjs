#!/usr/bin/env node
/**
 * build — `bun compile` packaging pipeline for the standalone MeridianOS binary (FR-001).
 *
 * Produces a single self-contained executable (embedded Node-compatible runtime + better-sqlite3
 * native bindings) from `daemon-entry.mjs`, so a non-technical user never needs Node.js or npm
 * installed (research.md decision #1 — bun over pkg/nexe: smallest output, native SQLite support,
 * cross-platform compile from one machine).
 *
 * Usage:
 *   node scripts/build.mjs                                   # build for the current OS/arch
 *   node scripts/build.mjs --target=bun-windows-x64 --outfile=dist/meridianos-win-x64.exe
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..');
export const ENTRYPOINT = join(REPO_ROOT, 'daemon-entry.mjs');

/** bun compile `--target` per Node.js `process.platform`, and the default output filename. */
const PLATFORM_DEFAULTS = {
  win32: { target: 'bun-windows-x64', outfile: join('dist', 'meridianos-win-x64.exe') },
  darwin: { target: 'bun-darwin-arm64', outfile: join('dist', 'meridianos-macos-arm64') },
  linux: { target: 'bun-linux-x64', outfile: join('dist', 'meridianos-linux-x64') },
};

/** Parse `--key=value` CLI args into a plain object. */
export function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Build the standalone binary. Returns the resolved {target, outfile} on success.
 * @param {{target?: string, outfile?: string, platform?: string, execImpl?: Function}} [opts]
 */
export function buildBinary({ target, outfile, platform = process.platform, execImpl = execFileSync } = {}) {
  const defaults = PLATFORM_DEFAULTS[platform];
  if (!target || !outfile) {
    if (!defaults) throw new Error(`build: no default bun target for platform '${platform}' — pass --target and --outfile explicitly`);
  }
  target = target ?? defaults.target;
  outfile = outfile ?? defaults.outfile;

  const outfileAbs = join(REPO_ROOT, outfile);
  mkdirSync(dirname(outfileAbs), { recursive: true });

  // T102 — size/startup optimization: `--minify` shrinks the embedded JS graph (smaller binary,
  // less to parse at process start). Startup time itself is mostly won upstream of this script —
  // daemon-entry.mjs and dashboard/server.mjs already dynamic-`import()` per-request modules
  // (api/v1 routes, the tray icon) instead of loading everything eagerly at boot — `--minify`
  // here just makes sure that lazy-loading discipline isn't undone by an unminified bundle.
  execImpl('bun', ['compile', '--target', target, '--minify', '--outfile', outfileAbs, ENTRYPOINT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  return { target, outfile: outfileAbs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = buildBinary(args);
    console.log(`[meridianos] Built ${result.outfile} (target: ${result.target})`);
  } catch (err) {
    console.error(`[meridianos] Build failed: ${err.message}`);
    console.error('[meridianos] Ensure bun is installed: npm install -g bun (see https://bun.sh)');
    process.exit(1);
  }
}
