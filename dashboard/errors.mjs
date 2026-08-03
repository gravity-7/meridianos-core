/**
 * dashboard/errors — Structured error catalog with actionable remediation steps.
 *
 * Every public-facing error the multi-tenant platform can raise is defined here as a
 * MeridianError with:
 *   - code:        machine-readable string (stable, semver-versioned)
 *   - httpStatus:  HTTP status code to use when sent over the wire
 *   - message:     short human-readable description
 *   - remediation: ordered list of actionable steps the caller can take
 *   - docs:        relative docs-site path (optional)
 *
 * Usage:
 *   import { Errors, sendError } from './errors.mjs';
 *   sendError(res, Errors.AUTH_MISSING_HEADER);
 *
 *   // or with context interpolation:
 *   sendError(res, Errors.PROJECT_NOT_FOUND, { id: projectId });
 */

// ─── Error class ────────────────────────────────────────────────────────────

export class MeridianError extends Error {
  /**
   * @param {string} code        - Machine-readable error code
   * @param {number} httpStatus  - HTTP status to return
   * @param {string} message     - Human-readable description
   * @param {string[]} remediation - Ordered actionable steps
   * @param {string} [docs]      - Relative path to relevant documentation
   */
  constructor(code, httpStatus, message, remediation = [], docs = null) {
    super(message);
    this.name = 'MeridianError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.remediation = remediation;
    this.docs = docs;
  }

  /** Serialise to the canonical JSON wire format. */
  toJSON(context = {}) {
    const msg = interpolate(this.message, context);
    const rem = this.remediation.map(r => interpolate(r, context));
    const out = {
      ok: false,
      error: msg,
      code: this.code,
      remediation: rem,
    };
    if (this.docs) out.docs = this.docs;
    return out;
  }
}

/** Replace `{key}` placeholders in a string from `context`. */
function interpolate(str, context) {
  return str.replace(/\{(\w+)\}/g, (_, k) => context[k] ?? `{${k}}`);
}

// ─── Error catalog ───────────────────────────────────────────────────────────

