import fs from 'fs';
let mjs = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');

const postLegacyFunc = `
async function postLegacy(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aios-token': window.AIOS_TOKEN, 'x-correlation-id': crypto.randomUUID() }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({})); if (!response.ok || value.ok === false) throw new Error(value.error?.message || value.error || 'The action failed.'); return value;
}
`;

mjs = mjs.replace('function refreshButton', postLegacyFunc + 'function refreshButton');
fs.writeFileSync('dashboard/static/app-platform.mjs', mjs);
