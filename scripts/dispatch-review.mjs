#!/usr/bin/env node
/**
 * dispatch-review.mjs — Parallel PR review using Claude Code + Antigravity
 *
 * Usage: node scripts/dispatch-review.mjs <PR_NUMBER> [--spec=specs/001-feature]
 *
 * Spawns two independent review agents in parallel:
 *   1. Claude Code (Sonnet 5) — reviews code quality, spec compliance, constitution
 *   2. Antigravity (Gemini 3.1 Pro) — reviews architecture, edge cases, risks
 *
 * Each agent runs with a fresh prompt containing only the PR diff + spec context.
 * Neither agent has access to the implementation conversation history.
 * Results are posted as PR comments via GitHub API.
 *
 * 5H window budgeting: each agent targets ~2.5h of work per run (3-4 user stories).
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const REVIEWS_DIR = join(REPO_ROOT, ".ai", "reviews");

// ── CLI ──────────────────────────────────────────────────────────────────────

const prNumber = process.argv[2];
if (!prNumber || isNaN(Number(prNumber))) {
  console.error("Usage: node scripts/dispatch-review.mjs <PR_NUMBER> [--spec=specs/001-feature]");
  process.exit(1);
}

const specArg = process.argv.find(a => a.startsWith("--spec="));
const SPEC_DIR = specArg ? specArg.split("=")[1] : "specs/001-foundation-hardening";

// ── Helpers ──────────────────────────────────────────────────────────────────

function gh(args) {
  return execSync(`gh ${args}`, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Fetch PR context ─────────────────────────────────────────────────────────

console.log(`\n📋 Fetching PR #${prNumber} context...\n`);

const prTitle = gh(`pr view ${prNumber} --json title --jq .title`).trim();
const prBody = gh(`pr view ${prNumber} --json body --jq .body`).trim();
const prDiff = gh(`pr diff ${prNumber}`);
const prFiles = gh(`pr view ${prNumber} --json files --jq ".[].name"`);

// Load spec context
const specPath = join(REPO_ROOT, SPEC_DIR, "spec.md");
const planPath = join(REPO_ROOT, SPEC_DIR, "plan.md");
const tasksPath = join(REPO_ROOT, SPEC_DIR, "tasks.md");
const constitutionPath = join(REPO_ROOT, ".specify", "memory", "constitution.md");

const spec = existsSync(specPath) ? readFileSync(specPath, "utf8") : "(spec.md not found)";
const plan = existsSync(planPath) ? readFileSync(planPath, "utf8") : "(plan.md not found)";
const tasks = existsSync(tasksPath) ? readFileSync(tasksPath, "utf8") : "(tasks.md not found)";
const constitution = existsSync(constitutionPath) ? readFileSync(constitutionPath, "utf8") : "(constitution not found)";

// Truncate large artifacts to fit in agent context windows
const MAX_SPEC_LINES = 200;
const MAX_DIFF_LINES = 500;
const truncate = (text, maxLines) => {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n\n... (truncated ${lines.length - maxLines} lines)`;
};

// ── Review prompts ───────────────────────────────────────────────────────────

const sharedContext = `
## PR #${prNumber}: ${prTitle}

### PR Description
${prBody.slice(0, 1000)}

### Spec Context (${SPEC_DIR})
${truncate(spec, MAX_SPEC_LINES)}

### Constitution Principles (abbreviated)
${constitution.split("###").slice(0, 6).join("###")}

### Files Changed
${prFiles}

### PR Diff (abbreviated)
\`\`\`diff
${truncate(prDiff, MAX_DIFF_LINES)}
\`\`\`
`;

const claudeReviewPrompt = `${sharedContext}

You are an independent code reviewer (Claude Code / Sonnet 5). You have NO knowledge of how this code was written or what conversation led to it. Judge purely on what you see in the diff.

## Your Task
Review PR #${prNumber} against:
1. The spec.md acceptance criteria (above)
2. The MeridianOS Constitution principles (above)
3. Code quality standards (ES modules, .mjs extension, no require(), node: prefix)

## Output Format
### Verdict: ✅ APPROVE / ⚠️ CHANGES REQUESTED / ❌ REJECT

### Spec Compliance
| User Story | Acceptance Scenario | Status | Evidence |
|------------|---------------------|--------|----------|

### Constitution Violations
| Principle | Violation | File:Line | Fix |
|-----------|-----------|-----------|-----|

### Code Quality Issues
- [file:line] specific issue → suggested fix

### Test Assessment
- Were new tests added for changed behavior? (yes/no/NA)
- Do existing tests cover the change paths?

Be specific. Reference exact file paths and line numbers from the diff.
`;

const antigravityReviewPrompt = `${sharedContext}

You are an independent architecture reviewer (Antigravity / Gemini 3.1 Pro). You have NO knowledge of how this code was designed or what decisions were made. Judge purely on architecture and patterns.

## Your Task
Review PR #${prNumber} for:
1. Architectural fit — does this follow MeridianOS module patterns?
2. Zero-dependency check — any new imports that aren't node:* or better-sqlite3?
3. Gateway metering — does this change preserve the gateway as single source of truth?
4. Configuration — is behavior config-driven, not hardcoded?
5. Cross-cutting risks — what could break in production?

## Output Format
### Verdict: ✅ APPROVE / ⚠️ CHANGES REQUESTED / ❌ REJECT

### Architecture Assessment
- Module placement: [correct / concerns]
- Data flow impact: [assessment]
- Gateway compliance: [pass / fail with details]

### Risk Register
| Risk | Severity | Mitigation |
|------|----------|------------|

### Dependencies
- New imports: [list or "none"]
- Zero-dependency violation: [yes/no, details]

### Recommendation
- [Clear merge/block/rework guidance]
`;

// ── Save prompts for reproducibility ─────────────────────────────────────────

ensureDir(REVIEWS_DIR);
const runDir = join(REVIEWS_DIR, `pr-${prNumber}-${Date.now()}`);
ensureDir(runDir);

writeFileSync(join(runDir, "claude-review-prompt.md"), claudeReviewPrompt);
writeFileSync(join(runDir, "antigravity-review-prompt.md"), antigravityReviewPrompt);
writeFileSync(join(runDir, "pr-diff.txt"), prDiff);
writeFileSync(join(runDir, "pr-context.json"), JSON.stringify({ prNumber, title: prTitle, specDir: SPEC_DIR, files: prFiles.split("\n") }, null, 2));

console.log(`Review prompts saved to ${runDir}`);

// ── Spawn review agents ──────────────────────────────────────────────────────

/**
 * Run a review agent with a timeout (5H window safety).
 * Returns { agent, verdict, output, error? }
 */
