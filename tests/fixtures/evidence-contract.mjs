import { listSetupProviders } from '../../provider-wizard.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
}

function validDate(value, label) {
  requiredString(value, label);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new TypeError(`${label} must be an ISO timestamp`);
  return timestamp;
}

const ONBOARDING_RESULTS = new Set(['passed', 'failed', 'abandoned']);

/** Validate the redacted result shape emitted by the visible onboarding fixture. */
export function validateOnboardingResult(result) {
  requiredString(result?.journey_id, 'onboarding.journey_id');
  requiredString(result?.fixture_revision, 'onboarding.fixture_revision');
  requiredString(result?.run_id, 'onboarding.run_id');
  if (!ONBOARDING_RESULTS.has(result?.result)) throw new TypeError('onboarding.result is invalid');
  if (!Array.isArray(result?.checkpoints)) throw new TypeError('onboarding.checkpoints must be an array');
  for (const [index, checkpoint] of result.checkpoints.entries()) {
    requiredString(checkpoint?.id, `onboarding.checkpoints[${index}].id`);
    if (!['passed', 'failed'].includes(checkpoint?.outcome)) throw new TypeError(`onboarding.checkpoints[${index}].outcome is invalid`);
  }
  if (result?.safety?.dependency_mode !== 'loopback-simulated') {
    throw new TypeError('onboarding evidence must use loopback-simulated dependencies');
  }
  if (result?.safety?.raw_trace_retained !== false) throw new TypeError('onboarding evidence must not retain raw traces');
  if (!['pending', 'removed', 'failed'].includes(result?.safety?.cleanup)) throw new TypeError('onboarding cleanup result is invalid');
  if (!Number.isInteger(result?.safety?.external_attempt_count) || result.safety.external_attempt_count !== 0) {
    throw new TypeError('onboarding evidence contains an external dependency attempt');
  }
  if (result?.safety?.sentinel_scan?.passed !== true) throw new TypeError('onboarding evidence sentinel scan failed');
  return result;
}

export function validateEvidenceManifest(manifest, { now = Date.now(), maxAgeDays = 14, expectedCommit = null } = {}) {
  for (const field of ['journey_id', 'fixture_revision', 'tested_commit', 'run_id', 'completed_at', 'reviewer', 'retention_until']) {
    requiredString(manifest?.[field], `evidence.${field}`);
  }
  if (!/^JRN-\d{3}$/.test(manifest.journey_id)) throw new TypeError('evidence.journey_id must use JRN-NNN form');
  const completedAt = validDate(manifest.completed_at, 'evidence.completed_at');
  const retentionUntil = validDate(manifest.retention_until, 'evidence.retention_until');
  if (completedAt > now) throw new TypeError('evidence completion cannot be in the future');
  if (retentionUntil <= completedAt) throw new TypeError('evidence.retention_until must be after completion');
  if (retentionUntil <= now) throw new TypeError('evidence retention has expired');
  if (now - completedAt > maxAgeDays * 86_400_000) throw new TypeError('evidence is older than the freshness window');
  if (expectedCommit && manifest.tested_commit !== expectedCommit) throw new TypeError('evidence commit does not match the release commit');
  return manifest;
}

export function validateLiveCanaryApproval(approval, evidenceManifest, { now = Date.now() } = {}) {
  for (const field of [
    'journey_id', 'run_id', 'approver', 'key_owner', 'provider', 'model', 'scope',
    'max_spend_usd', 'max_duration_minutes', 'approved_at', 'expires_at', 'rollback',
    'stop_condition', 'evidence_classification', 'key_revocation',
  ]) {
    requiredString(approval?.[field], `approval.${field}`);
  }
  if (approval.journey_id !== evidenceManifest?.journey_id) throw new TypeError('approval journey must match evidence journey');
  if (approval.run_id !== evidenceManifest?.run_id) throw new TypeError('approval run must match evidence run');
  const registeredProvider = listSetupProviders().find((provider) => provider.id === approval.provider);
  if (approval.provider !== 'deepseek' || !registeredProvider?.models.includes(approval.model)) {
    throw new TypeError('approval provider/model is not registered for the DeepSeek-only canary');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(approval.max_spend_usd) || Number(approval.max_spend_usd) < 0) {
    throw new TypeError('approval.max_spend_usd must be a non-negative decimal string');
  }
  if (!/^\d+$/.test(approval.max_duration_minutes) || Number(approval.max_duration_minutes) <= 0) {
    throw new TypeError('approval.max_duration_minutes must be a positive integer');
  }
  if (approval.evidence_classification !== 'LIVE-CANARY-RESTRICTED') {
    throw new TypeError('approval.evidence_classification must be LIVE-CANARY-RESTRICTED');
  }
  const approvedAt = validDate(approval.approved_at, 'approval.approved_at');
  if (approvedAt > now) throw new TypeError('approval cannot be in the future');
  if (approvedAt > validDate(evidenceManifest?.completed_at, 'evidence.completed_at')) {
    throw new TypeError('approval must predate the evidence execution');
  }
  const expiresAt = validDate(approval.expires_at, 'approval.expires_at');
  if (expiresAt <= approvedAt) throw new TypeError('approval expiry must follow approval time');
  if (expiresAt <= now) throw new TypeError('approval has expired');
  return approval;
}

/** Return true only for a complete, current approval paired with passed synthetic evidence. */
export function isLiveCanaryReady(approval, evidenceManifest, { now = Date.now() } = {}) {
  try {
    validateLiveCanaryApproval(approval, evidenceManifest, { now });
    return evidenceManifest?.result === 'passed'
      && evidenceManifest?.dependency_mode === 'loopback-simulated';
  } catch {
    return false;
  }
}
