/**
 * domain-record — DomainPlugin-as-data (card C2). Lets a tenant author its DomainPlugin as a plain
 * JSON/YAML record instead of writing a code module like `pv-domain.mjs`'s reference plugin (see
 * `tests/_fixture-domain.mjs` for the shape core tests inject in place of a real tenant). The
 * record's contract is documented in `schema/domain-record.schema.json` (JSON-Schema draft
 * 2020-12) — this module is the zero-dependency runtime counterpart: `validateDomainRecord`
 * hand-checks a record against that same contract (no ajv — see yaml-lite.mjs for the identical
 * "hand-roll the subset we need" precedent this repo already follows), and `loadDomainRecord`
 * compiles a validated record into an object structurally accepted by `createAios({ domain })`
 * (config.mjs's `resolveDomain` reads it — see that module's field-by-field doc comment).
 *
 * Data only, by design: a record cannot embed arbitrary code. The one place a code DomainPlugin
 * supplies a real function — `guardrailCheck` (README.md §6: tone/currency/secrets) — a record can
 * only pick from a FIXED set of declarative flags (`guardrails: {tone, currency, secrets}`), which
 * `compileGuardrailCheck` below turns into a real in-process check function. This is a deliberate
 * capability narrowing, not an oversight: a record-driven tenant gets the standard tone/currency/
 * secrets checks or none at all, never a custom script.
 *
 * NOTE on the compiled guardrailCheck's shape: every OTHER DomainPlugin in this codebase supplies
 * `guardrailCheck` as `{cmd, script} | null` — a description of an external process verifier.mjs's
 * createCheckRunners spawns (see config.mjs's doc comment and verifier.mjs). A record-compiled
 * guardrailCheck is instead a real in-process FUNCTION, `(text) => {status, detail, violations}` —
 * there is no external script for a declarative flag set to point at. Wiring verifier.mjs's
 * guardrails check-runner to invoke a function-shaped guardrailCheck (in addition to spawning a
 * {cmd,script} one) is out of scope for this bite; verifier.mjs is unmodified. Call the compiled
 * function directly (as this module's own tests do) until that follow-up lands.
 *
 * BYO-key invariant: nothing in this record schema has a place for a literal secret — `mcpServers`
 * env values (passed through verbatim) and any future provider/source config must be env-var NAMES,
 * exactly like providers.mjs's `keyEnv`.
 */
import { readFileSync } from 'node:fs';
import { parseYaml } from './yaml-lite.mjs';

const TIERS = ['simple', 'medium', 'medium_high', 'complex', 'critical'];
const BUDGET_METERS = ['transcript', 'protobuf'];
const GUARDRAIL_FLAGS = ['tone', 'currency', 'secrets'];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ---- validation ---------------------------------------------------------------------------

/** Validate a parsed record against schema/domain-record.schema.json's contract. Never throws —
 *  returns `{ok, errors}` with one human-readable, field-prefixed message per problem (AC2: a
 *  missing `roster` yields an error whose text names "roster"). */
