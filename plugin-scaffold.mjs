#!/usr/bin/env node
/**
 * plugin-scaffold — generates a new IntakeSource plugin from templates/plugin/ (US5, FR-016),
 * and publishes a finished one to the community registry (T078).
 *
 * Two halves:
 *   scaffoldPlugin()  — prompts (or accepts args) for name/type/author, writes plugin.json,
 *                        index.mjs, test.mjs, README.md into a new directory.
 *   publishPlugin()   — runs `npm publish` in the plugin directory, then records it in the
 *                        registry (plugin-registry.mjs) so it shows up in "Community Plugins".
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { upsertPluginEntry } from './plugin-registry.mjs';
import { createRotatingLogger } from './daemon-logger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(HERE, 'templates', 'plugin');

function fillTemplate(template, vars) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), template);
}

/** Prompt for the 3 scaffold questions (spec Acceptance Scenario: name, type, author). */
async function promptScaffoldAnswers({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    const name = (await rl.question('Plugin name: ')).trim();
    const type = (await rl.question('Plugin type (intake-source/wire-adapter) [intake-source]: ')).trim() || 'intake-source';
    const author = (await rl.question('Author: ')).trim();
    return { name, type, author };
  } finally {
    rl.close();
  }
}

/**
 * Generate a new plugin directory from templates/plugin/.
 * @param {{name: string, type?: string, author?: string, outDir?: string, logger?: object}} opts
 * @returns {{ok: boolean, dir: string}}
 */
export function scaffoldPlugin({ name, type = 'intake-source', author = '', outDir = process.cwd(), logger } = {}) {
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error("Plugin name must be lowercase, start with a letter, and use only letters/digits/hyphens (e.g. 'my-source')");
  }
  if (!['intake-source', 'wire-adapter'].includes(type)) {
    throw new Error("Plugin type must be 'intake-source' or 'wire-adapter'");
  }

  const dir = join(outDir, name);
  if (existsSync(dir)) throw new Error(`Directory already exists: ${dir}`);
  mkdirSync(dir, { recursive: true });

  const vars = { PLUGIN_NAME: name, PLUGIN_TYPE: type, AUTHOR: author || 'Unknown' };
  for (const [templateFile, outFile] of [
    ['plugin.json.template', 'plugin.json'],
    ['index.mjs.template', 'index.mjs'],
    ['test.mjs.template', 'test.mjs'],
    ['README.md.template', 'README.md'],
  ]) {
    const template = readFileSync(join(TEMPLATE_DIR, templateFile), 'utf8');
    writeFileSync(join(dir, outFile), fillTemplate(template, vars));
  }

  logger?.log('plugin-scaffold', `scaffolded new plugin '${name}' (${type}) at ${dir}`);
  return { ok: true, dir };
}

/**
 * Publish a scaffolded plugin: `npm publish` from its directory, then record it in the registry
 * so "Community Plugins" can list it. `execImpl` is injectable for tests (never runs a real
 * `npm publish` unless explicitly asked to).
 * @param {{pluginDir: string, registryPath: string, execImpl?: Function, dryRun?: boolean, logger?: object}} opts
 */
export function publishPlugin({ pluginDir, registryPath, execImpl = execFileSync, dryRun = false, logger } = {}) {
  const meta = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8'));
  const packageName = `@meridian-plugins/${meta.name}`;

  if (!dryRun) {
    execImpl('npm', ['publish', '--access', 'public'], { cwd: pluginDir, encoding: 'utf8' });
  }

  const entry = upsertPluginEntry(registryPath, {
    id: meta.name,
    name: meta.name,
    type: meta.type,
    description: meta.description ?? '',
    author: meta.author ?? 'Unknown',
    version: meta.version ?? '1.0.0',
    repository: packageName,
  });

  logger?.log('plugin-scaffold', `published '${meta.name}' as ${packageName} and registered it in the community catalog`);
  return { ok: true, packageName, entry };
}

// CLI entrypoint: `node plugin-scaffold.mjs create` / `node plugin-scaffold.mjs publish <dir> <registryPath>`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , subcommand, ...rest] = process.argv;
  const logger = (() => {
    try { return createRotatingLogger({ logDir: join(process.cwd(), '.ai', 'logs') }); }
    catch { return { log: (_t, m) => console.log(`[meridianos] ${m}`), error: (_t, m, e) => console.error(`[meridianos] ${m}`, e ?? '') }; }
  })();

  try {
    if (subcommand === 'create') {
      const answers = await promptScaffoldAnswers();
      const result = scaffoldPlugin({ ...answers, logger });
      console.log(`\n[meridianos] Created ${result.dir}`);
      console.log('[meridianos] Next: implement the IntakeSource contract in index.mjs, then `node test.mjs` to validate it.');
    } else if (subcommand === 'publish') {
      const [pluginDir, registryPath] = rest;
      if (!pluginDir || !registryPath) throw new Error('Usage: plugin publish <pluginDir> <registryPath>');
      const result = publishPlugin({ pluginDir, registryPath, logger });
      console.log(`[meridianos] Published ${result.packageName}`);
    } else {
      console.error('Usage: node plugin-scaffold.mjs <create|publish> [args]');
      process.exit(1);
    }
  } catch (err) {
    console.error(`[meridianos] ${err.message}`);
    process.exit(1);
  }
}
