#!/usr/bin/env node
/**
 * Dispatch the mandatory, read-only Antigravity review for a pull request.
 *
 * This dispatcher deliberately has no merge or source-write capability. It creates a
 * disposable detached worktree at the PR head, supplies the reviewer with the full
 * checkout plus complete (untruncated) review artifacts, posts the result, then removes
 * the worktree. A review gate fails closed: only an explicit APPROVE exits successfully.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const REVIEW_ROOT = join(REPO_ROOT, ".ai", "reviews");
const SKILL_PATH = join(REPO_ROOT, ".github", "skills", "meridianos-review-antigravity", "SKILL.md");
const INSTRUCTIONS_PATH = join(REPO_ROOT, ".github", "skills", "meridianos-review-antigravity", "instructions.md");
const BUDGET_EXHAUSTION_PCT = 80;

export const EXIT = Object.freeze({ APPROVE: 0, REQUEST_CHANGES: 2, BLOCKED: 3, USAGE: 64 });

export function parseArgs(argv) {
  const [pr, ...flags] = argv;
  const spec = flags.find((flag) => flag.startsWith("--spec="))?.slice("--spec=".length);
  const agent = flags.find((flag) => flag.startsWith("--agent="))?.slice("--agent=".length);
  if (!/^\d+$/.test(pr ?? "") || !spec || agent !== "antigravity" || flags.length !== 2) {
    return { ok: false, error: "Usage: node scripts/dispatch-review.mjs <PR_NUMBER> --spec=specs/<feature> --agent=antigravity" };
  }
  if (!isProjectRelative(spec)) return { ok: false, error: "--spec must be a project-relative directory under specs/." };
  return { ok: true, prNumber: Number(pr), specDir: spec };
}

function isProjectRelative(path) {
  return path.startsWith("specs/") && !path.includes("\\") && !path.split("/").includes("..") && !path.startsWith("/");
}

function command(command, args, { cwd = REPO_ROOT, input } = {}) {
  return execFileSync(command, args, { cwd, encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true });
}

function createDefaultDeps() {
  return {
    root: REPO_ROOT,
    exists: existsSync,
    read: (path) => readFileSync(path, "utf8"),
    write: (path, text) => writeFileSync(path, text),
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    command,
    spawn,
    now: () => Date.now(),
    log: console.log,
  };
}

export function validateReviewerSkill(deps) {
  const skillPath = deps.skillPath ?? SKILL_PATH;
  const instructionsPath = deps.instructionsPath ?? INSTRUCTIONS_PATH;
  if (!deps.exists(skillPath) || !deps.exists(instructionsPath)) return { ok: false, error: "Reviewer skill or its instructions.md is missing." };
  const skill = deps.read(skillPath);
  const markers = skill.match(/^---\s*$/gm) ?? [];
  if (markers.length !== 2 || !/^name:\s*["']?meridianos-review-antigravity["']?\s*$/m.test(skill)) {
    return { ok: false, error: "Reviewer skill frontmatter must contain exactly one valid document." };
  }
  if (!/forbidden_actions:[\s\S]*Modify any source code/i.test(skill) || !/read-only/i.test(skill)) {
    return { ok: false, error: "Reviewer skill must explicitly be read-only." };
  }
  return { ok: true };
}

export async function checkAntigravityBudget(deps) {
  try {
    const usageModule = await import(`${new URL("../antigravity-usage.mjs", import.meta.url).href}?review=${deps.now()}`);
    const usage = usageModule.antigravityUsage({ dirs: usageModule.defaultAntigravityDirs(), session5h: true });
    const billable = usage.last5h?.billable;
    if (!Number.isFinite(billable)) return { ok: false, error: "Antigravity usage is unavailable." };
    const cap = 150_000;
    const pct = Math.round((billable / cap) * 100);
    return { ok: pct < BUDGET_EXHAUSTION_PCT, billable, cap, pct, error: pct >= BUDGET_EXHAUSTION_PCT ? "Antigravity 5H budget is exhausted." : null };
  } catch (error) {
    return { ok: false, error: `Antigravity usage check failed: ${error.message}` };
  }
}

export function createPrReviewWorktree(prNumber, deps) {
  const dir = join(REVIEW_ROOT, `pr-${prNumber}-${deps.now()}-${Math.random().toString(36).slice(2, 8)}`);
  deps.mkdir(REVIEW_ROOT);
  try {
    // pull/<n>/head works for same-repository and fork PRs without checking out a branch.
    deps.command("git", ["fetch", "origin", `pull/${prNumber}/head`], { cwd: deps.root });
    const head = deps.command("git", ["rev-parse", "FETCH_HEAD"], { cwd: deps.root }).trim();
    deps.command("git", ["worktree", "add", "--detach", dir, head], { cwd: deps.root });
    return {
      ok: true,
      path: dir,
      head,
      cleanup: () => {
        try { deps.command("git", ["worktree", "remove", "--force", dir], { cwd: deps.root }); } finally {
          deps.remove(dir);
          try { deps.command("git", ["worktree", "prune"], { cwd: deps.root }); } catch { /* best effort after removal */ }
        }
      },
    };
  } catch (error) {
    deps.remove(dir);
    return { ok: false, error: `Could not create detached PR review worktree: ${error.message}`, cleanup: () => {} };
  }
}