async function runReviewAgent(name, promptFile, timeoutMs = 30 * 60 * 1000) { // default 30min
  return new Promise((resolve) => {
    const startTime = Date.now();
    let cmd, args;

    if (name === "claude") {
      // Claude Code: read prompt file via stdin
      cmd = "claude";
      args = ["--print", "--output-format", "text"];
    } else if (name === "antigravity") {
      // Antigravity CLI
      cmd = "agy";
      args = ["chat", "--prompt-file", promptFile];
    } else {
      resolve({ agent: name, verdict: "ERROR", output: "", error: `Unknown agent: ${name}` });
      return;
    }

    console.log(`\n🚀 Spawning ${name} review agent...`);
    console.log(`   Command: ${cmd} ${args.join(" ")}`);
    console.log(`   Prompt: ${promptFile}`);
    console.log(`   Timeout: ${timeoutMs / 60000} minutes\n`);

    try {
      const prompt = readFileSync(promptFile, "utf8");
      const child = spawn(cmd, args, {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: timeoutMs,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("close", (code) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const output = stdout + (stderr ? `\n\nSTDERR:\n${stderr}` : "");
        
        // Parse verdict from output
        const verdictMatch = output.match(/Verdict:\s*(✅ APPROVE|⚠️ CHANGES REQUESTED|❌ REJECT)/);
        const verdict = verdictMatch ? verdictMatch[1] : (code === 0 ? "UNKNOWN" : "ERROR");

        // Save output
        writeFileSync(join(runDir, `${name}-review-output.md`), output);

        console.log(`✅ ${name} review complete (${elapsed}s) — ${verdict}`);
        resolve({ agent: name, verdict, output, error: code !== 0 ? stderr.slice(-500) : null });
      });

      child.on("error", (err) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`❌ ${name} review failed (${elapsed}s): ${err.message}`);
        resolve({ agent: name, verdict: "ERROR", output: "", error: err.message });
      });

      // Feed prompt to stdin for Claude Code
      if (name === "claude") {
        child.stdin.write(prompt);
        child.stdin.end();
      }
    } catch (err) {
      resolve({ agent: name, verdict: "ERROR", output: "", error: err.message });
    }
  });
}

