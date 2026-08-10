/**
 * Integration test for persistent volume reattachment (US6 T141)
 *
 * Actually killing a pod and watching it reattach its PV with data intact needs a live cluster
 * with a real StorageClass — outside what this repo's test runner can exercise in CI (no cluster
 * provisioned here). What's checked instead, strictly: the daemon StatefulSet declares a
 * volumeClaimTemplate (the mechanism that gives a restarted/rescheduled pod back the SAME PVC,
 * as opposed to a fresh one) with the configured size/accessModes, the JWT secret and
 * .ai/auth + .ai/gateway bootstrap directories are wired into that same persistent mount (not
 * silently lost on restart), and that persistence can be fully disabled without breaking the
 * render (ephemeral/dev mode).
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
const TEST_JWT_SECRET = 'c'.repeat(128);

function helmTemplate(extraArgs = []) {
  const result = spawnSync(
    'helm',
    ['template', 'test-release', CHART_DIR, '--set', `secrets.jwtSecret=${TEST_JWT_SECRET}`, ...extraArgs],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replace(/\r\n/g, '\n');
}

describe('Persistent volume reattachment (deploy/kubernetes/helm/meridianos)', { skip: !helmAvailable }, () => {
  it('daemon StatefulSet declares a volumeClaimTemplate sized from values.yaml (default 5Gi, ReadWriteOnce)', () => {
    const out = helmTemplate();
    const section = out.split('# Source: meridianos/templates/daemon-statefulset.yaml')[1];
    assert.match(section, /volumeClaimTemplates:/);
    assert.match(section, /storage: 5Gi/);
    assert.match(section, /- ReadWriteOnce/);
    // A StatefulSet (not Deployment) is what gives a rescheduled pod its PVC back by identity.
    assert.match(out, /kind: StatefulSet\nmetadata:\n {2}name: test-release-meridianos-daemon/);
  });

  it('volumeClaimTemplate size/accessModes follow daemon.persistence overrides', () => {
    const out = helmTemplate([
      '--set', 'daemon.persistence.size=20Gi',
      '--set', 'daemon.persistence.storageClassName=fast-ssd',
    ]);
    const section = out.split('# Source: meridianos/templates/daemon-statefulset.yaml')[1];
    assert.match(section, /storage: 20Gi/);
    assert.match(section, /storageClassName: fast-ssd/);
  });

  it('the JWT secret and .ai bootstrap dirs are mounted under the SAME persistent path the daemon reads on restart', () => {
    const out = helmTemplate();
    const section = out.split('# Source: meridianos/templates/daemon-statefulset.yaml')[1];
    // control-plane.mjs / auth/jwt.mjs hardcode paths relative to /app/.ai — the state PVC must
    // land exactly there, or a rescheduled pod would silently start with empty auth/project state.
    assert.match(section, /name: state\s*\n\s*mountPath: \/app\/\.ai\b/);
    assert.match(section, /name: jwt-secret\s*\n\s*mountPath: \/app\/\.ai\/auth\/jwt-secret/);
    assert.match(section, /mkdir -p \/app\/\.ai\/auth \/app\/\.ai\/gateway/);
  });

  it('daemon.persistence.enabled=false renders without a volumeClaimTemplate or state mount (ephemeral/dev mode)', () => {
    const out = helmTemplate(['--set', 'daemon.persistence.enabled=false']);
    const section = out.split('# Source: meridianos/templates/daemon-statefulset.yaml')[1];
    assert.doesNotMatch(section, /volumeClaimTemplates:/);
    assert.doesNotMatch(section, /mountPath: \/app\/\.ai\b/);
  });

  it('gateway ledger PVC only renders when gateway.persistence.enabled is true (default false — see values.yaml single-writer caveat)', () => {
    const withoutPersistence = helmTemplate();
    assert.doesNotMatch(withoutPersistence, /name: test-release-meridianos-gateway-ledger/);

    const withPersistence = helmTemplate(['--set', 'gateway.persistence.enabled=true', '--set', 'gateway.persistence.size=2Gi']);
    const pvcSection = withPersistence.split('# Source: meridianos/templates/pvc.yaml')[1];
    assert.match(pvcSection, /name: test-release-meridianos-gateway-ledger/);
    assert.match(pvcSection, /storage: 2Gi/);
  });
});
