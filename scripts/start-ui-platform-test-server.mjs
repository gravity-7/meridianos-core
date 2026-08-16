import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardServer } from '../dashboard/server.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from '../tests/_fixture-domain.mjs';

const root = mkdtempSync(join(tmpdir(), 'ui-platform-playwright-'));
mkdirSync(join(root, '.ai'), { recursive: true });
writeFileSync(join(root, '.ai', 'policy.yaml'), 'ui_platform:\n  enabled: true\n');
const dashboardServer = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
const cloudFiles = new Map([
  ['/cloud/dashboard/index.html', ['cloud/dashboard/index.html', 'text/html; charset=utf-8']],
  ['/cloud/dashboard/app.js', ['cloud/dashboard/app.js', 'text/javascript; charset=utf-8']],
]);
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = cloudFiles.get(pathname);
  if (file) {
    res.writeHead(200, { 'content-type': file[1] });
    res.end(readFileSync(file[0]));
    return;
  }
  dashboardServer.emit('request', req, res);
});
server.listen(4319, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
