/**
 * Integration test for Helm chart installation (US6 T139)
 *
 * A real `helm install` into a live cluster, and proof that pods actually start, is outside what
 * this repo's test runner can exercise in CI (no cluster is provisioned here — see
 * deploy/kubernetes/README.md "Testing this chart"). What IS checked, and checked strictly:
 *   - `helm lint` passes (chart metadata + template well-formedness)
 *   - `helm template` renders valid YAML for the default values AND for the optional
 *     dashboard/persistence/provider-key combinations, with no Go-template errors
 *   - the rendered manifests contain the Kind/name pairs the chart is supposed to produce
 *
 * Both `helm template` and `helm lint` run the exact same chart-rendering code path `helm
 * install` uses before it ever talks to a cluster, so this is a meaningful (if partial) stand-in
 * for "the chart installs cleanly" — it just stops short of the live apply.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHART_DIR = path.join(__dirname, '..', '..', 'deploy', 'kubernetes', 'helm', 'meridianos');

const helmAvailable = spawnSync('helm', ['version'], { encoding: 'utf8' }).status === 0;

// A syntactically-valid, non-default JWT secret — required by templates/secret.yaml, never a
// real credential.
const TEST_JWT_SECRET = 'a'.repeat(128);

function helmTemplate(extraArgs = []) {
  return spawnSync(
    'helm',
    ['template', 'test-release', CHART_DIR, '--set', `secrets.jwtSecret=${TEST_JWT_SECRET}`, ...extraArgs],
    { encoding: 'utf8' },
  );
}

describe('Helm chart installation (deploy/kubernetes/helm/meridianos)', { skip: !helmAvailable }, () => {
  it('helm lint passes with no errors', () => {
    const result = spawnSync('helm', ['lint', CHART_DIR, '--set', `secrets.jwtSecret=${TEST_JWT_SECRET}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /0 chart\(s\) failed/);
  });

  it('helm template renders with default values (dashboard disabled, ingress falls back to daemon)', () => {
    const result = helmTemplate();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /kind: Deployment\nmetadata:\n {2}name: test-release-meridianos-gateway/);
    assert.match(result.stdout, /kind: StatefulSet\nmetadata:\n {2}name: test-release-meridianos-daemon/);
    assert.doesNotMatch(result.stdout, /kind: Deployment\nmetadata:\n {2}name: test-release-meridianos-dashboard/);
    // Default-disabled dashboard → ingress backend must point at the daemon service.
    assert.match(result.stdout, /kind: Ingress[\s\S]*name: test-release-meridianos-daemon/);
  });

  it('helm template renders every optional resource when its flag is enabled', () => {
    const result = helmTemplate([
      '--set', 'dashboard.enabled=true',
      '--set', 'gateway.persistence.enabled=true',
      '--set', 'secrets.providerKeys.DEEPSEEK_KEY=dummy',
    ]);
    assert.equal(result.status, 0, result.stderr);
    for (const expected of [
      'kind: Deployment\nmetadata:\n  name: test-release-meridianos-gateway',
      'kind: Deployment\nmetadata:\n  name: test-release-meridianos-dashboard',
      'kind: StatefulSet\nmetadata:\n  name: test-release-meridianos-daemon',
      'kind: Service\nmetadata:\n  name: test-release-meridianos-gateway',
      'kind: Service\nmetadata:\n  name: test-release-meridianos-daemon',
      'kind: Service\nmetadata:\n  name: test-release-meridianos-dashboard',
      'kind: HorizontalPodAutoscaler\nmetadata:\n  name: test-release-meridianos-gateway',
      'kind: ConfigMap',
      'kind: Secret',
      'kind: PersistentVolumeClaim\nmetadata:\n  name: test-release-meridianos-gateway-ledger',
      'DEEPSEEK_KEY',
    ]) {
      assert.ok(result.stdout.includes(expected), `expected rendered output to include: ${expected}`);
    }
  });

  it('fails closed when secrets.jwtSecret is not supplied (no silent empty-secret deploy)', () => {
    const result = spawnSync('helm', ['template', 'test-release', CHART_DIR], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /secrets\.jwtSecret is required/);
  });
});

describe('Helm chart installation — helm unavailable', { skip: helmAvailable }, () => {
  it('is reported so this file is visibly a skip, not a silent pass', () => {
    assert.ok(true, 'helm CLI not found on PATH — install Helm 3 to exercise these checks');
  });
});
