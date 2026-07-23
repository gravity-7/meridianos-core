/**
 * launcher — the live `launch()` callback for runner.executeRun(). Spawns an agent
 * headlessly via its CLI, waits for completion, and returns {outcome, note}.
 *
 * Both agents have headless modes:
 *   Claude:       claude -p "prompt" --session-id <uuid> --model <model> --permission-mode auto
 *   Antigravity:  agy -p "prompt" --model <model> --dangerously-skip-permissions
 *
 * SAFETY:
 *   - The prompt is built from the task's spec (the planner/founder wrote the spec; the
 *     launcher just passes it through — it never writes its own instructions).
 *   - Each spawn runs in its OWN isolated git worktree (worktree.mjs) with a unique session ID,
 *     so concurrent agents / manual git never collide in the main tree; the canonical state DB is
 *     shared via $AIOS_DB.
 *   - A 30-minute timeout (matching the lease TTL) kills any stuck process.
 *   - The watchdog reaper handles the "agent silently died" case by freeing the lease.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createWorktree, agentEnv, gitIdentityEnv } from './worktree.mjs';
import { resolveProvider } from './providers.mjs';
import { buildSpawnPlan, resolveOpencodeCmd } from './harness-adapters.mjs';
import { readUsage } from './usage-readers.mjs';
import { classifyExit } from './exit-classify.mjs';
import { resolveRoute } from './gateway/provider-registry.mjs';
import { applyGatewayInjection } from './gateway/inject.mjs';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — matches default lease TTL

// Which harness adapter an agent uses when the caller doesn't name one explicitly is now sourced
// from the injected DomainPlugin (`config.domain.agentHarness`) — this module has no baked-in
// tenant roster/harness map of its own (§1.4 full polish).

const STAGE = {
  spec:             { target: 'designing',      verb: 'Write the spec' },
  designing:        { target: 'ready-for-impl',  verb: 'Complete the design' },
  'ready-for-impl': { target: 'in-review',       verb: 'Implement it' },
  'in-progress':    { target: 'in-review',       verb: 'Implement it' },
};

function stageInstructions(status, taskId, cliPath) {
  const s = STAGE[status] ?? STAGE['ready-for-impl'];
  if (status === 'spec') return [
    'Write a detailed spec for this task. Create/update the spec file at `.ai/features/<feature>/spec.md`.',
    'Define the contracts (API shapes, component props, data models) the implementation must satisfy.',
    // G1: agent is responsible for writing ACs + complexity back to the DB so the Tier-2 DoR
    // check in planner.mjs can promote the task to `designing` without founder intervention.
    `After writing the spec, update the task with proper acceptance criteria and complexity score:`,
    `\`node ${cliPath} update-task --id ${taskId} --acceptance-criteria "<AC text>" --complexity <1-5>\``,
    `Then transition the task to \`${s.target}\`:`,
  ];
  if (status === 'designing') return [
    'Complete the design work for this task.',
    'For UI tasks: create mockups, define component hierarchy, design tokens, responsive behavior.',
    'For backend tasks: finalize the architecture, API contracts, and data models.',
    `Then transition the task to \`${s.target}\`:`,
  ];
  return [
    'Read the spec file referenced below, implement it to satisfy every acceptance criterion, then:',
    '  1. Commit your work to a feature branch and open a PR (`gh pr create`).',
    '  2. Record the PR number on the task AND move it to review, in ONE command:',
  ];
}

/**
 * Build the agent prompt from a task record. The prompt is status-aware:
 * spec tasks get spec-writing instructions, designing tasks get design
 * instructions, and ready-for-impl tasks get implementation instructions.
 * `config` is the injected AiosConfig (REQUIRED) — its `domain.prompts.implRules` supplies the
 * "Rules" section.
 */