function buildReviewPrompt({ prNumber, specDir, worktreePath, base, head, contextPath }) {
  return `You are executing the repository skill \`meridianos-review-antigravity\` for PR #${prNumber}.

You are a strictly READ-ONLY reviewer. Do not edit files, create files, commit, push, merge, change branches, install packages, or run mutating commands. You must review the complete detached checkout at \`${worktreePath}\` and every approved Spec Kit artifact below; do not rely on a truncated summary.

This headless review has no terminal-command permission. Do not attempt any shell or terminal command, including read-only commands. Use only the declared \`read_file\`, \`file_search\`, and \`grep_search\` tools to inspect the detached checkout, full context, and artifacts.

Review context (full, untruncated PR diff and artifacts): \`${contextPath}\`
Approved spec directory in checkout: \`${join(worktreePath, specDir)}\`
Reviewer instructions: \`${join(worktreePath, ".github/skills/meridianos-review-antigravity/instructions.md")}\`
Diff range: \`${base}..${head}\`

Your final response must contain exactly one standalone line: \`### Verdict: APPROVE\`, \`### Verdict: REQUEST_CHANGES\`, or \`### Verdict: ERROR\`. Use REQUEST_CHANGES for every Critical or High finding. A Medium finding must be REQUEST_CHANGES unless it cites a recorded \`Human disposition:\` with its location. Every finding must include severity, exact \`path:line\`, evidence, and an actionable recommendation.`;
}

function createContext({ prNumber, specDir, worktree, deps }) {
  const specRoot = resolve(worktree.path, specDir);
  if (!relative(worktree.path, specRoot) || relative(worktree.path, specRoot).startsWith("..") || !deps.exists(specRoot)) {
    throw new Error(`Approved spec directory does not exist in PR checkout: ${specDir}`);
  }
  const base = deps.command("git", ["merge-base", "origin/main", "HEAD"], { cwd: worktree.path }).trim();
  const diff = deps.command("git", ["diff", "--no-ext-diff", "--binary", `${base}..HEAD`], { cwd: worktree.path });
  const files = deps.command("git", ["ls-files", specDir, ".specify/memory/constitution.md"], { cwd: worktree.path }).trim().split("\n").filter(Boolean);
  const artifacts = files.map((file) => `\n\n===== ${file} =====\n${deps.read(join(worktree.path, file))}`).join("");
  const contextPath = join(worktree.path, ".antigravity-review-context.md");
  deps.write(contextPath, `# Complete review context for PR #${prNumber}\n\n## Full diff (${base}..${worktree.head})\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n## Approved Spec Kit artifacts${artifacts}\n`);
  return { base, contextPath };
}

