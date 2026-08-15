import { createHash } from 'node:crypto';
import { info as logInfo } from '../event-log.mjs';

export const UXF_EVENTS = Object.freeze(new Set([
  'onboarding_started', 'onboarding_step_completed', 'onboarding_completed', 'provider_test_failed',
  'workflow_abandoned', 'global_search_used', 'command_executed', 'dashboard_drilldown',
  'action_started', 'action_failed', 'error_recovery_started', 'error_recovery_succeeded',
  'alert_acknowledged', 'legacy_route_used',
]));
const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'fallback', 'unavailable', 'started', 'completed']);
const ROLES = new Set(['admin', 'operator', 'viewer', 'unknown']);
const FLAGS = /^[a-z0-9._-]{1,80}$/i;

function pseudonym(value) { return createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 24); }

export function createUxfEvent(input = {}, { now = () => new Date().toISOString() } = {}) {
  try {
    if (!UXF_EVENTS.has(input.event) || typeof input.route !== 'string' || !input.route.startsWith('/')) return null;
    const route = input.route.split(/[?#]/, 1)[0].slice(0, 240);
    const role = ROLES.has(input.role) ? input.role : 'unknown';
    const featureFlag = input.featureFlag == null || input.featureFlag === '' ? 'none' : String(input.featureFlag);
    const outcome = OUTCOMES.has(input.outcome) ? input.outcome : null;
    if (!FLAGS.test(featureFlag) || !outcome) return null;
    const durationMs = input.durationMs == null ? null : Number(input.durationMs);
    if (durationMs != null && (!Number.isFinite(durationMs) || durationMs < 0)) return null;
    return Object.freeze({
      event: input.event, route, scope: pseudonym(input.scopeKey), role, featureFlag,
      durationMs: durationMs == null ? null : Math.min(Math.round(durationMs), 60 * 60 * 1000), outcome, timestamp: now(),
    });
  } catch { return null; }
}

export function recordUxfEvent(target, input = {}, options = {}) {
  try {
    if (options.enabled !== true) return false;
    const event = createUxfEvent(input, options);
    if (!event) return false;
    if (typeof target === 'function') target(event);
    else if (options.db) logInfo(options.db, 'uxf', event.event, event);
    else return false;
    return true;
  } catch { return false; }
}
