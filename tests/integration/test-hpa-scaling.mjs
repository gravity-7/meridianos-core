/**
 * Integration test for HPA scaling (US6 T140)
 *
 * Actually generating load against a live gateway Deployment and watching
 * `kubectl get hpa` react is a cluster/load-generator exercise this repo's test runner cannot
 * perform in CI (no cluster provisioned here). What's checked instead, strictly: the rendered
 * HorizontalPodAutoscaler manifests carry the exact minReplicas/maxReplicas/target values from
 * values.yaml, the scaleTargetRef points at the matching Deployment name, and — the part that
 * actually determines whether HPA can control replica count at all — the owning Deployment omits
 * a hardcoded `replicas:` field whenever its autoscaling is enabled (a hardcoded `replicas:` on
 * every `helm upgrade` would fight the HPA and thrash pods).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHART_DIR = path.join(__dirname, '..', '..', 'deploy', 'kubernetes', 'helm', 'meridianos');

const helmAvailable = spawnSync('helm', ['version'], { encoding: 'utf8' }).status === 0;
const TEST_JWT_SECRET = 'b'.repeat(128);

function helmTemplate(extraArgs = []) {
  const result = spawnSync(
    'helm',
    ['template', 'test-release', CHART_DIR, '--set', `secrets.jwtSecret=${TEST_JWT_SECRET}`, ...extraArgs],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('HPA scaling (deploy/kubernetes/helm/meridianos)', { skip: !helmAvailable }, () => {
  it('gateway HPA renders with values.yaml defaults (min 2, max 10, 70% CPU) when autoscaling.enabled', () => {
    const out = helmTemplate();
    const hpaSection = out.split('# Source: meridianos/templates/hpa-gateway.yaml')[1];
    assert.ok(hpaSection, 'hpa-gateway.yaml did not render');
    assert.match(hpaSection, /minReplicas: 2/);
    assert.match(hpaSection, /maxReplicas: 10/);
    assert.match(hpaSection, /averageUtilization: 70/);
    assert.match(hpaSection, /name: test-release-meridianos-gateway/);
  });

  it('custom min/max/target values flow through to the rendered HPA', () => {
    const out = helmTemplate([
      '--set', 'gateway.autoscaling.minReplicas=3',
      '--set', 'gateway.autoscaling.maxReplicas=8',
      '--set', 'gateway.autoscaling.targetCPUUtilizationPercentage=55',
    ]);
    const hpaSection = out.split('# Source: meridianos/templates/hpa-gateway.yaml')[1];
    assert.match(hpaSection, /minReplicas: 3/);
    assert.match(hpaSection, /maxReplicas: 8/);
    assert.match(hpaSection, /averageUtilization: 55/);
  });

  it('gateway Deployment omits a hardcoded replicas field while autoscaling is enabled (default)', () => {
    const out = helmTemplate();
    const deploySection = out.split('# Source: meridianos/templates/gateway-deployment.yaml')[1].split('---')[0];
    assert.doesNotMatch(deploySection, /^\s*replicas:/m);
  });

  it('gateway Deployment DOES set replicas from replicaCount when autoscaling is disabled', () => {
    const out = helmTemplate(['--set', 'gateway.autoscaling.enabled=false', '--set', 'gateway.replicaCount=4']);
    const deploySection = out.split('# Source: meridianos/templates/gateway-deployment.yaml')[1].split('---')[0];
    assert.match(deploySection, /^\s*replicas: 4/m);
    // No HPA should render either, so nothing is fighting the fixed replica count.
    assert.doesNotMatch(out, /kind: HorizontalPodAutoscaler\nmetadata:\n {2}name: test-release-meridianos-gateway\n/);
  });

  it('dashboard HPA only renders when both dashboard.enabled and dashboard.autoscaling.enabled are true', () => {
    const disabled = helmTemplate();
    assert.doesNotMatch(disabled, /Source: meridianos\/templates\/hpa-dashboard\.yaml/);

    const dashboardOnlyEnabled = helmTemplate(['--set', 'dashboard.enabled=true']);
    // dashboard.autoscaling.enabled defaults to false, so still no HPA.
    assert.doesNotMatch(dashboardOnlyEnabled, /Source: meridianos\/templates\/hpa-dashboard\.yaml/);

    const bothEnabled = helmTemplate(['--set', 'dashboard.enabled=true', '--set', 'dashboard.autoscaling.enabled=true']);
    assert.match(bothEnabled, /Source: meridianos\/templates\/hpa-dashboard\.yaml/);
  });
});
