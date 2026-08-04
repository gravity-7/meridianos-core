#!/usr/bin/env node
/**
 * cli — root developer CLI. Today this only wraps the plugin scaffolding/publishing workflow
 * (US5, quickstart.md Scenario 5: `node cli.mjs plugin create`) — kept intentionally thin, since
 * every other entrypoint in this repo (gateway/cli.mjs, init.mjs, scripts/*) already has its own
 * dedicated command and doesn't need folding in here.
 *
 * Usage:
 *   node cli.mjs plugin create
 *   node cli.mjs plugin publish <pluginDir> <registryPath>
 */
import { pathToFileURL } from 'node:url';

const [, , group, subcommand, ...rest] = process.argv;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (group === 'plugin') {
    const { scaffoldPlugin, publishPlugin } = await import('./plugin-scaffold.mjs');
    const { createRotatingLogger } = await import('./daemon-logger.mjs');
    const { join } = await import('node:path');
    const logger = (() => {
      try { return createRotatingLogger({ logDir: join(process.cwd(), '.ai', 'logs') }); }
      catch { return { log: (_t, m) => console.log(`[meridianos] ${m}`), error: (_t, m, e) => console.error(`[meridianos] ${m}`, e ?? '') }; }
    })();

    try {
      if (subcommand === 'create') {
        const readline = await import('node:readline/promises');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const name = (await rl.question('Plugin name: ')).trim();
        const type = (await rl.question('Plugin type (intake-source/wire-adapter) [intake-source]: ')).trim() || 'intake-source';
        const author = (await rl.question('Author: ')).trim();
        rl.close();
        const result = scaffoldPlugin({ name, type, author, logger });
        console.log(`\n[meridianos] Created ${result.dir}`);
        console.log('[meridianos] Next: implement the IntakeSource contract in index.mjs, then `node test.mjs` to validate it.');
      } else if (subcommand === 'publish') {
        const [pluginDir, registryPath] = rest;
        if (!pluginDir || !registryPath) throw new Error('Usage: node cli.mjs plugin publish <pluginDir> <registryPath>');
        const result = publishPlugin({ pluginDir, registryPath, logger });
        console.log(`[meridianos] Published ${result.packageName}`);
      } else {
        console.error('Usage: node cli.mjs plugin <create|publish> [args]');
        process.exit(1);
      }
    } catch (err) {
      console.error(`[meridianos] ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error('Usage: node cli.mjs plugin <create|publish> [args]');
    process.exit(1);
  }
}