export function validateDomainRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) {
    return { ok: false, errors: ['record: must be an object'] };
  }

  // ---- required: name -------------------------------------------------------------------
  if (!('name' in record)) errors.push('name: required (non-empty string)');
  else if (!isNonEmptyString(record.name)) errors.push('name: must be a non-empty string');

  // ---- required: roster ------------------------------------------------------------------
  if (!('roster' in record)) {
    errors.push('roster: required (array of at least one agent name)');
  } else if (!Array.isArray(record.roster) || record.roster.length === 0) {
    errors.push('roster: must be a non-empty array of agent name strings');
  } else {
    record.roster.forEach((a, i) => {
      if (!isNonEmptyString(a)) errors.push(`roster[${i}]: must be a non-empty string`);
    });
    const seen = new Set();
    const dupes = new Set();
    for (const a of record.roster) { if (seen.has(a)) dupes.add(a); seen.add(a); }
    if (dupes.size) errors.push(`roster: duplicate agent name(s): ${[...dupes].join(', ')}`);
  }

  // ---- required: modelRouting ------------------------------------------------------------
  if (!('modelRouting' in record)) {
    errors.push('modelRouting: required (object keyed by roster agent name)');
  } else if (!isPlainObject(record.modelRouting) || Object.keys(record.modelRouting).length === 0) {
    errors.push('modelRouting: must be a non-empty object keyed by agent name');
  } else {
    for (const [agent, cfg] of Object.entries(record.modelRouting)) {
      if (!isPlainObject(cfg)) { errors.push(`modelRouting.${agent}: must be an object`); continue; }
      if (Object.keys(cfg).length === 0) errors.push(`modelRouting.${agent}: must set at least one tier or "harness"`);
      for (const [k, v] of Object.entries(cfg)) {
        if (k === 'harness') {
          if (!isNonEmptyString(v)) errors.push(`modelRouting.${agent}.harness: must be a non-empty string`);
        } else if (!TIERS.includes(k)) {
          errors.push(`modelRouting.${agent}.${k}: unknown tier (expected one of ${TIERS.join(', ')}, or "harness")`);
        } else if (!isNonEmptyString(v)) {
          errors.push(`modelRouting.${agent}.${k}: must be a non-empty string (model id)`);
        }
      }
    }
  }

  // ---- optional: guardrails --------------------------------------------------------------
  if ('guardrails' in record) {
    if (!isPlainObject(record.guardrails)) {
      errors.push('guardrails: must be an object of {tone?, currency?, secrets?} booleans');
    } else {
      for (const [k, v] of Object.entries(record.guardrails)) {
        if (!GUARDRAIL_FLAGS.includes(k)) errors.push(`guardrails.${k}: unknown flag (expected one of ${GUARDRAIL_FLAGS.join(', ')})`);
        else if (typeof v !== 'boolean') errors.push(`guardrails.${k}: must be a boolean`);
      }
    }
  }

  // ---- optional: budget -------------------------------------------------------------------
  if ('budget' in record) {
    if (!isPlainObject(record.budget)) {
      errors.push('budget: must be an object keyed by agent name -> "transcript"|"protobuf"');
    } else {
      for (const [agent, meter] of Object.entries(record.budget)) {
        if (!BUDGET_METERS.includes(meter)) errors.push(`budget.${agent}: must be "transcript" or "protobuf"`);
      }
    }
  }

  // ---- optional: boardTitle ----------------------------------------------------------------
  if ('boardTitle' in record && !isNonEmptyString(record.boardTitle)) {
    errors.push('boardTitle: must be a non-empty string');
  }

  // ---- optional: riskTags -------------------------------------------------------------------
  if ('riskTags' in record) {
    if (!isPlainObject(record.riskTags)) {
      errors.push('riskTags: must be an object keyed by risk tag -> sensitive-action string');
    } else {
      for (const [tag, action] of Object.entries(record.riskTags)) {
        if (!isNonEmptyString(action)) errors.push(`riskTags.${tag}: must be a non-empty string (sensitive action name)`);
      }
    }
  }

  // ---- optional: taskCategories -------------------------------------------------------------
  if ('taskCategories' in record) {
    if (!isPlainObject(record.taskCategories)) {
      errors.push('taskCategories: must be an object keyed by category name');
    } else {
      for (const [cat, def] of Object.entries(record.taskCategories)) {
        if (!isPlainObject(def)) { errors.push(`taskCategories.${cat}: must be an object`); continue; }
        if (!TIERS.includes(def.tier)) errors.push(`taskCategories.${cat}.tier: must be one of ${TIERS.join(', ')}`);
        if (!isNonEmptyString(def.desc)) errors.push(`taskCategories.${cat}.desc: must be a non-empty string`);
        if ('tags' in def && (!Array.isArray(def.tags) || def.tags.some((t) => !isNonEmptyString(t)))) {
          errors.push(`taskCategories.${cat}.tags: must be an array of non-empty strings`);
        }
      }
    }
  }

  // ---- optional: sources ----------------------------------------------------------------------
  if ('sources' in record) {
    if (!Array.isArray(record.sources)) {
      errors.push('sources: must be an array of {type, ...} objects');
    } else {
      record.sources.forEach((s, i) => {
        if (!isPlainObject(s) || !isNonEmptyString(s.type)) errors.push(`sources[${i}]: must be an object with a non-empty "type" string`);
      });
    }
  }

  // ---- optional: mcpServers (loosely validated — pass-through data) -------------------------
  if ('mcpServers' in record && !Array.isArray(record.mcpServers) && !isPlainObject(record.mcpServers)) {
    errors.push('mcpServers: must be an array of server defs, or an object keyed by stage name');
  }

  // ---- optional: cliPath -----------------------------------------------------------------------
  if ('cliPath' in record && !isNonEmptyString(record.cliPath)) {
    errors.push('cliPath: must be a non-empty string');
  }

  return { ok: errors.length === 0, errors };
}

