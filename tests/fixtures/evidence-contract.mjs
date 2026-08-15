function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
}

function validDate(value, label) {
  requiredString(value, label);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new TypeError(`${label} must be an ISO timestamp`);
  return timestamp;
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
  for (const field of ['journey_id', 'run_id', 'approver', 'scope', 'max_spend_usd', 'approved_at', 'expires_at', 'rollback', 'stop_condition']) {
    requiredString(approval?.[field], `approval.${field}`);
  }
  if (approval.journey_id !== evidenceManifest?.journey_id) throw new TypeError('approval journey must match evidence journey');
  if (approval.run_id !== evidenceManifest?.run_id) throw new TypeError('approval run must match evidence run');
  if (!/^\d+(\.\d{1,2})?$/.test(approval.max_spend_usd) || Number(approval.max_spend_usd) < 0) {
    throw new TypeError('approval.max_spend_usd must be a non-negative decimal string');
  }
  const approvedAt = validDate(approval.approved_at, 'approval.approved_at');
  if (approvedAt > now) throw new TypeError('approval cannot be in the future');
  if (approvedAt > validDate(evidenceManifest?.completed_at, 'evidence.completed_at')) {
    throw new TypeError('approval must predate the evidence execution');
  }
  if (validDate(approval.expires_at, 'approval.expires_at') <= now) throw new TypeError('approval has expired');
  return approval;
}