export function parseVerdict(output) {
  const matches = [...String(output).matchAll(/^#{1,6}\s+Verdict:\s*(APPROVE|REQUEST_CHANGES|ERROR)\s*$/gm)];
  if (matches.length !== 1) return { verdict: "ERROR", error: "Malformed reviewer verdict: exactly one machine-readable verdict is required." };
  let verdict = matches[0][1];
  if (verdict === "APPROVE" && /\b(?:CRITICAL|HIGH)\b/i.test(output)) verdict = "REQUEST_CHANGES";
  if (verdict === "APPROVE" && /\bMEDIUM\b/i.test(output) && !/Human disposition:\s*\S+/i.test(output)) verdict = "REQUEST_CHANGES";
  return { verdict };
}

function blockedReviewOutput(reason, diagnostics = "") {
  const safeDiagnostics = String(diagnostics).replace(/^#{1,6}\s+Verdict:/gmi, "### Reviewer-reported verdict:");
  return `### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED\n\nReason: ${reason}${safeDiagnostics ? `\n\nReviewer diagnostics:\n${safeDiagnostics}` : ""}`;
}

export function runAntigravity(prompt, { cwd, timeoutMs = 30 * 60 * 1000 }, deps) {
  return new Promise((resolveResult) => {
    let settled = false;
    const child = deps.spawn("agy", ["--print", prompt, "--output-format", "text", "--mode", "plan", "--sandbox"], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolveResult({ verdict: "ERROR", output: blockedReviewOutput(`review timed out after ${timeoutMs}ms.`), error: "timeout" });
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ verdict: "ERROR", output: blockedReviewOutput("reviewer could not start.", error.message), error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = `${stdout}${stderr ? `\n\nSTDERR:\n${stderr}` : ""}`;
      if (code !== 0) {
        const error = stderr || `reviewer exited ${code}`;
        return resolveResult({ verdict: "ERROR", output: blockedReviewOutput(error, output), error });
      }
      const parsed = parseVerdict(output);
      if (parsed.error) return resolveResult({ verdict: "ERROR", output: blockedReviewOutput(parsed.error, output), error: parsed.error });
      resolveResult({ verdict: parsed.verdict, output });
    });
  });
}

function reviewComment(result) {
  return `## Antigravity Review\n\n${result.output || `### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED\n\nReason: ${result.error}`}\n`;
}

export async function dispatch({ prNumber, specDir }, injected = {}) {
  const deps = { ...createDefaultDeps(), ...injected };
  const publish = injected.postComment ?? postComment;
  const skill = validateReviewerSkill(deps);
  if (!skill.ok) {
    const result = { verdict: "ERROR", output: `### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED\n\nReason: ${skill.error}`, error: skill.error };
    return { exitCode: EXIT.BLOCKED, ...result, posted: publish(prNumber, reviewComment(result), deps) };
  }

  const budget = injected.checkBudget ? await injected.checkBudget() : await checkAntigravityBudget(deps);
  if (!budget.ok) {
    const result = { verdict: "ERROR", output: `### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED\n\nReason: ${budget.error}`, error: budget.error };
    const posted = publish(prNumber, reviewComment(result), deps);
    return { exitCode: EXIT.BLOCKED, ...result, posted };
  }

  const worktree = (injected.createWorktree ?? createPrReviewWorktree)(prNumber, deps);
  if (!worktree.ok) {
    const result = { verdict: "ERROR", output: `### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED\n\nReason: ${worktree.error}`, error: worktree.error };
    return { exitCode: EXIT.BLOCKED, ...result, posted: publish(prNumber, reviewComment(result), deps) };
  }
  try {
    const { base, contextPath } = (injected.createContext ?? createContext)({ prNumber, specDir, worktree, deps });
    const prompt = buildReviewPrompt({ prNumber, specDir, worktreePath: worktree.path, base, head: worktree.head, contextPath });
    const result = await (injected.runReview ?? runAntigravity)(prompt, { cwd: worktree.path }, deps);
    const posted = (injected.postComment ?? postComment)(prNumber, reviewComment(result), deps);
    if (!posted) return { exitCode: EXIT.BLOCKED, ...result, posted: false, error: "Failed to post review to the PR." };
    return { exitCode: result.verdict === "APPROVE" ? EXIT.APPROVE : result.verdict === "REQUEST_CHANGES" ? EXIT.REQUEST_CHANGES : EXIT.BLOCKED, ...result, posted: true };
  } catch (error) {
    const result = { verdict: "ERROR", output: `### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED\n\nReason: ${error.message}`, error: error.message };
    return { exitCode: EXIT.BLOCKED, ...result, posted: publish(prNumber, reviewComment(result), deps) };
  } finally {
    worktree.cleanup();
  }
}

function postComment(prNumber, body, deps) {
  const dir = join(REVIEW_ROOT, `post-${deps.now()}`);
  const file = join(dir, "comment.md");
  try {
    deps.mkdir(dir);
    deps.write(file, body);
    deps.command("gh", ["pr", "comment", String(prNumber), "--body-file", file], { cwd: deps.root });
    return true;
  } catch {
    return false;
  } finally {
    deps.remove(dir);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    return EXIT.USAGE;
  }
  const result = await dispatch(parsed);
  console.log(`Antigravity review verdict: ${result.verdict}${result.error ? ` — ${result.error}` : ""}`);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