export function buildPrompt(task, { branch, config } = {}) {
  const status = task.status ?? 'ready-for-impl';
  const s = STAGE[status] ?? STAGE['ready-for-impl'];
  // The tenant runner CLI agents invoke for transition/update-task — configurable via the injected
  // DomainPlugin's `cliPath` (config.mjs already defaults it to 'tools/aios/cli.mjs'; the `??` here
  // is belt-and-suspenders for a bare/partial config).
  const cliPath = config.domain.cliPath ?? 'tools/aios/cli.mjs';
  // The implement stage lands the task in `in-review`, which the verifier can only merge once a PR
  // is recorded — so the implement transition MUST carry --pr. Spec/design stages carry no PR.
  const transitionCmd = s.target === 'in-review'
    ? `node ${cliPath} transition --task ${task.id} --to in-review --actor <your-agent-name> --pr <PR_NUMBER>`
    : `node ${cliPath} transition --task ${task.id} --to ${s.target} --actor <your-agent-name>`;
  const parts = [
    `## Task: ${task.id} — ${task.title}`,
    '',
    'You are an autonomous agent executing a task from the AIOS task board.',
    ...stageInstructions(status, task.id, cliPath),
    '`' + transitionCmd + '`',
    '',
    'A task can only be merged once its PR number is recorded — do NOT move to in-review without --pr.',
    '',
  ];
  if (branch) {
    parts.push(
      `## Your workspace`,
      `You are in an ISOLATED git worktree already checked out on branch \`${branch}\` (based on the`,
      `latest origin/main). Commit your work HERE, push THIS branch, and open a PR against \`main\`.`,
      `Do NOT run \`git checkout main\` or switch branches — the main branch is checked out elsewhere`,
      `and switching will fail. Your AIOS CLI already targets the shared state DB (via $AIOS_DB).`,
      '',
    );
  }
  if (task.acceptance_criteria) {
    parts.push('## Acceptance Criteria', '', task.acceptance_criteria, '');
  }
  if (task.spec) {
    parts.push('## Spec file (READ THIS FIRST)', '', `Open and follow this spec file: ${task.spec}`, '');
  }
  if (task.contracts) {
    const c = typeof task.contracts === 'string' ? task.contracts : JSON.stringify(task.contracts);
    if (c && c !== '[]') parts.push('## Contracts', '', c, '');
  }
  parts.push(
    '## Rules',
    ...config.domain.prompts.implRules,
    branch ? `- Commit to your branch \`${branch}\`, push it, and open a PR against main` : '- Commit your work to a feature branch and open a PR',
  );
  return parts.join('\n');
}

/** Write a `{path, content}` file (from a harness adapter's spawn plan) into the worktree. */
function writePlanFile(worktreePath, { path, content }) {
  const abs = join(worktreePath, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * Kill an entire process tree on Windows (taskkill /T), or just the process on POSIX.
 * Best-effort — never throws.
 */
function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch { /* best-effort */ }
}

/**
 * Spawn a child process and wait for exit. Returns {outcome, note}.
 * Implements manual timeout (spawn's `timeout` option only works for exec/execFile).
 * Kills the full process tree on completion to prevent zombie child processes.
 */
export function spawnAndWait(cmd, args, { config, cwd = config.repoRoot, timeoutMs = DEFAULT_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', resolved = false;
    const done = (result) => { if (resolved) return; resolved = true; resolve(result); };

    // opencode's plan.cmd is the deterministic literal 'opencode' (see harness-adapters.mjs) —
    // resolved to the real platform binary only here, right before the actual OS spawn, so
    // buildSpawnPlan/launchAgent stay testable without opencode installed.
    const resolvedCmd = cmd === 'opencode' ? resolveOpencodeCmd() : cmd;

    const child = spawn(resolvedCmd, args, {
      cwd,
      env,               // undefined ⇒ inherit process.env (default); set for worktree runs (AIOS_DB)
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const pid = child.pid;

    // Manual timeout — kill the entire process tree if the agent runs too long
    const timer = setTimeout(() => {
      killTree(pid);
      done({ ...classifyExit({ timedOut: true, stdout, stderr }), stdout, stderr });
    }, timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d; if (stdout.length > 100_000) stdout = stdout.slice(-50_000); });
    child.stderr?.on('data', (d) => { stderr += d; if (stderr.length > 50_000) stderr = stderr.slice(-25_000); });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // Kill any lingering child processes (Claude Code spawns a process tree)
      killTree(pid);
      // A single typed classification (exit-classify.mjs) — no consumer greps the note prose.
      done({ ...classifyExit({ code, signal, stdout, stderr }), stdout, stderr });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      done({ ...classifyExit({ spawnError: e.message }) });
    });
  });
}

