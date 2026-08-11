/** Durable append-only, secret-safe management evidence. */
import { randomUUID } from 'node:crypto';

const SECRET_KEYS = /secret|token|password|credential|authorization|cookie|session|api[_-]?key/i;
export function redactManagementValue(value, key = '') {
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((v) => redactManagementValue(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactManagementValue(v, k)]));
  return typeof value === 'string' && value.length > 512 ? `${value.slice(0, 512)}…` : value;
}

export function ensureManagementAudit(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS management_audit_events (
    id TEXT PRIMARY KEY, actor_id TEXT, actor_role TEXT, authorization_json TEXT NOT NULL,
    tenant_id TEXT NOT NULL, project_id TEXT, target_type TEXT, target_id TEXT,
    intent TEXT, reason TEXT, outcome TEXT NOT NULL, correlation_id TEXT NOT NULL,
    disclosure_classification TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL,
    retention_until TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_management_audit_scope ON management_audit_events(tenant_id, project_id, created_at DESC);`);
}

export function appendManagementAudit(db, { decision, intent, reason = null, outcome, disclosureClassification = 'restricted', evidence = {}, now = new Date() }) {
  ensureManagementAudit(db);
  const event = { id: randomUUID(), actor: decision.actor, authorization: { allowed: decision.allowed, reasonCode: decision.reasonCode, capability: decision.capability, role: decision.actor.role, policyVersion: decision.policyVersion }, scope: decision.scope, target: decision.allowed ? decision.target : null, intent: String(intent || '').slice(0, 160), reason: reason ? String(reason).slice(0, 512) : null, outcome, correlationId: decision.correlationId, disclosureClassification, evidence: redactManagementValue(evidence), timestamp: now.toISOString(), retentionUntil: new Date(now.getTime() + 365 * 86400000).toISOString() };
  db.prepare(`INSERT INTO management_audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, event.actor.id, event.actor.role, JSON.stringify(event.authorization), event.scope.tenantId, event.scope.projectId, event.target?.type ?? null, event.target?.id ?? null, event.intent, event.reason, event.outcome, event.correlationId, event.disclosureClassification, JSON.stringify(event.evidence), event.timestamp, event.retentionUntil);
  return event;
}

export function listManagementAudit(db, scope, { limit = 50, cursor = null } = {}) {
  ensureManagementAudit(db); const take = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = db.prepare(`SELECT * FROM management_audit_events WHERE tenant_id = ? AND (? IS NULL OR project_id = ?) AND (? IS NULL OR created_at < ?) ORDER BY created_at DESC LIMIT ?`).all(scope.tenantId, scope.projectId, scope.projectId, cursor, cursor, take + 1);
  const page = rows.slice(0, take).map((r) => ({ id: r.id, actor: { id: r.actor_id, role: r.actor_role }, authorization: JSON.parse(r.authorization_json), scope: { tenantId: r.tenant_id, projectId: r.project_id }, target: r.target_type ? { type: r.target_type, id: r.target_id } : null, intent: r.intent, reason: r.reason, outcome: r.outcome, correlationId: r.correlation_id, disclosureClassification: r.disclosure_classification, evidence: JSON.parse(r.evidence_json), timestamp: r.created_at }));
  return { events: page, nextCursor: rows.length > take ? page.at(-1)?.timestamp : null };
}

export function pruneManagementAudit(db, now = new Date()) { ensureManagementAudit(db); return db.prepare('DELETE FROM management_audit_events WHERE retention_until < ?').run(now.toISOString()).changes; }
