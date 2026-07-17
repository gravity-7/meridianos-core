/**
 * inbox-source — the filesystem-backed `.ai/inbox` IntakeSource (ADR 0001 D2 bite #3).
 *
 * This is the FIRST concrete IntakeSource and the contract D4's pluggable IntakeSource registry
 * (Jira / ADO / Slack / email, later) will implement: `name` + `list()` + `read(id)` +
 * `submit(...)` over whatever the source actually is. Today the only source is the founder-owned
 * `.ai/inbox/` directory, written through the DocStore (doc-store.mjs) — same repo-root-scoped,
 * traversal-safe I/O every other AIOS write goes through.
 *
 * Two markdown+YAML-frontmatter file kinds live in `.ai/inbox/` side by side (plus a `README.md`
 * that is deliberately ignored — it documents the directory, it isn't an intake item):
 *   - `<feature>.handoff.md` — frontmatter: `feature, from, to, status` (what bus.submitHandoff
 *     writes today).
 *   - `<feature>.request.md` — frontmatter: `feature, slug, task_type, status, constitution`.
 * Body = everything after the closing `---` frontmatter fence.
 *
 * ---- Normalized item shape (the D4 IntakeSource contract) ----
 *   {
 *     id,      // filename stem, e.g. 'F0-a11y.request' / 'F1-1.1-design-system.handoff'
 *     source,  // 'filesystem-inbox'
 *     kind,    // 'handoff' | 'request'  (from the filename suffix)
 *     feature, // meta.feature ?? null
 *     status,  // meta.status ?? null
 *     path,    // repo-relative, e.g. '.ai/inbox/F0.handoff.md'
 *     meta,    // the FULL parsed frontmatter (from/to/slug/task_type/constitution/…)
 *     body,    // ONLY present on read(id); absent from list() (cheap listing — a remote source
 *              // would paginate metadata without fetching every body)
 *   }
 *
 * Scope note: `list()`/`read()` have no production caller yet — that's expected. They are the
 * seam D4's planning-refine step builds on. This bite is additive plus ONE behavior-preserving
 * refactor (bus.mjs's `submitHandoff` writes through this instead of a direct `docs.write(...)`).
 * No registry, no other sources, no ack/archive/delete/move — see D2-INBOX-SPEC.md's OUT-OF-SCOPE
 * list (this bite's contract).
 */
import { createDocStore } from './doc-store.mjs';
import { parseYaml } from './yaml-lite.mjs';

const SOURCE_NAME = 'filesystem-inbox';
const INBOX_REL = '.ai/inbox';
const FILENAME_RE = /^(.+)\.(handoff|request)\.md$/;

/** Parse a `---\n<yaml>\n---\n\n<body>` blob. Never throws: no/malformed frontmatter (including
 *  an unterminated fence) falls back to `{ meta: {}, body: text }` — the original text, untouched. */
export function parseFrontmatter(text) {
  const s = String(text ?? '');
  try {
    if (!s.startsWith('---\n')) return { meta: {}, body: s };
    const lines = s.slice(4).split(/\r?\n/);
    const closeIdx = lines.indexOf('---');
    if (closeIdx === -1) return { meta: {}, body: s };
    const meta = parseYaml(lines.slice(0, closeIdx).join('\n')) || {};
    const bodyLines = lines.slice(closeIdx + 1);
    if (bodyLines[0] === '') bodyLines.shift(); // strip exactly ONE leading blank line
    return { meta, body: bodyLines.join('\n') };
  } catch {
    return { meta: {}, body: s };
  }
}

/** Serialize a flat `{key: scalar}` object to `key: value` frontmatter lines, in insertion order. */
function serializeFrontmatter(meta) {
  return Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function buildFileBody(meta, markdown) {
  return `---\n${serializeFrontmatter(meta)}\n---\n\n${markdown}`;
}

/** filename -> {id, kind} | null (null for README.md, non-.md, or anything not *.handoff.md /
 *  *.request.md — those are ignored by list()). */
function parseFilename(name) {
  const m = name.match(FILENAME_RE);
  if (!m) return null;
  return { id: `${m[1]}.${m[2]}`, kind: m[2] };
}

/** id -> kind, or null if `id` doesn't end in a recognized suffix. */
function kindOfId(id) {
  if (id.endsWith('.handoff')) return 'handoff';
  if (id.endsWith('.request')) return 'request';
  return null;
}

/** Build the `filesystem-inbox` IntakeSource over `config` (and, optionally, an injected DocStore
 *  — tests/callers that already hold one reuse it instead of constructing a second). */
export function createInboxSource({ config, docs = createDocStore(config) }) {
  function list() {
    const names = docs.list(INBOX_REL);
    const items = [];
    for (const name of names) {
      const parsed = parseFilename(name);
      if (!parsed) continue; // README.md, non-.md, etc. — ignored
      const rel = `${INBOX_REL}/${name}`;
      let text;
      try { text = docs.read(rel); } catch { continue; }
      const { meta } = parseFrontmatter(text);
      items.push({
        id: parsed.id,
        source: SOURCE_NAME,
        kind: parsed.kind,
        feature: meta.feature ?? null,
        status: meta.status ?? null,
        path: rel,
        meta,
      });
    }
    items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return items;
  }

  function read(id) {
    const kind = kindOfId(id);
    if (!kind) return null;
    const rel = `${INBOX_REL}/${id}.md`;
    if (!docs.exists(rel)) return null;
    let text;
    try { text = docs.read(rel); } catch { return null; }
    const { meta, body } = parseFrontmatter(text);
    return {
      id,
      source: SOURCE_NAME,
      kind,
      feature: meta.feature ?? null,
      status: meta.status ?? null,
      path: rel,
      meta,
      body,
    };
  }

  function submit({ feature, markdown, kind = 'handoff', meta = {} }) {
    const safe = String(feature).replace(/[^\w.-]/g, '_');
    const suffix = kind === 'request' ? 'request' : 'handoff';
    // The handoff defaults below reproduce bus.submitHandoff's pre-existing hardcoded frontmatter
    // exactly (key order matters for byte-identical output) when called with no `meta` override;
    // `...meta` can still extend/override on top without disturbing that order (JS object spread
    // updates an already-present key's VALUE in place, it does not move it).
    const frontmatter = suffix === 'handoff'
      ? { feature, from: 'antigravity', to: 'claude-code', status: 'ready-for-impl', ...meta }
      : { feature, ...meta };
    const rel = `${INBOX_REL}/${safe}.${suffix}.md`;
    docs.write(rel, buildFileBody(frontmatter, markdown));
    return rel;
  }

  return { name: SOURCE_NAME, list, read, submit };
}
