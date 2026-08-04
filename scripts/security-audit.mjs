#!/usr/bin/env node
/**
 * security-audit — lightweight, automated static security checks for the multi-tenant platform
 * (T202, Phase 10 polish). Not a substitute for a professional penetration test or a SAST tool
 * suite — it codifies the specific checks the manual audit in docs/security-audit.md relied on,
 * so they can be re-run on every release instead of trusting a point-in-time report to still be
 * true. Exits non-zero if any CRITICAL-severity check fails.
 *
 * Usage: node scripts/security-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const findings = []; // { severity: 'critical'|'warning'|'info', check, message }

function record(severity, check, message) {
  findings.push({ severity, check, message });
}

const SELF_PATH = fileURLToPath(import.meta.url);

function walkSourceFiles(dir, out = []) {
  const SKIP = new Set(['node_modules', '.git', '.ai', 'coverage', '.claude']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) && full !== SELF_PATH) {
      out.push(full);
    }
  }
  return out;
}

// ── Check 1: JWT secret file permissions ───────────────────────────────────
function checkJwtSecretPermissions() {
  const secretPath = path.join(REPO_ROOT, '.ai', 'auth', 'jwt-secret');
  if (!fs.existsSync(secretPath)) {
    record('info', 'jwt-secret-permissions', 'No JWT secret generated yet (run scripts/generate-jwt-secret.mjs before deploying) — nothing to check.');
    return;
  }
  const mode = fs.statSync(secretPath).mode & 0o777;
  if (process.platform !== 'win32' && mode !== 0o600) {
    record('critical', 'jwt-secret-permissions', `.ai/auth/jwt-secret has mode ${mode.toString(8)}, expected 0600 (owner read/write only)`);
  } else {
    record('info', 'jwt-secret-permissions', 'JWT secret file permissions OK.');
  }
}

// ── Check 2: SQL built via string interpolation/concat — flag for manual review ──
// NOTE: this codebase's standard (safe) idiom for a dynamic WHERE/SET/IN clause is to
// interpolate CLAUSE STRUCTURE (built from a hardcoded whitelist of column names, or `?`
// placeholder text) and bind actual VALUES separately via `.run(...params)` — that idiom
// matches the same textual shape as genuine unparameterized SQL, so this check cannot tell them
// apart automatically. It reports at 'warning', not 'critical': every hit needs a human to
// confirm the interpolated fragment is a fixed clause/column name, never raw user input.
function checkSqlInjectionPatterns() {
  const files = walkSourceFiles(REPO_ROOT);
  const templateInterp = /\b(exec|prepare)\s*\(\s*`[^`]*\$\{/;
  const concatSql = /(SELECT|INSERT|UPDATE|DELETE)\b[^;]*['"]\s*\+\s*\w/i;
  let hits = 0;
  for (const file of files) {
    if (file.includes(`${path.sep}tests${path.sep}`)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (templateInterp.test(text) || concatSql.test(text)) {
      hits++;
      record('warning', 'sql-injection-review', `${path.relative(REPO_ROOT, file)}: dynamic SQL clause — manually confirm the interpolated part is a fixed column/clause name, not user input`);
    }
  }
  if (hits === 0) record('info', 'sql-injection-review', 'No dynamic SQL clause construction found.');
}

// ── Check 3: no eval() ──────────────────────────────────────────────────────
function checkEval() {
  const files = walkSourceFiles(REPO_ROOT);
  let hits = 0;
  for (const file of files) {
    if (file.includes(`${path.sep}tests${path.sep}`)) continue;
    const codeLines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    if (codeLines.some((l) => /[^.\w]eval\(/.test(l))) {
      hits++;
      record('critical', 'eval-usage', `${path.relative(REPO_ROOT, file)}: uses eval()`);
    }
  }
  if (hits === 0) record('info', 'eval-usage', 'No eval() usage found.');
}

// ── Check 4: TLS verification not disabled ─────────────────────────────────
function checkTlsVerification() {
  const files = walkSourceFiles(REPO_ROOT);
  let hits = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/rejectUnauthorized\s*:\s*false/.test(text)) {
      hits++;
      record('critical', 'tls-verification', `${path.relative(REPO_ROOT, file)}: rejectUnauthorized: false disables TLS certificate verification`);
    }
  }
  if (hits === 0) record('info', 'tls-verification', 'No disabled TLS certificate verification found.');
}

// ── Check 5: shell commands built from string interpolation (command injection) ─
// NOTE: matches `execSync(` specifically, not bare `exec(` — this codebase's SQLite wrapper
// exposes its own unrelated `.exec()` method (bulk-SQL execution, not a shell call), which would
// otherwise collide with `child_process.exec` and produce a false positive on every ALTER
// TABLE/schema-migration call site.
function checkShellInjectionPatterns() {
  const files = walkSourceFiles(REPO_ROOT);
  const risky = /\bexecSync\s*\(\s*`[^`]*\$\{/;
  for (const file of files) {
    if (file.includes(`${path.sep}tests${path.sep}`) || file.includes(`${path.sep}scripts${path.sep}`)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (risky.test(text)) {
      record('warning', 'shell-injection', `${path.relative(REPO_ROOT, file)}: shell command built with template-string interpolation — verify every interpolated value is trusted/sanitized, not user input`);
    }
  }
}

// ── Check 6: .gitignore covers secrets/state ────────────────────────────────
function checkGitignore() {
  const gitignorePath = path.join(REPO_ROOT, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    record('critical', 'gitignore', '.gitignore is missing entirely');
    return;
  }
  const text = fs.readFileSync(gitignorePath, 'utf8');
  if (!/^\.ai\/\s*$/m.test(text)) {
    record('critical', 'gitignore', '.gitignore does not exclude .ai/ (secrets, control-plane.db, JWT secret would be trackable)');
  } else {
    record('info', 'gitignore', '.ai/ is excluded from version control.');
  }
}

// ── Check 7: npm audit (dependency vulnerabilities) ────────────────────────
function checkNpmAudit() {
  try {
    const raw = execSync('npm audit --omit=dev --json', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const report = JSON.parse(raw);
    const total = report.metadata?.vulnerabilities?.total ?? 0;
    const critical = report.metadata?.vulnerabilities?.critical ?? 0;
    const high = report.metadata?.vulnerabilities?.high ?? 0;
    if (critical > 0 || high > 0) {
      record('critical', 'npm-audit', `npm audit found ${critical} critical and ${high} high severity dependency vulnerabilities`);
    } else if (total > 0) {
      record('warning', 'npm-audit', `npm audit found ${total} lower-severity dependency vulnerabilities`);
    } else {
      record('info', 'npm-audit', 'npm audit: 0 known dependency vulnerabilities.');
    }
  } catch (err) {
    // npm audit exits non-zero when it finds vulnerabilities — its JSON is still on stdout.
    const raw = err.stdout?.toString();
    if (raw) {
      try {
        const report = JSON.parse(raw);
        const critical = report.metadata?.vulnerabilities?.critical ?? 0;
        const high = report.metadata?.vulnerabilities?.high ?? 0;
        if (critical > 0 || high > 0) {
          record('critical', 'npm-audit', `npm audit found ${critical} critical and ${high} high severity dependency vulnerabilities`);
        } else {
          record('warning', 'npm-audit', 'npm audit reported findings below high severity.');
        }
        return;
      } catch { /* fall through to generic warning below */ }
    }
    record('warning', 'npm-audit', `npm audit could not be run/parsed: ${err.message}`);
  }
}

function main() {
  checkJwtSecretPermissions();
  checkSqlInjectionPatterns();
  checkEval();
  checkTlsVerification();
  checkShellInjectionPatterns();
  checkGitignore();
  checkNpmAudit();

  const critical = findings.filter((f) => f.severity === 'critical');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');

  console.log(`\nMeridianOS security audit — ${new Date().toISOString()}\n`);
  for (const f of [...critical, ...warnings, ...info]) {
    const tag = f.severity.toUpperCase().padEnd(8);
    console.log(`[${tag}] ${f.check}: ${f.message}`);
  }
  console.log(`\n${critical.length} critical, ${warnings.length} warning, ${info.length} info.\n`);

  if (critical.length > 0) process.exit(1);
}

main();
