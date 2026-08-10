import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createDashboardServer } from '../dashboard/server.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from '../tests/_fixture-domain.mjs';

const request = (method, path, body) => new Promise((resolve, reject) => { const data = body && JSON.stringify(body); const req = http.request({ host: '127.0.0.1', port: 4444, path, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => { let out = ''; res.on('data', (chunk) => out += chunk); res.on('end', () => { try { resolve(JSON.parse(out)); } catch { reject(new Error(out)); } }); }); req.on('error', reject); req.end(data); });
const wait = async (path) => { for (let i = 0; i < 50; i++) { try { return await request('GET', path); } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error(`Safari WebDriver unavailable: ${path}`); };
const root = mkdtempSync(join(tmpdir(), 'ui-platform-safari-')); mkdirSync(join(root, '.ai'), { recursive: true }); writeFileSync(join(root, '.ai', 'policy.yaml'), 'ui_platform:\n  enabled: true\n');
const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
await new Promise((resolve) => server.listen(4319, '127.0.0.1', resolve));
const driver = spawn('safaridriver', ['-p', '4444']);
try {
  await wait('/status'); const session = await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }); const id = session.value.sessionId;
  await request('POST', `/session/${id}/url`, { url: 'http://127.0.0.1:4319/app/foundation' });
  let text = '';
  for (let i = 0; i < 50; i++) {
    text = (await request('POST', `/session/${id}/execute/sync`, { script: 'return document.body.innerText', args: [] })).value;
    if (text.includes('Platform foundation')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!text.includes('Platform foundation')) throw new Error('Safari did not render the platform route before timeout');
  const screenshot = (await request('GET', `/session/${id}/screenshot`)).value; mkdirSync('artifacts/browser/safari', { recursive: true }); writeFileSync('artifacts/browser/safari/platform.png', Buffer.from(screenshot, 'base64'));
  await request('DELETE', `/session/${id}`);
} finally { driver.kill(); await new Promise((resolve) => server.close(resolve)); }
