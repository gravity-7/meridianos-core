/**
 * publish.mjs — cross-platform npm publish script (Phase 0).
 *
 * Replaces scripts/publish.ps1. Uses node:crypto instead of Windows-only DPAPI.
 * Reads npm token from ~/.npmrc.
 *
 * Usage: node scripts/publish.mjs [--dry-run]
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, join } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const dryRun = process.argv.includes('--dry-run');

function getNpmToken() {
  const npmrcPath = join(homedir(), '.npmrc');
  if (!existsSync(npmrcPath)) return null;
  const content = readFileSync(npmrcPath, 'utf8');
  const match = content.match(/\/\/registry\.npmjs\.org\/:_authToken=(.+)/);
  return match ? match[1] : null;
}

function main() {
  const token = getNpmToken();
  if (!token) {
    console.error('[MERIDIANOS] publish: No npm token found. Fix: Run `npm login` or add //registry.npmjs.org/:_authToken= to ~/.npmrc');
    process.exit(1);
  }

  // Run tests before publish
  console.log('[MERIDIANOS] publish: Running tests...');
  if (!dryRun) {
    try {
      execSync('npm test', { stdio: 'inherit' });
    } catch {
      console.error('[MERIDIANOS] publish: Tests failed. Fix: Fix failing tests before publishing.');
      process.exit(1);
    }
  }

  // Publish
  const cmd = dryRun
    ? 'echo "[DRY RUN] Would run: npm publish --access public"'
    : 'npm publish --access public';

  console.log(`[MERIDIANOS] publish: ${dryRun ? '[DRY RUN] ' : ''}Publishing...`);
  try {
    execSync(cmd, {
      stdio: 'inherit',
      env: { ...process.env, NODE_AUTH_TOKEN: token },
    });
    console.log('[MERIDIANOS] publish: Success!');
  } catch (err) {
    console.error(`[MERIDIANOS] publish: Failed — ${err.message}`);
    process.exit(1);
  }
}

main();
