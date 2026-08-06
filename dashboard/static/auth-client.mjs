/**
 * auth-client — minimal per-user JWT session helper shared by team-bootstrap.mjs and the
 * spec-overlay task comments in index.html. Separate from the existing `__AIOS_TOKEN__` /
 * x-aios-token header used by the rest of the dashboard: that's a single same-origin shared
 * secret gating the whole app, while /api/auth/*, /api/projects/:id/members, /api/tasks/:id/comments
 * etc. are per-user (JWT `Authorization: Bearer`, see dashboard/server.mjs's requireAuth) so
 * activity/comments/role-changes can be attributed to a real user, not "the dashboard".
 */

const TOKEN_KEY = 'meridianos_token';
const USER_KEY = 'meridianos_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** fetch() with the bearer token attached; clears the session and returns null on 401 so
 *  callers can fall back to the login prompt instead of rendering a confusing error state. */
export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    return null;
  }
  return res;
}

/** Renders a compact inline login form into `container` and calls `onSuccess()` once a session
 *  is established (either an existing token that still verifies, or a fresh login). */
export function renderLoginPrompt(container, onSuccess) {
  container.innerHTML = `
    <div class="auth-prompt">
      <p style="margin:0 0 10px;font-size:12px;color:var(--text-muted)">Sign in to view and manage this project's team.</p>
      <form id="authPromptForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
        <input type="email" id="authPromptEmail" placeholder="email" required style="flex:1;min-width:160px">
        <input type="password" id="authPromptPassword" placeholder="password" required style="flex:1;min-width:160px">
        <button type="submit" class="btn btn-primary">Sign in</button>
      </form>
      <div id="authPromptStatus" style="font-size:12px;color:var(--text-danger);margin-top:6px"></div>
    </div>
  `;

  const form = container.querySelector('#authPromptForm');
  const status = container.querySelector('#authPromptStatus');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const email = container.querySelector('#authPromptEmail').value.trim();
    const password = container.querySelector('#authPromptPassword').value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await res.json();
      if (!result.success) {
        status.textContent = result.error || 'Login failed';
        return;
      }
      setSession(result.token, result.user);
      onSuccess(result.user);
    } catch (err) {
      status.textContent = 'Network error: ' + err.message;
    }
  });
}

/** Resolves with the current user if the stored token still verifies, or null otherwise
 *  (expired/missing/invalid) — used to skip the login prompt on repeat visits. */
export async function verifySession() {
  if (!getToken()) return null;
  const res = await authFetch('/api/auth/me');
  if (!res) return null;
  const result = await res.json();
  return result.success ? result.user : null;
}
