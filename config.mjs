/**
 * config — the single shared AiosConfig: every `.ai/*` (and worktree/pricing) path AIOS derives,
 * in one place. Before this, ~8 modules each redeclared their own REPO_ROOT and hardcoded a
 * `.ai/...` path off it (see docs/aios/REPO-AUDIT.md §1.1, coupling point #1) — this module is
 * the carve-out fix: every consumer now imports its paths from here instead of recomputing them.
 *
 * There is NO ambient singleton, and — as of ★③.2 Part B — NO default tenant either. A DomainPlugin
 * is a REQUIRED, explicitly-injected dependency: `resolvePaths({root, domain})` (pure) and
 * `createAios({root, domain})` (its `{config}`-wrapping convenience form) both THROW if `domain` is
 * omitted. Every function that needs a config takes it as a REQUIRED, explicitly-injected
 * parameter — a root (scheduler/cli/dashboard server) constructs one once via `createAios({domain})`
 * and threads it through every call. This is what makes AIOS multi-tenant: a second tenant injects
 * its OWN `{domain}` and gets an independent config with zero risk of cross-tenant leakage through
 * shared module state, and — critically — this package has zero knowledge of any tenant's identity,
 * including the product this repo ships. That product's own DomainPlugin now lives in its runner,
 * at `tools/aios/pv-domain.mjs` (`PV_DOMAIN`), which `tools/aios/{cli,scheduler}.mjs` inject via
 * `createAios({ domain: PV_DOMAIN })` at their composition root — byte-identical to this package's
 * pre-carve-out default.
 *
 * Root resolution order: an explicit `{root}` option > `$AIOS_ROOT` > the computed default (two
 * dirs up from this file, i.e. the repo root). `dbPath` additionally honors `$AIOS_DB` first,
 * read live on every access (a getter, not a cached literal) — this matches db.mjs's existing
 * `path || process.env.AIOS_DB || DEFAULT_DB_PATH` override chain, now sourced from one place.
 * `defaultDbPath` is the literal repo-relative default with NO `$AIOS_DB` layered on — callers
 * that need the canonical path regardless of any override (e.g. worktree.mjs wiring a spawned
 * agent's env) use that field, exactly like `DEFAULT_DB_PATH` did before this refactor.
 * Paths are pure infra and are NOT part of the DomainPlugin below — they never vary by tenant.
 *
 * `domain` is the DomainPlugin (REPO-AUDIT.md §1.3/§1.5/§1.2/§1.6, coupling points #3/#5/#2/#6):
 * the one tenant-identity object bundling everything that DOES vary by tenant —
 *   - `agents`         — the roster (was coupling point #3)
 *   - `prompts`        — the domain-governance prose baked into agent instructions (`implRules`,
 *                        `reviewCriteria`) (was coupling point #5)
 *   - `guardrailCheck` — the content-guardrail check-runner, `{cmd,script}` or `null` (was
 *                        coupling point #2 — "the sharpest hard dependency")
 *   - `boardTitle`     — the H1 rendered atop the founder's board.md dashboard
 *   - `riskToAction`   — the risk_tag → sensitive-action map the §6 governance hard-stop reads
 *   - `knownRiskTags`  — the risk_tag taxonomy `validate`'s invariant check accepts
 *                        (`boardTitle`/`riskToAction`/`knownRiskTags` were coupling point #6, the
 *                        last §1.6 PV hardcodes — after this AIOS core has zero hardcoded PV
 *                        strings/taxonomy)
 *   - `budgetMeter`    — OPTIONAL `{ [agent]: 'transcript'|'protobuf' }` map (§1.4 budget
 *                        simplification): which local usage store budget.mjs reads for each
 *                        roster agent. Omitted/unset agent ⇒ 'transcript'.
 *   - `cliPath`        — the tenant runner CLI agents invoke for transition/update-task
 *                        (launcher.mjs's buildPrompt) and the dashboard's action map
 *                        (dashboard/server.mjs). Defaults to `'tools/aios/cli.mjs'` (PV's runner),
 *                        so every existing tenant/test is byte-identical.
 *
 * Resolution: the caller supplies the WHOLE plugin — there is no baked default to field-fallback
 * onto anymore, so an omitted field on the passed-in `domain` resolves to `undefined`, not some
 * hidden tenant's value. `guardrailCheck` supports an explicit `null`, meaning "this tenant has no
 * guardrail check" — verifier.mjs's runner turns that into an honest `skip`, not a silent fail-open
 * `pass` (see verifier.mjs createCheckRunners).
 *
 * `agents` ALSO still honors `$AIOS_AGENTS` (comma-separated), applied on TOP of the resolved
 * `domain.agents` — but only when the plugin didn't set `agents` itself (see resolveDomain below).
 * NO env var exists for `prompts`/`guardrailCheck` — multi-line prose and a check-runner don't
 * belong in an env string; the injected DomainPlugin is how a tenant supplies those.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPUTED_DEFAULT_ROOT = join(HERE, '..', '..');

function parseAgentsEnv(v) {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Resolve a REQUIRED DomainPlugin — throws if none is supplied (no baked-in tenant to fall back
 *  to). `$AIOS_AGENTS` (comma-separated) overrides `domain.agents`, but ONLY when the plugin
 *  didn't explicitly set `agents` itself, so an explicit `{domain:{agents}}` still wins over the
 *  env var (matching the pre-refactor `agents ?? (env ? ... : default)` precedence: explicit
 *  option > env > plugin-omitted). There is no field-by-field fallback onto any default plugin —
 *  every field not present on `domain` resolves to `undefined`. */
