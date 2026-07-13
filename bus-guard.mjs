/**
 * bus-guard — the BUS guardrail. Prompt-injection / smuggled-instruction defense for content
 * that crosses the agent bus (handoff markdown, feedback notes, task briefs) BEFORE it is
 * written where another agent will read and act on it.
 *
 * This is the runtime complement to the tenant's own committed-content guardrail check (the
 * `{cmd,script}` a DomainPlugin supplies via `config.domain.guardrailCheck` — see config.mjs and
 * verifier.mjs's createCheckRunners; tone / currency / secrets policy on tracked files).
 * That one asks "is this text on-brand and safe to publish"; this one asks "is this text trying
 * to hijack the agent that reads it". The bus calls `scanInbound` on every inbound payload; the
 * CLI (`node bus-guard.mjs`) scans the committed `.ai/inbox` + `.ai/feedback` files in CI.
 *
 * API:
 *   classifyInbound(text) -> { safe, severity: 'none'|'high'|'critical', findings:[{id,severity,excerpt}] }
 *   scanInbound(text)     -> reason string | null   (thin wrapper the bus uses to accept/reject)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAios } from './config.mjs';

/**
 * Ordered rules. `critical` = a clear attempt to override the agent; `high` = suspicious.
 * `scope`:
 *   'all'     — an imperative instruction-injection signal. Safe to apply to LONG technical docs
 *               (feature specs) too, because legitimate prose never says "ignore all previous
 *               instructions" or "you are now root".
 *   'message' — a keyword-PROXIMITY heuristic that false-positives on legitimate technical content
 *               (an auth spec says "email + password"; a schema spec says "drop table"). Applied
 *               only to short bus MESSAGES (inbox/feedback), never to specs.
 */
export const RULES = [
  { id: 'override-instructions', severity: 'critical', scope: 'all',     re: /ignore\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|messages?)/i },
  { id: 'disregard-governance',  severity: 'critical', scope: 'all',     re: /disregard\s+(the\s+)?(constitution|guardrails?|rules?|instructions?|policy)/i },
  { id: 'ignore-your-training',  severity: 'critical', scope: 'all',     re: /\bignore\s+your\s+(instructions?|guidelines?|training|system\s+prompt)\b/i },
  { id: 'reveal-system-prompt',  severity: 'critical', scope: 'all',     re: /\b(reveal|print|repeat|show|output)\b.{0,24}\b(system|developer)\s+prompt\b/i },
  { id: 'role-hijack',           severity: 'critical', scope: 'all',     re: /\byou\s+are\s+now\s+(?:an?\s+|the\s+|in\s+)?(?:unrestricted|jailbroken|dan\b|developer\s+mode|admin|root|a\s+different)/i },
  { id: 'act-as-jailbreak',      severity: 'critical', scope: 'all',     re: /\bact\s+as\s+(?:an?\s+)?(?:unrestricted|jailbroken|dan|evil|admin|root)\b/i },
  { id: 'exfiltrate-secrets',    severity: 'critical', scope: 'message', re: /\b(exfiltrate|leak|reveal|send|email|post)\b.{0,30}\b(secret|token|api[_-]?key|password|credential|\.env)\b/i },
  { id: 'role-tags',             severity: 'high',     scope: 'all',     re: /<\/?(system|assistant|developer|tool_call|function_call)\b/i },
  { id: 'destructive-directive', severity: 'high',     scope: 'message', re: /\b(force[- ]?push|rm\s+-rf|drop\s+table|delete\s+the\s+repo|wipe\s+the)\b/i },
  { id: 'prompt-boundary',       severity: 'high',     scope: 'all',     re: /-{3,}\s*end of (system|prompt)\b|\bBEGIN\s+SYSTEM\b/i },
];

/** Classify one blob of text. `context: 'spec'` applies only the scope:'all' injection rules
 *  (skips the keyword-proximity heuristics that false-positive on technical prose). */
