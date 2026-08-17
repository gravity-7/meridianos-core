import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const safeFiles = [
  'scripts/run-visible-client-demo.mjs',
  'tests/fixtures/client-demo-fixture.mjs',
  'dashboard/app/shared/dashboard-panels.mjs',
  'dashboard/app/shared/legacy-parity-adapters.mjs',
];

test('dashboard demo and visual sources remain loopback-only and key-free', async () => {
  for (const file of safeFiles) {
    const source = await fs.readFile(file, 'utf8');
    const urlLiterals = [...source.matchAll(/https?:\/\/[^\s'"`]+/gi)].map((match) => match[0]);
    assert.ok(urlLiterals.every((value) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/i.test(value) || /^http:\/\/\$\{LOOPBACK_HOST\}/i.test(value)), `${file} contains a non-loopback URL`);
    assert.doesNotMatch(source, /(?:DEEPSEEK|ZAI|GLM|OPENAI|ANTHROPIC|STRIPE|SENDGRID|MAILGUN|POSTMARK)_KEY\s*=/i, `${file} contains a provider key assignment`);
    assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/i, `${file} reads a secret value`);
  }
});

test('live dashboard route does not use the cloud static fixture route', async () => {
  const [server, launcher, browserSpec] = await Promise.all([
    fs.readFile('dashboard/server.mjs', 'utf8'),
    fs.readFile('scripts/run-visible-client-demo.mjs', 'utf8'),
    fs.readFile('browser-tests/client-demo-package.spec.mjs', 'utf8'),
  ]);
  for (const source of [server, launcher, browserSpec]) assert.doesNotMatch(source, /cloud\/dashboard\/index\.html/);
  assert.match(launcher, /dashboardUrl/);
});
