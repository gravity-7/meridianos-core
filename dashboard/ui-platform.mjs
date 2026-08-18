/** Stable, dependency-free boundary between the platform shell and legacy dashboard/API routes. */
export const PLATFORM_ROUTES = Object.freeze({
  '/app': { id: 'overview', label: 'Overview', title: 'Application overview', text: 'The stable MeridianOS application foundation is ready.' },
  '/app/foundation': { id: 'foundation', label: 'Foundation', title: 'Platform foundation', text: 'Shared tokens, accessible primitives, typed boundaries, and action-state conventions belong here.' },
  '/app/setup': { id: 'setup', label: 'Setup', title: 'Set up MeridianOS', text: 'Connect a provider, set a budget, and start your first run.' },
  '/app/setup/complete': { id: 'setup-complete', label: 'Setup complete', title: 'Your setup is complete', text: 'Continue with your first task and run.' },
});

/** Preserved legacy targets used by onboarding until Operations is migrated. */
export const ONBOARDING_COMPATIBILITY_TARGETS = Object.freeze({
  firstTaskTarget: '/?workspace=admin',
  firstRunTarget: null,
});

export const DEFAULT_UI_PLATFORM_POLICY = Object.freeze({
  // Founder-approved early-stage default: serve the platform shell unless an installation
  // explicitly opts out. The retained /legacy route is the immediate rollback boundary.
  enabled: true,
  eligibility: Object.freeze({ mode: 'all' }),
});

/**
 * Resolve the policy-owned release decision without relying on browser state. The returned
 * record is safe to log as audit evidence: it contains only policy choices, never credentials.
 */
export function evaluateUiPlatformEligibility(policy, { subjectId = null } = {}) {
  const configured = policy?.ui_platform ?? {};
  const enabled = Object.hasOwn(configured, 'enabled')
    ? configured.enabled === true
    : DEFAULT_UI_PLATFORM_POLICY.enabled;
  const eligibility = configured.eligibility ?? DEFAULT_UI_PLATFORM_POLICY.eligibility;
  const audit = {
    policyPath: 'ui_platform',
    rolloutId: typeof configured.rollout_id === 'string' ? configured.rollout_id : null,
    subjectId: typeof subjectId === 'string' ? subjectId : null,
  };
  if (!enabled) return { enabled: false, eligible: false, decision: 'legacy', reason: 'disabled', audit };
  if (eligibility.mode === 'allowlist') {
    const eligible = typeof subjectId === 'string' && Array.isArray(eligibility.subjects) && eligibility.subjects.includes(subjectId);
    return { enabled: true, eligible, decision: eligible ? 'platform' : 'legacy', reason: eligible ? 'allowlisted' : 'not_allowlisted', audit };
  }
  return { enabled: true, eligible: true, decision: 'platform', reason: 'all_users', audit };
}

export function isUiPlatformEnabled(policy, context) {
  return evaluateUiPlatformEligibility(policy, context).eligible;
}

export function resolvePlatformRoute(pathname) {
  return PLATFORM_ROUTES[pathname] ?? null;
}

/** @typedef {{ state: 'loading'|'content'|'empty'|'error', data?: unknown, message?: string, recoverable?: boolean }} PlatformBoundary */
export function platformBoundary({ status = 200, body, error } = {}) {
  if (error || status >= 400) return { state: 'error', message: 'Unable to load this information. Try again.', recoverable: true };
  if (body == null || (Array.isArray(body) && body.length === 0)) return { state: 'empty', message: 'There is nothing to show yet.' };
  return { state: 'content', data: body };
}
