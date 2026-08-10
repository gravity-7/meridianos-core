import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardServer } from '../dashboard/server.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from '../tests/_fixture-domain.mjs';

const root = mkdtempSync(join(tmpdir(), 'ui-platform-playwright-'));
mkdirSync(join(root, '.ai'), { recursive: true });
writeFileSync(join(root, '.ai', 'policy.yaml'), 'ui_platform:\n  enabled: true\n');
const server = createDashboardServer(resolvePaths({ domain: FIXTURE_DOMAIN, root }));
server.listen(4319, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