// ---- guardrailCheck compilation ------------------------------------------------------------

const TONE_RE = /\b(stupid|idiot(?:ic)?|dumb(?:ass)?|shut up|screw (?:you|this)|damn it|wtf|pissed off)\b/i;
const CURRENCY_RE = /[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?/;
const SECRET_PATTERNS = [
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'generic-secret-literal', re: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9/_+.-]{16,}['"]/i },
];

function excerptAround(s, m) {
  const start = Math.max(0, m.index - 12);
  return s.slice(start, m.index + m[0].length + 12).replace(/\s+/g, ' ').trim();
}

// Memoized by the exact {tone,currency,secrets} combination (only 8 possible), so two records
// with the SAME guardrails flags compile to the SAME function reference — required for AC6's
// deep-equal comparison between a YAML-loaded and a JSON-loaded plugin (two structurally-identical
// but separately-constructed functions are never deepEqual to each other; see assert.deepStrictEqual's
// reference-equality rule for functions).
const guardrailCheckCache = new Map();

/** Compile `{tone?, currency?, secrets?}` flags into a real, in-process guardrailCheck function —
 *  or `null` if no flag is set (the existing "this tenant has no guardrail check" convention;
 *  see config.mjs's resolveDomain doc comment). `(text) => {status:'pass'|'fail', detail, violations}`. */
export function compileGuardrailCheck(guardrails) {
  const tone = guardrails?.tone === true;
  const currency = guardrails?.currency === true;
  const secrets = guardrails?.secrets === true;
  if (!tone && !currency && !secrets) return null;

  const key = `${tone}|${currency}|${secrets}`;
  const cached = guardrailCheckCache.get(key);
  if (cached) return cached;

  function guardrailCheck(text) {
    const s = String(text ?? '');
    const violations = [];
    if (tone) {
      const m = s.match(TONE_RE);
      if (m) violations.push({ flag: 'tone', id: 'unprofessional-language', excerpt: excerptAround(s, m) });
    }
    if (currency) {
      const m = s.match(CURRENCY_RE);
      if (m) violations.push({ flag: 'currency', id: 'hardcoded-currency-literal', excerpt: excerptAround(s, m) });
    }
    if (secrets) {
      for (const { id, re } of SECRET_PATTERNS) {
        const m = s.match(re);
        if (m) { violations.push({ flag: 'secrets', id, excerpt: excerptAround(s, m) }); break; }
      }
    }
    return violations.length === 0
      ? { status: 'pass', detail: 'clean', violations: [] }
      : { status: 'fail', detail: violations.map((v) => v.id).join(', '), violations };
  }
  guardrailCheck.flags = Object.freeze({ tone, currency, secrets });

  guardrailCheckCache.set(key, guardrailCheck);
  return guardrailCheck;
}

// ---- modelRouting compilation ---------------------------------------------------------------

/** Split each agent's `{...tiers, harness?}` entry into DomainPlugin's two separate maps:
 *  `defaultModels[agent]` (tier -> model id) and `agentHarness[agent]` (only for agents that set
 *  one). `agentHarness` is `undefined` (omitted from the compiled plugin) when no agent set one. */
function compileModelRouting(modelRouting) {
  const defaultModels = {};
  const agentHarness = {};
  for (const [agent, cfg] of Object.entries(modelRouting)) {
    const { harness, ...tiers } = cfg;
    defaultModels[agent] = { ...tiers };
    if (harness !== undefined) agentHarness[agent] = harness;
  }
  return { defaultModels, agentHarness: Object.keys(agentHarness).length ? agentHarness : undefined };
}

// ---- loading ----------------------------------------------------------------------------------

function readRecordFile(path) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return parseYaml(text);
  if (path.endsWith('.json')) return JSON.parse(text);
  throw new Error(`loadDomainRecord: unsupported file extension for "${path}" — expected .yaml, .yml, or .json`);
}

