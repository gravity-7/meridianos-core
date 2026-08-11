import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createPrReviewWorktree, dispatch, EXIT, parseArgs, parseVerdict, runAntigravity, validateReviewerSkill } from "../scripts/dispatch-review.mjs";

const root = process.cwd();
const validSkill = `---\nname: meridianos-review-antigravity\nforbidden_actions:\n  - Modify any source code\ndescription: read-only reviewer\n---\n`;

function fakeDeps() {
  return {
    root,
    now: () => 42,
    exists: existsSync,
    read: (path) => readFileSync(path, "utf8"),
    write: () => {},
    mkdir: () => {},
    remove: () => {},
    command: () => "",
    log: () => {},
  };
}

function reviewHarness({ review = { verdict: "APPROVE", output: "### Verdict: APPROVE" }, budget = { ok: true } } = {}) {
  let cleaned = false;
  let posted = null;
  return {
    checkBudget: async () => budget,
    createWorktree: () => ({ ok: true, path: root, head: "head", cleanup: () => { cleaned = true; } }),
    createContext: () => ({ base: "base", contextPath: "context.md" }),
    runReview: async () => review,
    postComment: (_pr, body) => { posted = body; return true; },
    state: () => ({ cleaned, posted }),
  };
}

test("requires an explicit spec and the Antigravity-only agent selector", () => {
  assert.equal(parseArgs(["19", "--agent=antigravity"]).ok, false);
  assert.equal(parseArgs(["19", "--spec=specs/011-ui-platform-foundation", "--agent=claude"]).ok, false);
  assert.deepEqual(parseArgs(["19", "--spec=specs/011-ui-platform-foundation", "--agent=antigravity"]), { ok: true, prNumber: 19, specDir: "specs/011-ui-platform-foundation" });
});

test("approves only a posted explicit APPROVE verdict", async () => {
  const harness = reviewHarness();
  const result = await dispatch({ prNumber: 19, specDir: "specs/011-ui-platform-foundation" }, { ...fakeDeps(), ...harness });
  assert.equal(result.exitCode, EXIT.APPROVE);
  assert.match(harness.state().posted, /### Verdict: APPROVE/);
  assert.equal(harness.state().cleaned, true, "review worktree is cleaned after approval");
});

test("requested changes return a non-zero exit code", async () => {
  const harness = reviewHarness({ review: { verdict: "REQUEST_CHANGES", output: "### Verdict: REQUEST_CHANGES" } });
  const result = await dispatch({ prNumber: 19, specDir: "specs/011-ui-platform-foundation" }, { ...fakeDeps(), ...harness });
  assert.equal(result.exitCode, EXIT.REQUEST_CHANGES);
  assert.equal(harness.state().cleaned, true);
});

test("a timeout is blocked and posted as PENDING/BLOCKED", async () => {
  const harness = reviewHarness({ review: { verdict: "ERROR", output: "### Verdict: ERROR\n\nReview Status: PENDING/BLOCKED", error: "timeout" } });
  const result = await dispatch({ prNumber: 19, specDir: "specs/011-ui-platform-foundation" }, { ...fakeDeps(), ...harness });
  assert.equal(result.exitCode, EXIT.BLOCKED);
  assert.match(harness.state().posted, /PENDING\/BLOCKED/);
});

test("budget exhaustion blocks review and never returns approval", async () => {
  const harness = reviewHarness({ budget: { ok: false, error: "Antigravity 5H budget is exhausted." } });
  const result = await dispatch({ prNumber: 19, specDir: "specs/011-ui-platform-foundation" }, { ...fakeDeps(), ...harness });
  assert.equal(result.exitCode, EXIT.BLOCKED);
  assert.match(harness.state().posted, /PENDING\/BLOCKED/);
  assert.equal(harness.state().cleaned, false, "no worktree is created after failed preflight");
});

test("malformed output and undispositioned medium findings cannot approve", () => {
  assert.equal(parseVerdict("### Verdict: maybe").verdict, "ERROR");
  assert.equal(parseVerdict("### Verdict: APPROVE\nSeverity: HIGH").verdict, "REQUEST_CHANGES");
  assert.equal(parseVerdict("### Verdict: APPROVE\nSeverity: MEDIUM").verdict, "REQUEST_CHANGES");
  assert.equal(parseVerdict("No Critical, High, Medium, or Low findings were identified.\n### Verdict: APPROVE").verdict, "APPROVE");
});

test("reviewer process errors remain machine-readable and use only read-only session controls", async () => {
  let args;
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  const result = await runAntigravity("review", { cwd: root }, {
    spawn: (_command, receivedArgs) => {
      args = receivedArgs;
      queueMicrotask(() => { child.stderr.emit("data", "terminal command permission denied"); child.emit("close", 1); });
      return child;
    },
  });
  assert.ok(args.includes("--mode") && args.includes("plan"));
  assert.ok(args.includes("--sandbox"));
  assert.equal(result.verdict, "ERROR");
  assert.match(result.output, /^### Verdict: ERROR$/m);
  assert.match(result.output, /Review Status: PENDING\/BLOCKED/);
  assert.equal((result.output.match(/^#{1,6}\s+Verdict:/gm) ?? []).length, 1);
});

test("missing reviewer instructions block dispatch", () => {
  const deps = { ...fakeDeps(), skillPath: "skill", instructionsPath: "missing", exists: (path) => path === "skill", read: () => validSkill };
  assert.equal(validateReviewerSkill(deps).ok, false);
});

test("PR review worktree is detached, isolated, and cleaned without touching the implementation worktree", () => {
  const calls = [];
  const deps = {
    ...fakeDeps(),
    command: (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      if (args[0] === "rev-parse") return "deadbeef\n";
      return "";
    },
  };
  const worktree = createPrReviewWorktree(19, deps);
  assert.equal(worktree.ok, true);
  assert.ok(calls.some(({ args }) => args.join(" ").includes("worktree add --detach")));
  assert.ok(calls.every(({ cwd }) => cwd === root), "git administration occurs only from the repository root");
  worktree.cleanup();
  assert.ok(calls.some(({ args }) => args.join(" ").includes("worktree remove --force")));
});

test("exit-code contract is stable", () => {
  assert.equal(EXIT.APPROVE, 0);
  assert.notEqual(EXIT.REQUEST_CHANGES, 0);
  assert.notEqual(EXIT.BLOCKED, 0);
});
