/**
 * dashboard/spec-file — read/write a feature spec markdown file from the "next in queue" panel,
 * so the founder can review and tweak a card's spec without leaving the dashboard. Restricted to
 * files under .ai/features/ ending in .md — the same surgical-write posture as policy-write.mjs,
 * so a Save can never reshape or touch anything outside that tree.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, sep, dirname } from 'node:path';

/** `config` is the injected AiosConfig (REQUIRED). */
function resolveSpecPath(relPath, config) {
  if (!relPath || typeof relPath !== 'string') throw new Error('path required');
  const specRoot = resolve(config.featuresDir) + sep;
  const resolved = resolve(config.repoRoot, relPath);
  if (!resolved.startsWith(specRoot) || !resolved.endsWith('.md')) throw new Error(`path not allowed: ${relPath}`);
  return resolved;
}

export function readSpec(relPath, config) {
  const abs = resolveSpecPath(relPath, config);
  if (!existsSync(abs)) return '';
  return readFileSync(abs, 'utf8');
}

export function writeSpec(relPath, content, config) {
  if (typeof content !== 'string') throw new Error('content must be a string');
  const abs = resolveSpecPath(relPath, config);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return { ok: true, path: relPath };
}