function resolveDomain(domain) {
  if (domain == null) {
    throw new Error('AIOS: a DomainPlugin is required — pass { domain } (see the tenant module, e.g. tools/aios/pv-domain.mjs)');
  }
  const explicitAgents = 'agents' in domain;
  const agents = explicitAgents
    ? domain.agents
    : (process.env.AIOS_AGENTS ? parseAgentsEnv(process.env.AIOS_AGENTS) : undefined);
  return {
    agents,
    prompts: domain.prompts,
    guardrailCheck: domain.guardrailCheck,
    boardTitle: domain.boardTitle,
    riskToAction: domain.riskToAction,
    knownRiskTags: domain.knownRiskTags,
    // budgetMeter — OPTIONAL { [agent]: 'transcript'|'protobuf' } map telling budget.mjs which
    // local usage store to read for that roster agent (see budget.mjs's METER_READERS). Unset ⇒
    // budget.mjs defaults every agent to 'transcript', so tenants/tests that never set this keep
    // working unchanged (§1.4 budget simplification).
    budgetMeter: domain.budgetMeter,
    // defaultModels — OPTIONAL { [agent]: { [tier]: modelId } } map: the per-agent, per-tier model
    // lineup model-router.mjs's routeModel() falls back to when policy.model_routing has no entry
    // for a tier. Unset ⇒ routeModel simply has no tenant-specific fallback (§1.4 full polish).
    defaultModels: domain.defaultModels,
    // agentHarness — OPTIONAL { [agent]: harnessName } map: the harness a roster agent uses when
    // nothing more specific is configured (model-router.mjs's routeModel() and launcher.mjs's
    // launchAgent() both read this). Unset ⇒ falls back to the 'claude-code' ultimate default.
    agentHarness: domain.agentHarness,
    // taskCategories — OPTIONAL extra { [category]: {tier, desc} } entries MERGED OVER core's
    // generic TASK_CATEGORIES defaults in model-router.mjs (e.g. PV's 'money-math').
    taskCategories: domain.taskCategories,
    // tagToCategory — OPTIONAL extra { [riskTag]: category } entries MERGED OVER core's generic
    // TAG_TO_CATEGORY defaults in model-router.mjs (e.g. PV's 'money-math'/'payments' tags).
    tagToCategory: domain.tagToCategory,
    // mcpServers — OPTIONAL MCP server definitions for spec/designing agents. Written as a
    // per-worktree `.mcp.json` before spawning so agents can call external tools (Confluence,
    // GitHub, Figma, etc.) during context-gathering stages. Never used for impl stages.
    // Shape: Array<{name, command, args?, env?}>  — same servers for all context stages.
    //     OR Object<stageName, Array<...>>         — e.g. { spec: [...], designing: [...] }
    //        '*' key is a fallback for any unspecified stage.
    mcpServers: domain.mcpServers,
    // cliPath — the tenant runner CLI the agent invokes for transition/update-task (buildPrompt) and
    // the dashboard action map. Default 'tools/aios/cli.mjs' (PV's runner) so existing tenants are
    // unchanged; a non-PV tenant sets an absolute path to its own runner CLI.
    cliPath: domain.cliPath ?? 'tools/aios/cli.mjs',
  };
}

