/** Stable, dependency-free boundary between the platform shell and legacy dashboard/API routes. */
export const PLATFORM_ROUTES = Object.freeze({
  '/app': { id: 'overview', label: 'Overview', title: 'Application overview', text: 'The stable MeridianOS application foundation is ready.' },
  '/app/foundation': { id: 'foundation', label: 'Foundation', title: 'Platform foundation', text: 'Shared tokens, accessible primitives, typed boundaries, and action-state conventions belong here.' },
});

export function isUiPlatformEnabled(policy) {
  return policy?.ui_platform?.enabled === true;
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
