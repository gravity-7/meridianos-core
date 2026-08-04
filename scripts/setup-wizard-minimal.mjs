#!/usr/bin/env node
/**
 * setup-wizard-minimal — console-based first-run setup wizard for the packaged binary (FR-003).
 *
 * Asks exactly 4 questions (spec Acceptance Scenario 1): Anthropic API key, DeepSeek API key,
 * monthly budget limit, and whether to install the daemon as a background service. Non-technical
 * users never touch policy.yaml or an .env file directly — this script writes both.
 *
 * Programmatic mode: pass `answers` to skip the readline prompts entirely (used by tests and by
 * the Electron GUI wizard's non-console equivalent), so the same write logic backs both UIs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as readline from 'node:readline/promises';
import { installService } from './install-service.mjs';

const QUESTIONS = [
  { key: 'anthropicApiKey', prompt: 'Anthropic API key (sk-ant-...): ' },
  { key: 'deepseekApiKey', prompt: 'DeepSeek API key (leave blank to skip): ' },
  { key: 'monthlyBudget', prompt: 'Monthly budget limit (USD, e.g. 100): ' },
  { key: 'installService', prompt: 'Install MeridianOS as a background service? (Y/n): ' },
];

/** Prompt for the 4 setup questions over the given input/output streams. */
async function promptAnswers({ input, output }) {
  const rl = readline.createInterface({ input, output });
  const answers = {};
  try {
    for (const q of QUESTIONS) {
      answers[q.key] = (await rl.question(q.prompt)).trim();
    }
  } finally {
    rl.close();
  }
  return answers;
}

/** Write provider API keys to a gitignored `.env` file (loaded by daemon-entry.mjs at startup). */
function writeEnvFile(repoRoot, { anthropicApiKey, deepseekApiKey }) {
  const envPath = join(repoRoot, '.env');
  const lines = [];
  if (anthropicApiKey) lines.push(`ANTHROPIC_API_KEY=${anthropicApiKey}`);
  if (deepseekApiKey) lines.push(`DEEPSEEK_KEY=${deepseekApiKey}`);
  writeFileSync(envPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  return envPath;
}

/**
 * Set (or add) `analytics.budget.monthlyLimit` in policy.yaml via a targeted text patch —
 * deliberately NOT a full parse/re-serialize round-trip, so hand-written comments and sections
 * this wizard doesn't understand (alert rules, provider blocks, etc.) are left byte-for-byte
 * untouched (unlike provider-wizard.mjs's full-document rewrite, which is fine for its narrower
 * `providers:` section but too destructive for a minimal first-run wizard touching a shared file).
 */
export function writeMonthlyBudget(repoRoot, monthlyLimit) {
  const policyPath = join(repoRoot, '.ai', 'policy.yaml');
  mkdirSync(join(repoRoot, '.ai'), { recursive: true });
  let raw = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';

  const limitLineRe = /^(\s*monthlyLimit:\s*).*$/m;
  if (limitLineRe.test(raw)) {
    raw = raw.replace(limitLineRe, `$1${monthlyLimit}`);
  } else {
    const block = `analytics:\n  budget:\n    monthlyLimit: ${monthlyLimit}\n`;
    raw = raw.length && !raw.endsWith('\n') ? `${raw}\n${block}` : `${raw}${block}`;
  }
  writeFileSync(policyPath, raw, 'utf8');
  return policyPath;
}

/**
 * Run the setup wizard end to end: prompt (or accept pre-supplied `answers`), write the .env and
 * policy.yaml budget, and optionally install the OS background service.
 * @param {{repoRoot: string, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, answers?: object, installServiceImpl?: Function}} opts
 */
export async function runSetupWizard({ repoRoot, input = process.stdin, output = process.stdout, answers, installServiceImpl = installService } = {}) {
  const resolved = answers ?? await promptAnswers({ input, output });

  const envPath = writeEnvFile(repoRoot, resolved);
  const policyPath = writeMonthlyBudget(repoRoot, resolved.monthlyBudget || 0);

  const wantsService = !/^n/i.test(String(resolved.installService ?? 'Y').trim());
  let service = null;
  if (wantsService) {
    service = installServiceImpl({ daemonPath: join(repoRoot, 'daemon-entry.mjs') });
  }

  return { ok: true, envPath, policyPath, serviceInstalled: !!service, service };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = process.cwd();
  console.log('MeridianOS Setup Wizard\n');
  try {
    const result = await runSetupWizard({ repoRoot });
    console.log(`\n[meridianos] Configuration saved: ${result.envPath}, ${result.policyPath}`);
    if (result.serviceInstalled) {
      console.log(`[meridianos] Background service installed (${result.service.mechanism}) — MeridianOS will start automatically.`);
    } else {
      console.log('[meridianos] Skipped service installation — run `node daemon-entry.mjs` manually to start MeridianOS.');
    }
  } catch (err) {
    console.error(`[meridianos] Setup failed: ${err.message}`);
    process.exit(1);
  }
}