/** Build every AIOS path derived from a repo root. Pure — call fresh whenever env vars
 *  (AIOS_ROOT, AIOS_DB, AIOS_AGENTS) might have changed since the last call; nothing here is
 *  cached. `domain` is REQUIRED — throws if omitted (see resolveDomain). */
export function resolvePaths({ root, domain } = {}) {
  const repoRoot = root ?? process.env.AIOS_ROOT ?? COMPUTED_DEFAULT_ROOT;
  const defaultDbPath = join(repoRoot, '.ai', 'state', 'aios.db');
  const resolvedDomain = resolveDomain(domain);

  return {
    repoRoot,
    get dbPath() { return process.env.AIOS_DB || defaultDbPath; },
    defaultDbPath,
    boardJson: join(repoRoot, '.ai', 'state', 'board.json'),
    boardMd: join(repoRoot, '.ai', 'board.md'),
    policyPath: join(repoRoot, '.ai', 'policy.yaml'),
    runsPath: join(repoRoot, '.ai', 'runs', 'log.jsonl'),
    inboxDir: join(repoRoot, '.ai', 'inbox'),
    feedbackDir: join(repoRoot, '.ai', 'feedback'),
    featuresDir: join(repoRoot, '.ai', 'features'),
    secretFile: join(repoRoot, '.ai', 'secrets', 'escalation-webhook'),
    // Sibling of the repo root, deliberately OUTSIDE it — so the main tree's `git status` never
    // sees agent worktrees (see worktree.mjs). `$AIOS_WORKTREE_ROOT` overrides it so MULTIPLE
    // tenants under the same parent dir don't collide on one shared `.aios-worktrees` — the boot
    // `pruneAllWorktrees()` sweeps everything under this path, so two tenants sharing it would wipe
    // each other's live agent worktrees. Each tenant sets its own isolated root (default unchanged
    // for single-tenant/PV — byte-identical).
    worktreeRoot: process.env.AIOS_WORKTREE_ROOT || join(repoRoot, '..', '.aios-worktrees'),
    pricingPath: join(repoRoot, 'tools', 'aios', 'pricing.json'),
    domain: resolvedDomain,
  };
}

/** Public entrypoint: construct an AIOS config instance for a tenant. Roots call this once and
 *  inject the returned config into every operation. (Bound convenience methods can attach here
 *  later; for now it exposes the resolved config.) */
export function createAios({ root, domain } = {}) {
  const config = resolvePaths({ root, domain });
  return { config };
}

/** The reviewer for a given writer: the first roster agent that isn't `writer`. For today's
 *  2-agent roster this EQUALS the old `x === 'claude' ? 'antigravity' : 'claude'` binary swap;
 *  for an N-agent roster it generalizes to "the next other agent" (REPO-AUDIT.md §1.3, coupling
 *  point #3). Null/undefined-safe: an empty/missing roster or writer just yields `undefined`.
 *  `roster` is REQUIRED — callers pass `config.domain.agents` from their injected config (there is
 *  no ambient singleton to fall back to). */
export function reviewerFor(writer, roster) {
  if (!roster) return undefined;
  return roster.find((a) => a !== writer);
}