export function classifyInbound(text, { context = 'message' } = {}) {
  const s = String(text ?? '');
  const findings = [];
  const rules = context === 'spec' ? RULES.filter((r) => r.scope === 'all') : RULES;
  for (const r of rules) {
    const m = s.match(r.re);
    if (m) {
      const start = Math.max(0, m.index - 12);
      const excerpt = s.slice(start, m.index + m[0].length + 12).replace(/\s+/g, ' ').trim();
      findings.push({ id: r.id, severity: r.severity, excerpt });
    }
  }
  const severity = findings.some((f) => f.severity === 'critical') ? 'critical'
    : findings.some((f) => f.severity === 'high') ? 'high' : 'none';
  return { safe: findings.length === 0, severity, findings };
}

/** The bus's accept/reject gate: a reason string if the text should be quarantined, else null. */
export function scanInbound(text) {
  const { safe, findings } = classifyInbound(text);
  if (safe) return null;
  const f = findings[0];
  return `${f.id} (${f.severity}) — "${f.excerpt}"`;
}

// ---- CI scanner: node tools/aios/bus-guard.mjs -------------------------------------------
// inbox/feedback are the classic bus surfaces. features/*/spec.md is ALSO untrusted-in and higher
// risk: the launcher pastes the referenced spec VERBATIM into the agent's prompt (launcher.buildPrompt),
// so a poisoned spec is a direct injection vector (postmortem security P2). Scanned recursively.
const BUS_DIRS = ['.ai/inbox', '.ai/feedback'];
const SPEC_DIR = '.ai/features';

/** Recursively collect *.md paths (relative to root) under a dir. */
function collectMarkdown(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${rel}/${name.name}`;
    if (name.isDirectory()) out.push(...collectMarkdown(root, childRel));
    else if (name.name.endsWith('.md')) out.push(childRel);
  }
  return out;
}

/** Scan committed bus files (and feature specs); return { files, findings:[{file, ...finding}] }.
 *  Messages (inbox/feedback) get the full ruleset; specs get the injection-only subset so
 *  legitimate technical prose ("email + password", "drop table") doesn't false-positive.
 *  `config` is the injected AiosConfig (REQUIRED); it only matters when `root` itself is
 *  omitted. */
export function scanBusFiles({ root = undefined, dirs = BUS_DIRS, includeSpecs = true, config } = {}) {
  root = root ?? config.repoRoot;
  const findings = [];
  const messages = [];
  for (const d of dirs) {
    const abs = join(root, d);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) if (name.endsWith('.md')) messages.push(`${d}/${name}`);
  }
  const specs = includeSpecs ? collectMarkdown(root, SPEC_DIR) : [];

  const scan = (rel, context) => {
    const { findings: fs } = classifyInbound(readFileSync(join(root, rel), 'utf8'), { context });
    for (const f of fs) findings.push({ file: rel, ...f });
  };
  for (const rel of messages) scan(rel, 'message');
  for (const rel of specs) scan(rel, 'spec');
  return { files: messages.length + specs.length, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Diagnostic-only default plugin — see budget.mjs's identical comment.
  const DIAG_DOMAIN = { agents: ['a', 'b'], prompts: { implRules: [], reviewCriteria: [] }, guardrailCheck: null, boardTitle: 'AIOS', riskToAction: {}, knownRiskTags: [] };
  const { config } = createAios({ domain: DIAG_DOMAIN });
  const { files, findings } = scanBusFiles({ config });
  const critical = findings.filter((f) => f.severity === 'critical');
  if (findings.length === 0) {
    process.stdout.write(`[bus-guard] OK - ${files} bus file(s) clean (no injected instructions).\n`);
  } else {
    for (const f of findings) process.stdout.write(`[bus-guard] ${f.severity.toUpperCase()} ${f.file}: ${f.id} — "${f.excerpt}"\n`);
    process.stdout.write(`[bus-guard] ${findings.length} finding(s) across ${files} file(s); ${critical.length} critical.\n`);
  }
  process.exit(critical.length ? 1 : 0);
}