/** Compile an ALREADY-VALIDATED record into a DomainPlugin — structurally accepted by
 *  `createAios({domain})` (every field config.mjs's resolveDomain reads is covered here; `prompts`
 *  is not part of this record's schema and is simply left unset, resolving to `undefined` exactly
 *  like any other DomainPlugin that omits it — see resolveDomain's doc comment). Optional record
 *  fields that are absent are OMITTED from the compiled plugin (not set to `undefined`), matching
 *  the style of the hand-authored plugins in this repo (e.g. tests/_fixture-domain.mjs). */
function compileDomainRecord(record) {
  const { defaultModels, agentHarness } = compileModelRouting(record.modelRouting);

  const plugin = {
    agents: [...record.roster],
    guardrailCheck: compileGuardrailCheck(record.guardrails),
    defaultModels,
  };
  if (agentHarness) plugin.agentHarness = agentHarness;
  if (record.boardTitle !== undefined) plugin.boardTitle = record.boardTitle;
  if (record.riskTags) {
    plugin.riskToAction = { ...record.riskTags };
    plugin.knownRiskTags = Object.keys(record.riskTags);
  }
  if (record.budget) plugin.budgetMeter = { ...record.budget };
  if (record.taskCategories) {
    const taskCategories = {};
    const tagToCategory = {};
    for (const [cat, def] of Object.entries(record.taskCategories)) {
      taskCategories[cat] = { tier: def.tier, desc: def.desc };
      for (const tag of def.tags ?? []) tagToCategory[tag] = cat;
    }
    plugin.taskCategories = taskCategories;
    if (Object.keys(tagToCategory).length) plugin.tagToCategory = tagToCategory;
  }
  if (record.mcpServers !== undefined) plugin.mcpServers = record.mcpServers;
  if (record.cliPath !== undefined) plugin.cliPath = record.cliPath;
  // `sources` is not read by config.mjs's resolveDomain today (see the schema's doc comment) —
  // carried through verbatim as forward-compatible metadata for the D4 IntakeSource registry.
  if (record.sources !== undefined) plugin.sources = record.sources;

  return plugin;
}

/** Load a DomainPlugin record — either an already-parsed object, or a path to a `.yaml`/`.yml`/
 *  `.json` file (YAML via yaml-lite.mjs, JSON via JSON.parse) — and compile it into a DomainPlugin
 *  object structurally accepted by `createAios({domain})`. Throws (with every validation error
 *  joined into the message) if the record fails `validateDomainRecord`. */
export function loadDomainRecord(pathOrObject) {
  const record = typeof pathOrObject === 'string' ? readRecordFile(pathOrObject) : pathOrObject;
  const { ok, errors } = validateDomainRecord(record);
  if (!ok) {
    throw new Error(`loadDomainRecord: invalid DomainPlugin record:\n  - ${errors.join('\n  - ')}`);
  }
  return compileDomainRecord(record);
}