export const Errors = {

  // ── Authentication (AUTH_*) ────────────────────────────────────────────────

  AUTH_MISSING_HEADER: new MeridianError(
    'AUTH_MISSING_HEADER', 401,
    'Missing Authorization header.',
    [
      'Include the header: Authorization: Bearer <your-jwt-token>',
      'Obtain a token via POST /api/auth/login with your email and password.',
      'If your token has expired, refresh it via POST /api/auth/refresh.',
    ],
    '/docs/multi-tenant-api.md#authentication',
  ),

  AUTH_INVALID_FORMAT: new MeridianError(
    'AUTH_INVALID_FORMAT', 401,
    'Invalid Authorization header format. Expected: Bearer <token>',
    [
      'Ensure the header value starts with "Bearer " (with a space).',
      'Do not double-encode or quote the token value.',
      "Example: Authorization: Bearer eyJhbGciOi...",
    ],
    '/docs/multi-tenant-api.md#authentication',
  ),

  AUTH_TOKEN_EXPIRED: new MeridianError(
    'AUTH_TOKEN_EXPIRED', 401,
    'JWT token has expired.',
    [
      'Refresh the token via POST /api/auth/refresh.',
      'If the refresh also fails, log in again via POST /api/auth/login.',
      'The default token lifetime is 30 minutes. Consider adjusting policy.yaml → authentication.jwt.expirationMinutes.',
    ],
    '/docs/troubleshooting-multi-tenant.md#authentication-issues',
  ),

  AUTH_TOKEN_INVALID: new MeridianError(
    'AUTH_TOKEN_INVALID', 401,
    'JWT token is invalid or has been revoked.',
    [
      'Log in again via POST /api/auth/login to obtain a fresh token.',
      'Ensure the JWT secret has not changed since the token was issued.',
      'Verify the token has not been logged out via POST /api/auth/logout.',
    ],
    '/docs/troubleshooting-multi-tenant.md#authentication-issues',
  ),

  AUTH_FORBIDDEN: new MeridianError(
    'AUTH_FORBIDDEN', 403,
    'You do not have permission to perform this action.',
    [
      'Check that your account role grants access to this resource.',
      'Admin actions require the "admin" role.',
      'Operator actions require the "operator" or "admin" role.',
      'Contact your platform administrator to update your role.',
    ],
    '/docs/multi-tenant-api.md#roles-and-permissions',
  ),

  AUTH_CSRF: new MeridianError(
    'AUTH_CSRF', 403,
    'Request rejected: missing or invalid per-boot token, or cross-origin request.',
    [
      'Ensure requests originate from the dashboard origin.',
      'Include the x-aios-token header with the current session token.',
      'If accessing programmatically, use an API key instead of the browser session.',
    ],
  ),

  AUTH_BAD_CREDENTIALS: new MeridianError(
    'AUTH_BAD_CREDENTIALS', 401,
    'Invalid email or password.',
    [
      'Double-check your email address and password.',
      'Use POST /api/auth/me/password to reset your password if you have a valid token.',
      'Contact your administrator to reset your account.',
    ],
  ),

  AUTH_RATE_LIMITED: new MeridianError(
    'AUTH_RATE_LIMITED', 429,
    'Too many authentication attempts. Please wait before trying again.',
    [
      'Wait for the rate-limit window to reset (default: 1 minute).',
      'Check the Retry-After response header for the exact wait time.',
      'If you need a higher limit, adjust policy.yaml → authentication.rateLimiting.maxRequests.',
    ],
    '/docs/troubleshooting-multi-tenant.md#performance-issues',
  ),

  // ── Rate Limiting (RATE_*) ─────────────────────────────────────────────────

  RATE_LIMIT_EXCEEDED: new MeridianError(
    'RATE_LIMIT_EXCEEDED', 429,
    'API rate limit exceeded. Too many requests in the current window.',
    [
      'Wait for the rate-limit window to reset. Check the X-RateLimit-Reset response header.',
      'Reduce request frequency or implement exponential back-off in your client.',
      'Increase limits in policy.yaml → authentication.rateLimiting.maxRequests (default: 100/min).',
      'Use API pagination (?limit=10&offset=0) to reduce the number of requests.',
    ],
    '/docs/troubleshooting-multi-tenant.md#performance-issues',
  ),

  // ── Projects (PROJECT_*) ───────────────────────────────────────────────────

  PROJECT_NOT_FOUND: new MeridianError(
    'PROJECT_NOT_FOUND', 404,
    'Project "{id}" not found or you do not have access to it.',
    [
      'Verify the project ID by listing projects: GET /api/projects',
      'Ensure your account is a member of the project.',
      'The project may have been deleted. Check with your administrator.',
    ],
    '/docs/troubleshooting-multi-tenant.md#project-management-issues',
  ),

  PROJECT_ALREADY_RUNNING: new MeridianError(
    'PROJECT_ALREADY_RUNNING', 409,
    'Project "{id}" is already running.',
    [
      'Check the project status via GET /api/projects/{id}.',
      'Stop the project first via POST /api/projects/{id}/stop, then start it again.',
    ],
  ),

  PROJECT_NOT_RUNNING: new MeridianError(
    'PROJECT_NOT_RUNNING', 409,
    'Project "{id}" is not running.',
    [
      'Start the project first via POST /api/projects/{id}/start.',
      'Check the project health via GET /api/projects/{id}/health.',
    ],
  ),

  PROJECT_LIMIT_EXCEEDED: new MeridianError(
    'PROJECT_LIMIT_EXCEEDED', 403,
    'License tier limit reached. Cannot create more projects.',
    [
      'Check your current tier limits: GET /api/billing/limits',
      'Upgrade your subscription to allow more projects: POST /api/billing/checkout',
      'Delete unused projects to free capacity: DELETE /api/projects/{id}',
    ],
    '/docs/troubleshooting-multi-tenant.md#billing-and-licensing-issues',
  ),

  PROJECT_DELETE_RUNNING: new MeridianError(
    'PROJECT_DELETE_RUNNING', 409,
    'Cannot delete a running project.',
    [
      'Stop the project first: POST /api/projects/{id}/stop',
      'Wait for the project to fully stop, then retry the delete.',
    ],
  ),

  TEMPLATE_NOT_FOUND: new MeridianError(
    'TEMPLATE_NOT_FOUND', 404,
    'Template "{id}" not found.',
    [
      'List available templates: GET /api/projects/templates',
      'Valid built-in templates: saas-web-app, mobile-app, cli-tool, library-sdk, documentation-site, data-pipeline, blank',
      'Ensure custom template files exist in the templates/ directory.',
    ],
    '/docs/troubleshooting-multi-tenant.md#project-management-issues',
  ),

  // ── Billing / Licensing (BILLING_*) ───────────────────────────────────────

  BILLING_LICENSE_INVALID: new MeridianError(
    'BILLING_LICENSE_INVALID', 402,
    'License key is invalid or has expired.',
    [
      'Validate the current license: POST /api/billing/license/validate',
      'Force a license refresh: POST /api/billing/license/refresh',
      'Check your subscription status in the Stripe portal: GET /api/billing/portal',
      'If recently purchased, webhooks may not have arrived yet — wait 60 s and retry.',
    ],
    '/docs/troubleshooting-multi-tenant.md#billing-and-licensing-issues',
  ),

  BILLING_SUBSCRIPTION_NOT_FOUND: new MeridianError(
    'BILLING_SUBSCRIPTION_NOT_FOUND', 404,
    'No active subscription found for this account.',
    [
      'Purchase a subscription: POST /api/billing/checkout',
      'View available pricing plans: GET /api/billing/pricing',
      'If you believe you have an active subscription, contact support.',
    ],
    '/docs/troubleshooting-multi-tenant.md#billing-and-licensing-issues',
  ),

  BILLING_STRIPE_WEBHOOK_INVALID: new MeridianError(
    'BILLING_STRIPE_WEBHOOK_INVALID', 400,
    'Stripe webhook signature verification failed.',
    [
      'Ensure the STRIPE_WEBHOOK_SECRET environment variable matches your Stripe dashboard.',
      'Verify the raw request body is forwarded without modification.',
      'Rotate the webhook signing secret in Stripe dashboard if compromised.',
    ],
    '/docs/troubleshooting-multi-tenant.md#billing-and-licensing-issues',
  ),

  BILLING_STRIPE_NOT_CONFIGURED: new MeridianError(
    'BILLING_STRIPE_NOT_CONFIGURED', 503,
    'Stripe billing is not configured on this server.',
    [
      'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in your environment.',
      'Add stripe configuration to policy.yaml → billing.stripe.',
      'Restart the dashboard server after updating configuration.',
    ],
    '/docs/migration-multi-tenant.md#step-5-configure-stripe-for-billing',
  ),

  // ── Team Collaboration (TEAM_*) ────────────────────────────────────────────

  INVITATION_EXPIRED: new MeridianError(
    'INVITATION_EXPIRED', 410,
    'This invitation link has expired.',
    [
      'Invitations are valid for 7 days.',
      'Ask an administrator to send a new invitation: POST /api/auth/invitations',
      'The inviting admin can check invitation status via GET /api/auth/invitations.',
    ],
    '/docs/troubleshooting-multi-tenant.md#team-collaboration-issues',
  ),

  INVITATION_ALREADY_USED: new MeridianError(
    'INVITATION_ALREADY_USED', 409,
    'This invitation has already been accepted.',
    [
      'Log in with your existing credentials: POST /api/auth/login',
      'If you have forgotten your password, contact an administrator to reset it.',
    ],
  ),

  MEMBER_NOT_FOUND: new MeridianError(
    'MEMBER_NOT_FOUND', 404,
    'Team member "{userId}" not found in project "{id}".',
    [
      'List current project members: GET /api/projects/{id}/members',
      'Ensure you are using the correct user ID (UUID format).',
    ],
    '/docs/troubleshooting-multi-tenant.md#team-collaboration-issues',
  ),

  // ── Compliance Reporting (REPORT_*) ───────────────────────────────────────

  REPORT_GENERATION_FAILED: new MeridianError(
    'REPORT_GENERATION_FAILED', 500,
    'Report generation failed.',
    [
      'Check server logs for the underlying error.',
      'Verify the ledger database is accessible and not locked.',
      'Reduce the date range (e.g., use 7 days instead of 30) if the dataset is large.',
      'Ensure sufficient disk space for the output file: df -h',
    ],
    '/docs/troubleshooting-multi-tenant.md#compliance-reporting-issues',
  ),

  REPORT_NOT_FOUND: new MeridianError(
    'REPORT_NOT_FOUND', 404,
    'Report file not found.',
    [
      'List available reports: GET /api/compliance/reports',
      'Reports are generated asynchronously — wait a few seconds and retry.',
      'Check disk space and the .ai/reports/ directory.',
    ],
    '/docs/troubleshooting-multi-tenant.md#compliance-reporting-issues',
  ),

  // ── Database (DB_*) ────────────────────────────────────────────────────────

  DB_CONNECTION_FAILED: new MeridianError(
    'DB_CONNECTION_FAILED', 503,
    'Failed to connect to the database.',
    [
      'Verify the database file exists: ls .ai/control-plane.db',
      'Check file permissions: chmod 644 .ai/control-plane.db',
      'Run an integrity check: sqlite3 .ai/control-plane.db "PRAGMA integrity_check;"',
      'Restore from backup if the file is corrupted.',
    ],
    '/docs/troubleshooting-multi-tenant.md#database-issues',
  ),

  DB_LOCKED: new MeridianError(
    'DB_LOCKED', 503,
    'Database is temporarily locked by another operation.',
    [
      'Retry the request after a brief delay (1–2 seconds).',
      'Restart the dashboard server if locking persists.',
      'Increase the SQLite busy_timeout if this is frequent.',
    ],
    '/docs/troubleshooting-multi-tenant.md#database-issues',
  ),

  // ── OAuth SSO (OAUTH_*) ────────────────────────────────────────────────────

  OAUTH_PROVIDER_NOT_CONFIGURED: new MeridianError(
    'OAUTH_PROVIDER_NOT_CONFIGURED', 503,
    'OAuth provider "{provider}" is not configured.',
    [
      'Add the provider to policy.yaml → authentication.oauth.{provider}.',
      'Set the clientId, clientSecret, and redirectUri fields.',
      'Restart the dashboard server after updating configuration.',
    ],
    '/docs/migration-multi-tenant.md#step-4-configure-oauth-providers-optional',
  ),

  OAUTH_STATE_INVALID: new MeridianError(
    'OAUTH_STATE_INVALID', 400,
    'Invalid or missing OAuth state parameter. Possible CSRF attempt.',
    [
      'Restart the OAuth flow from the login page.',
      'Clear browser cookies and retry.',
      'Ensure cookies are enabled in your browser.',
    ],
    '/docs/troubleshooting-multi-tenant.md#oauth-ssi-issues',
  ),

  // ── Generic (SERVER_*) ─────────────────────────────────────────────────────

  SERVER_ANALYTICS_UNAVAILABLE: new MeridianError(
    'SERVER_ANALYTICS_UNAVAILABLE', 503,
    'Analytics are currently unavailable. The ledger database is not accessible.',
    [
      'Ensure the gateway is running and has written data to the ledger.',
      'Check that the ledger database path is correct in policy.yaml.',
      'Restart the gateway: node gateway/server.mjs',
    ],
  ),

  SERVER_INTERNAL: new MeridianError(
    'SERVER_INTERNAL', 500,
    'An unexpected internal error occurred.',
    [
      'Check server logs for the full error message and stack trace.',
      'Retry the request. If the problem persists, file a bug report.',
      'Provide the error details and request ID when contacting support.',
    ],
  ),

  SERVER_NOT_FOUND: new MeridianError(
    'SERVER_NOT_FOUND', 404,
    'The requested endpoint does not exist.',
    [
      'Check the API reference: GET /api/status for a list of available routes.',
      'Ensure you are using the correct HTTP method (GET vs POST vs DELETE etc.).',
      'Review the API documentation at docs/multi-tenant-api.md.',
    ],
    '/docs/multi-tenant-api.md',
  ),

  SERVER_METHOD_NOT_ALLOWED: new MeridianError(
    'SERVER_METHOD_NOT_ALLOWED', 405,
    'HTTP method "{method}" is not allowed for this endpoint.',
    [
      'Check the API reference for the correct HTTP method.',
      'Review the API documentation at docs/multi-tenant-api.md.',
    ],
    '/docs/multi-tenant-api.md',
  ),
};

// ─── Response helper ─────────────────────────────────────────────────────────

/**
 * Write a structured error response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {MeridianError} err
 * @param {Object} [context={}]  - Values to interpolate into message/remediation strings.
 * @param {Object} [extra={}]    - Extra fields to merge into the response body.
 */
export function sendError(res, err, context = {}, extra = {}) {
  const body = { ...err.toJSON(context), ...extra };
  res.writeHead(err.httpStatus, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Wrap an unknown thrown value into a MeridianError for consistent serialisation.
 * If `e` is already a MeridianError it is returned as-is.
 *
 * @param {unknown} e
 * @returns {MeridianError}
 */
export function toMeridianError(e) {
  if (e instanceof MeridianError) return e;
  const wrapped = Object.create(Errors.SERVER_INTERNAL);
  wrapped.message = (e && e.message) ? String(e.message) : String(e);
  return wrapped;
}
