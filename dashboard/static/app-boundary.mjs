/**
 * Browser-facing adapter for existing dashboard endpoints. It deliberately maps responses into
 * a small view contract; it never changes public endpoint URLs, requests, or response bodies.
 * @typedef {{state:'content', data:{activeRuns:number, queuedTasks:number}} | {state:'empty', message:string} | {state:'error', message:string, recoverable:boolean}} StatusView
 */

export function statusViewFromResponse({ status = 200, body, error } = {}) {
  if (status === 401 || status === 403) return { state: 'error', message: 'You do not have access to application status.', recoverable: false };
  if (error || status >= 400) return { state: 'error', message: 'Unable to load application status. Try again.', recoverable: true };
  if (!body || typeof body !== 'object') return { state: 'error', message: 'Application status was unavailable.', recoverable: true };
  const activeRuns = Array.isArray(body.runs) ? body.runs.length : 0;
  const queuedTasks = Array.isArray(body.queue) ? body.queue.length : 0;
  if (activeRuns === 0 && queuedTasks === 0) return { state: 'empty', message: 'There are no active runs or queued tasks.' };
  return { state: 'content', data: { activeRuns, queuedTasks } };
}

export async function readApplicationStatus(fetchImpl = fetch) {
  try {
    const response = await fetchImpl('/api/status', { headers: { accept: 'application/json' } });
    let body;
    try { body = await response.json(); } catch { return statusViewFromResponse({ status: response.status }); }
    return statusViewFromResponse({ status: response.status, body });
  } catch {
    return statusViewFromResponse({ error: true });
  }
}
