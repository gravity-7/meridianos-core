/**
 * yaml-lite — a tiny, dependency-free reader for the SUBSET of YAML that .ai/policy.yaml uses:
 *   - nested block mappings (indentation-based)
 *   - scalars: int, float, bool, null, quoted or bare strings
 *   - inline flow arrays: [a, b, c]
 *   - '#' comments (whole-line and trailing)
 * It deliberately does NOT support block sequences ('- item'), anchors, or multi-line scalars;
 * policy.yaml stays inside this subset (guarded by a round-trip test). Zero-dependency so the
 * whole AIOS toolchain keeps needing nothing but Node.
 */

export function parseScalar(s) {
  s = s.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner === '' ? [] : splitTopLevel(inner).map(parseScalar);
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/[.eE]/.test(s) && /^-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
  return s;
}

function splitTopLevel(s) {
  const out = []; let depth = 0, quote = '', cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

export function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function colonIndex(line) {
  let quote = '', depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, container: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const noComment = stripComment(rawLine);
    if (noComment.trim() === '') continue;
    const indent = noComment.length - noComment.trimStart().length;
    const line = noComment.trim();
    const colon = colonIndex(line);
    if (colon < 0) continue; // not a key: value line — skip (subset only supports mappings)
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].container;

    if (rest === '') {
      const container = {};
      parent[key] = container;
      stack.push({ indent, container });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return root;
}