/**
 * The launch() callback. Creates an ISOLATED git worktree for the run (so concurrent agents and any
 * manual git never collide in the main tree — see worktree.mjs), resolves the harness's spawn plan
 * (cmd/args/env/files — see harness-adapters.mjs) for the run's provider, spawns the agent there with
 * the canonical DB wired via $AIOS_DB, waits for completion, then removes the worktree.
 *
 * `provider` (a resolved descriptor from providers.mjs) defaults to the native anthropic provider —
 * inject nothing, use the CLI's own login — so the default path is byte-identical to before harnesses
 * were pluggable. `harness` defaults to the adapter each agent has always used. `tier` (optional —
 * the task's complexity tier from model-router.mjs's routeModel()) is passed through to the harness
 * adapter for tier-aware wiring (e.g. claude-code's CLAUDE_CODE_EFFORT_LEVEL); adapters that don't
 * use it ignore it.
 *
 * Post-hoc token capture: none of the harness CLIs report usage at exit, so once the process
 * completes, `readUsage` (usage-readers.mjs) reads it back from wherever that harness actually
 * persists it (a claude-code transcript, an antigravity conversation db, or an opencode session
 * row) — generalizing the token capture every harness needs, not just claude-code. Read BEFORE
 * the worktree is torn down in `finally`, since the opencode reader matches on the worktree's own
 * directory path. Best-effort: `usage`/`tokens` are null when genuinely unknown, never fabricated.
 * `branch` is always surfaced (even on worktree-setup failure) so the runner can recover a PR the
 * agent opened but forgot to record ("exited ok but did not transition").
 * `config` is the injected AiosConfig (REQUIRED), threaded to buildPrompt's domain-governance
 * "Rules" section.
 *
 * Gateway wiring (3.2d, OPT-IN, locked decision D4): `config.gateway` is an OPTIONAL
 * `{ enabled, url, runs, registry }`. Absent, or `enabled !== true`, means do NOTHING — the spawn
 * env is byte-identical to before the gateway existed. When enabled, a run is only ever rewritten
 * to talk to the gateway when its provider ALSO resolves to a route in `config.gateway.registry`
 * (`resolveRoute`) AND that route's wire is `'anthropic'` — a native-anthropic provider has no
 * route (nothing in `registry.routes` names it) and so correctly bypasses the gateway, keeping
 * today's CLI-login path; a BYO-key openai-wire provider (opencode) has a route but the wrong
 * wire, and is left alone too (documented follow-up, 3.2d-ii — see gateway/inject.mjs). The
 * gateway token is registered in `config.gateway.runs` BEFORE the spawn and unregistered in a
 * `finally` AFTER it, so a token never outlives its run.
 * Returns a Promise<{outcome, note, reason, tokens, usage, branch}>.
 */
