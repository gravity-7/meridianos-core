/**
 * github-source — the GitHub Issues IntakeSource (ADR 0001 D2, card C3). Pull-only: this adapter
 * reads issues from a single `owner/repo` and normalizes them to the SAME item shape
 * `inbox-source.mjs` established (`id`/`source`/`kind`/`feature`/`status`/`path`/`meta`/`body`).
 * There is no `submit(...)` here — GitHub Issues is a read-only intake surface for this bite, no
 * comment/label/write-back of any kind.
 *
 * BYO-key, same discipline as providers.mjs's `keyEnv`: `opts.tokenEnv` is the NAME of an env var
 * (default `GITHUB_TOKEN`), read at call-time via `process.env[tokenEnv]`, never a literal token
 * in config. A missing/unset token is not an error by itself — public repos work tokenless — but
 * whatever the API actually returns (including a 401/403 for a private repo) is surfaced by
 * throwing, never silently swallowed into `[]` (callers must be able to tell "no issues" apart
 * from "auth failed").
 *
 * `fetch` is injected (defaults to the global) so tests never touch the network — see
 * pricing-refresh.mjs's identical `fetchImpl` pattern.
 *
 * Pagination: only the first page (`per_page=100`) is fetched. // TODO: paginate via the `Link`
 * response header once a tracked repo needs >100 open issues.
 */

const SOURCE_NAME = 'github-issues';
const API_BASE = 'https://api.github.com';
const ID_RE = /^issue-(\d+)$/;

/** Normalize one GitHub API issue object into the shared IntakeSource item shape. `withBody`
 *  controls whether `body` is included (present on read(), absent from list()). */
function toItem(issue, { withBody }) {
  const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
  const featureLabel = labels.find((l) => l.startsWith('feature:'));
  const item = {
    id: `issue-${issue.number}`,
    source: SOURCE_NAME,
    kind: 'request',
    feature: featureLabel ? featureLabel.slice('feature:'.length) : null,
    status: issue.state ?? null,
    path: null,
    meta: {
      number: issue.number,
      url: issue.html_url ?? null,
      labels,
      author: issue.user?.login ?? null,
      createdAt: issue.created_at ?? null,
      updatedAt: issue.updated_at ?? null,
      ...(issue.milestone?.title ? { milestone: issue.milestone.title } : {}),
    },
  };
  if (withBody) item.body = issue.body ?? '';
  return item;
}

/** Build the `github-issues` IntakeSource over `{ owner, repo, tokenEnv, labels, state, fetch }`. */
export function createGithubSource({ owner, repo, tokenEnv = 'GITHUB_TOKEN', labels, state = 'open', fetch: fetchImpl = fetch } = {}) {
  function headers() {
    const h = { Accept: 'application/vnd.github+json' };
    const token = process.env[tokenEnv];
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function request(url) {
    let res;
    try {
      res = await fetchImpl(url, { headers: headers() });
    } catch (e) {
      throw new Error(`github-issues: request to ${owner}/${repo} failed: ${e?.message || e}`);
    }
    if (!res.ok) {
      throw new Error(`github-issues: ${owner}/${repo} request failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  function listUrl() {
    const params = new URLSearchParams({ state, per_page: '100' });
    if (labels) params.set('labels', Array.isArray(labels) ? labels.join(',') : labels);
    return `${API_BASE}/repos/${owner}/${repo}/issues?${params.toString()}`;
  }

  /** Cheap listing: metadata only, `body` absent. Pull requests (issues carrying a
   *  `pull_request` field) are filtered out — issues only. */
  async function list() {
    const data = await request(listUrl());
    return data.filter((issue) => !('pull_request' in issue)).map((issue) => toItem(issue, { withBody: false }));
  }

  /** Full read: fetches the single issue by number, `body` present. */
  async function read(id) {
    const m = ID_RE.exec(id);
    if (!m) throw new Error(`github-issues: invalid id '${id}'`);
    const issue = await request(`${API_BASE}/repos/${owner}/${repo}/issues/${m[1]}`);
    return toItem(issue, { withBody: true });
  }

  return { name: SOURCE_NAME, list, read };
}