// ── Post results to PR ───────────────────────────────────────────────────────

function postReviewComment(agent, output, runDirPath) {
  const header = `## 🤖 ${agent === "claude" ? "Claude Code (Sonnet 5)" : "Antigravity (Gemini 3.1 Pro)"} Review

> Independent review — no knowledge of implementation conversation. Prompt and full output saved to \`${runDirPath}\`.

${output.slice(0, 60000)}`; // GitHub comment limit ~64KB

  const commentFile = join(runDir, `${agent}-pr-comment.md`);
  writeFileSync(commentFile, header);

  try {
    gh(`pr comment ${prNumber} --body-file "${commentFile}"`);
    console.log(`   📝 ${agent} review posted to PR #${prNumber}`);
  } catch (err) {
    console.error(`   ⚠️ Failed to post ${agent} review: ${err.message}`);
    console.log(`   Review saved to: ${commentFile}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════════════╗");
console.log("║   MeridianOS Parallel PR Review Dispatch     ║");
console.log("╠══════════════════════════════════════════════╣");
console.log(`║   PR:     #${prNumber}`);
console.log(`║   Title:  ${prTitle.slice(0, 45)}`);
console.log(`║   Spec:   ${SPEC_DIR}`);
console.log(`║   Files:  ${prFiles.split("\n").length} changed`);
console.log("╠══════════════════════════════════════════════╣");
console.log("║   Agents: Claude Code (Sonnet 5)             ║");
console.log("║           Antigravity (Gemini 3.1 Pro)       ║");
console.log("╚══════════════════════════════════════════════╝\n");

const results = await Promise.all([
  runReviewAgent("claude", join(runDir, "claude-review-prompt.md")),
  runReviewAgent("antigravity", join(runDir, "antigravity-review-prompt.md")),
]);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════╗");
console.log("║           Review Results Summary             ║");
console.log("╠══════════════════════════════════════════════╣");

for (const r of results) {
  const icon = r.verdict.includes("APPROVE") ? "✅" : r.verdict.includes("CHANGES") ? "⚠️" : "❌";
  console.log(`║  ${icon} ${r.agent.padEnd(15)} ${r.verdict}`);
}

console.log("╠══════════════════════════════════════════════╣");

const allApproved = results.every(r => r.verdict.includes("APPROVE"));
if (allApproved) {
  console.log("║  ✅ ALL AGENTS APPROVE — safe to merge       ║");
} else {
  console.log("║  ⚠️  REVIEW NEEDED — see PR comments         ║");
}
console.log("╚══════════════════════════════════════════════╝\n");

// Post results to PR
for (const r of results) {
  if (r.output) {
    postReviewComment(r.agent, r.output, runDir);
  }
}

console.log(`\n📁 Full review artifacts: ${runDir}\n`);