export async function launchAgent({ agent, model, task, session, provider, harness, tier, _spawn = spawnAndWait, config }) {
  const wt = createWorktree({ taskId: task.id, session, config });
  if (!wt.ok) return { outcome: 'failed', reason: 'spawn_error', note: `worktree setup failed: ${wt.error}`, tokens: null, usage: null, branch: wt.branch ?? null };
  try {
    const prompt = buildPrompt(task, { branch: wt.branch, config });
    const resolvedProvider = provider ?? resolveProvider('anthropic', undefined, config);
    const harnessName = harness ?? config.domain.agentHarness?.[agent] ?? agent;

    // G3: write a per-worktree .mcp.json for spec/designing stages when the tenant has configured
    // MCP servers. Implementation-stage runs are never given MCP config (cost + unnecessary).
    let mcpConfigPath = null;
    const contextStages = new Set(['spec', 'designing']);
    if (contextStages.has(task.status)) {
      const servers = resolveMcpServers(config.domain.mcpServers, task.status);
      if (servers.length > 0) {
        const mcpJson = JSON.stringify(buildMcpJson(servers), null, 2);
        writePlanFile(wt.path, { path: '.mcp.json', content: mcpJson });
        mcpConfigPath = '.mcp.json';
      }
    }

    const plan = buildSpawnPlan(harnessName, { prompt, model, session, provider: resolvedProvider, worktreePath: wt.path, tier, mcpConfigPath });

    // Gateway wiring (3.2d) — opt-in only; see the doc comment above. `gwConfig` absent or
    // `enabled !== true` means `finalPlan === plan` and `gatewayToken` stays null, so the rest of
    // this function runs byte-identical to before the gateway existed.
    const gwConfig = config.gateway;
    let finalPlan = plan;
    let gatewayToken = null;
    if (gwConfig?.enabled === true) {
      const route = resolveRoute(gwConfig.registry, resolvedProvider?.name);
      if (route?.wire === 'anthropic') {
        const ctx = {
          tenant: gwConfig.registry?.tenant,
          agent,
          session,
          task: task.id,
          runId: session ?? null,
          provider: resolvedProvider.name,
          model,
          tier,
        };
        const injected = applyGatewayInjection({ plan, route, ctx, gatewayUrl: gwConfig.url, runs: gwConfig.runs });
        finalPlan = injected.plan;
        gatewayToken = injected.token;
      }
    }

    for (const file of finalPlan.files ?? []) writePlanFile(wt.path, file);
    // gitIdentityEnv stamps the model into the commit identity so every PR the agent opens is
    // self-attributing (provenance gap: all autonomous commits landed as an anonymous
    // `AIOS Builder`). finalPlan.env still wins — an explicit gateway/plan override is intentional.
    const env = { ...agentEnv(process.env, {}, config), ...gitIdentityEnv(process.env, { agent, model }), ...finalPlan.env };
    try {
      const result = await _spawn(finalPlan.cmd, finalPlan.args, { cwd: wt.path, env });
      const usage = readUsage(harnessName, { agent, model, task, session, provider: resolvedProvider, harness: harnessName, worktreePath: wt.path }, result);
      return { ...result, tokens: usage?.totalTokens ?? null, usage, branch: wt.branch };
    } finally {
      if (gatewayToken) gwConfig.runs.unregisterRun(gatewayToken);
    }
  } finally {
    try { wt.cleanup(); } catch { /* best-effort */ }
  }
}

/**
 * Resolve the MCP server list for a given task stage from the DomainPlugin's `mcpServers`.
 * Accepts either a flat array (same servers for all stages) or a stage-keyed object.
 */
function resolveMcpServers(mcpServers, stage) {
  if (!mcpServers) return [];
  if (Array.isArray(mcpServers)) return mcpServers;                    // flat — all stages
  return mcpServers[stage] ?? mcpServers['*'] ?? [];                   // stage-specific with '*' fallback
}

/**
 * Build the `.mcp.json` object that Claude Code and agy expect.
 * Each entry: { name, command, args?, env? }
 */
function buildMcpJson(servers) {
  return {
    mcpServers: Object.fromEntries(
      servers.map(s => [s.name, {
        command: s.command,
        ...(s.args  ? { args:  s.args  } : {}),
        ...(s.env   ? { env:   s.env   } : {}),
      }])
    ),
  };
}
