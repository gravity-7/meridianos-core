import { createDashboardServer } from '../dashboard/server.mjs';
import { createAios } from '../config.mjs';
import { validateSetupProviderConnection } from '../provider-conformance.mjs';
import { assertLoopbackEndpoint } from '../tests/fixtures/persona-network-guard.mjs';
import { FIXTURE_DOMAIN } from '../tests/_fixture-domain.mjs';

const root = process.env.AIOS_ROOT;
const providerUrl = process.env.MERIDIAN_ONBOARDING_PROVIDER_URL;
const requestedPort = Number(process.argv[2] ?? process.env.AIOS_DASHBOARD_PORT ?? 0);
const validationTimeoutMs = Number(process.env.MERIDIAN_ONBOARDING_VALIDATION_TIMEOUT_MS ?? 150);
const runId = process.env.MERIDIAN_ONBOARDING_RUN_ID ?? 'onboarding-child';

if (!root || !providerUrl || !Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  process.exit(2);
}

const allowProviderUrl = (value) => {
  const endpoint = assertLoopbackEndpoint(value, { allowedOrigins: [providerUrl] });
  return endpoint.pathname === '/models' && endpoint.search === '';
};
const baseConfig = createAios({ root, domain: FIXTURE_DOMAIN }).config;
const config = {
  ...baseConfig,
  setupFixture: { synthetic: true, runId, revision: 'fresh-solo-r2', dependencyMode: 'loopback-simulated' },
  setupProviderValidator: ({ provider, secret }) => validateSetupProviderConnection(
    { ...provider, baseUrl: providerUrl },
    secret,
    { fetchImpl: fetch, allowUrl: allowProviderUrl, timeoutMs: validationTimeoutMs },
  ),
};
const server = createDashboardServer(config);

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

async function start() {
  let fallback = false;
  let port;
  try {
    port = await listen(requestedPort);
  } catch (error) {
    if (requestedPort === 0 || error?.code !== 'EADDRINUSE') throw error;
    fallback = true;
    port = await listen(0);
  }
  const ready = { type: 'ready', port, fallback };
  process.send?.(ready);
  process.stdout.write(`MERIDIAN_ONBOARDING_READY ${port} ${fallback ? 'fallback' : 'requested'}\n`);
}

async function stop() {
  if (!server.listening) return process.exit(0);
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
start().catch(() => process.exit(1));
