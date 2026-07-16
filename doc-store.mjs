/**
 * doc-store — a small filesystem facade for reading/writing repo-relative "document" files
 * (ADR 0001 D2: DocStore). Every `rel` path is resolved against the injected `config.repoRoot`
 * and validated to stay INSIDE that root before any I/O happens — a `rel` that would escape the
 * root (e.g. a `..` traversal) throws instead of touching the filesystem outside the repo.
 *
 * This wraps `node:fs` 1:1 (mkdir parents + writeFileSync/readFileSync/existsSync/readdirSync,
 * all utf8) — no new persistence mechanism, just a safe, repo-root-scoped API over the files
 * core already reads/writes directly (e.g. bus.mjs's handoff write).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

/** Resolve `rel` against `repoRoot`, throwing if the result escapes the root. */
function resolveInRoot(repoRoot, rel) {
  const root = resolve(repoRoot);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`doc-store: path escapes repo root: ${rel}`);
  }
  return abs;
}

/** Build a DocStore scoped to `config.repoRoot`. */
export function createDocStore(config) {
  const repoRoot = config.repoRoot;
  return {
    /** utf8 string; throws if `rel` is missing (callers guard with `exists`) or escapes root. */
    read(rel) {
      return readFileSync(resolveInRoot(repoRoot, rel), 'utf8');
    },
    /** mkdir parents recursive, writeFileSync utf8. Returns the repo-relative path written. */
    write(rel, body) {
      const abs = resolveInRoot(repoRoot, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
      return rel;
    },
    /** boolean — never throws (existsSync doesn't), but a root-escape still throws. */
    exists(rel) {
      return existsSync(resolveInRoot(repoRoot, rel));
    },
    /** Array of entry names under `relDir`; `[]` if the dir is absent (never throws). */
    list(relDir) {
      const abs = resolveInRoot(repoRoot, relDir);
      if (!existsSync(abs)) return [];
      return readdirSync(abs);
    },
  };
}
