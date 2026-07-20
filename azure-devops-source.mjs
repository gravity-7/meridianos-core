/**
 * azure-devops-source — pulls Feature/Epic work items from Azure DevOps and maps them
 * into MeridianOS tasks. This is THE bootstrap module that lets mos-dev self-build.
 *
 * TWO DIRECTIONS:
 *   pull (ADO → MeridianOS): query ADO work items, create/update MeridianOS tasks
 *   push (MeridianOS → ADO): write PR links and state transitions back to ADO
 *
 * AUTH: Personal Access Token (PAT) with Work Items (Read, Write) scope.
 *   Read from process.env[pat_env] — NEVER hardcoded, NEVER committed.
 *
 * IDEMPOTENT: running pull twice on the same ADO items does NOT create duplicate tasks.
 *   Task identity is keyed on ADO work item ID (prefix: 'ADO-').
 */

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE_NAME = 'azure-devops';
const ADO_BASE = (org) => `https://dev.azure.com/${org}`;
const ID_RE = /^(?:ADO-)?(\d+)$/;

// ═══════════════════════════════════════════════════════════════
// AUTH & HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Build auth header from a PAT.
 * @param {string} pat — raw Personal Access Token
 * @returns {string} 'Basic <base64>'
 */
export function authHeader(pat) {
  if (!pat) return '';
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}

/**
 * Execute fetch with retry (up to 3 tries, exponential backoff) for transient network failures.
 */
async function fetchWithRetry(url, options, fetchImpl, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchImpl(url, options);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 100));
      }
    }
  }
  throw lastError;
}

/**
 * Helper for request headers.
 */
function requestHeaders(pat, contentType = 'application/json') {
  const h = {};
  if (contentType) h['Content-Type'] = contentType;
  const auth = authHeader(pat);
  if (auth) h.Authorization = auth;
  return h;
}

// ═══════════════════════════════════════════════════════════════
// PULL: ADO → MeridianOS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch work items using WIQL.
 */
export async function queryWorkItems({ org, project, pat, query, fetch: fetchImpl = fetch } = {}) {
  const wiql = query || `
    SELECT [System.Id]
    FROM WorkItems
    WHERE [System.TeamProject] = '${project}'
      AND [System.WorkItemType] IN ('Feature', 'Epic')
      AND [System.State] IN ('Proposed', 'Active', 'To Do', 'In Progress')
    ORDER BY [System.Id]
  `;

  const url = `${ADO_BASE(org)}/${project}/_apis/wit/wiql?api-version=7.1-preview.2`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: requestHeaders(pat, 'application/json'),
      body: JSON.stringify({ query: wiql }),
    },
    fetchImpl,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`azure-devops: ${org}/${project} request failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();
  return data.workItems ?? [];
}

/**
 * Fetch full details for one work item.
 */
export async function getWorkItem({ org, project, pat, id, fetch: fetchImpl = fetch } = {}) {
  const url = `${ADO_BASE(org)}/${project}/_apis/wit/workitems/${id}?$expand=all&api-version=7.1-preview.3`;
  const res = await fetchWithRetry(
    url,
    {
      headers: requestHeaders(pat, null),
    },
    fetchImpl,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`azure-devops: ${org}/${project} getWorkItem ${id} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }

  return res.json();
}

/**
 * Fetch all matching work items with full details.
 */
export async function pullWorkItems({ org, project, pat, query, fetch: fetchImpl = fetch } = {}) {
  const summaries = await queryWorkItems({ org, project, pat, query, fetch: fetchImpl });
  const items = [];
  for (const s of summaries) {
    try {
      const item = await getWorkItem({ org, project, pat, id: s.id, fetch: fetchImpl });
      items.push(item);
    } catch (err) {
      // Log / continue on individual item fetch error
      console.warn(`[aios] azure-devops: failed to fetch item ${s.id}: ${err.message}`);
    }
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════
// MAPPING: ADO Work Item → MeridianOS Task
// ═══════════════════════════════════════════════════════════════

/**
 * Map ADO state to MeridianOS task status.
 */
export function mapAdoState(state) {
  const lower = (state ?? '').toLowerCase();
  const MAP = {
    'to do': 'proposed',
    'proposed': 'proposed',
    'doing': 'designing',
    'active': 'designing',
    'in progress': 'designing',
    'in review': 'in-review',
    'resolved': 'in-review',
    'done': 'done',
    'closed': 'done',
    'removed': 'archived',
  };
  return MAP[lower] ?? 'proposed';
}

/**
 * Map MeridianOS status back to ADO state.
 */
export function mapAiosStateToAdo(status) {
  const MAP = {
    'proposed': 'Proposed',
    'spec': 'Active',
    'designing': 'Active',
    'ready-for-impl': 'Active',
    'in-progress': 'In Progress',
    'in-review': 'Resolved',
    'done': 'Closed',
    'archived': 'Removed',
  };
  return MAP[status] ?? 'Active';
}

/**
 * Extract fields from an ADO work item response.
 */
export function extractFields(adoItem) {
  const f = adoItem?.fields ?? {};
  return {
    adoId: adoItem?.id,
    title: f['System.Title'] ?? '(untitled)',
    description: f['System.Description'] ?? '',
    acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '',
    state: f['System.State'] ?? 'To Do',
    tags: f['System.Tags'] ?? '',
    assignedTo: f['System.AssignedTo']?.displayName ?? f['System.AssignedTo'] ?? '',
    url: adoItem?._links?.html?.href ?? adoItem?.url ?? '',
    type: f['System.WorkItemType'] ?? 'Feature',
    reason: f['System.Reason'] ?? '',
    createdDate: f['System.CreatedDate'] ?? '',
    changedDate: f['System.ChangedDate'] ?? '',
  };
}

/**
 * Build a MeridianOS task ID from an ADO work item.
 * Format: ADO-{id} (e.g., ADO-3 for ADO work item #3)
 */
export function buildTaskId(adoId) {
  return `ADO-${adoId}`;
}

/**
 * Strip HTML tags from description and normalize markup to Markdown.
 */
export function stripHtml(html) {
  if (!html) return '';
  let str = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  str = str.replace(/<[^>]+>/g, '');
  str = str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return str.trim();
}

/**
 * Convert one ADO work item into a MeridianOS task shape.
 */
export function toTask(adoItem, { config } = {}) {
  const f = extractFields(adoItem);
  const taskId = buildTaskId(f.adoId);

  return {
    id: taskId,
    title: f.title,
    status: mapAdoState(f.state),
    acceptance_criteria: stripHtml(f.acceptanceCriteria) || undefined,
    complexity: extractComplexity(f.tags) ?? undefined,
    owner: extractOwner(f.tags) ?? (f.assignedTo || undefined),
    spec: `.ai/features/${taskId}/spec.md`,
    adoUrl: f.url,
    adoId: f.adoId,
    adoState: f.state,
    adoType: f.type,
  };
}

/** Extract complexity from tags like 'complexity-3' */
function extractComplexity(tags) {
  const m = (tags ?? '').match(/complexity[=-](\d)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Extract owner from tags like 'builder', 'designer', 'reviewer', 'docs-writer' */
function extractOwner(tags) {
  const owners = ['builder', 'designer', 'reviewer', 'docs-writer'];
  const tagsLower = (tags ?? '').toLowerCase();
  for (const o of owners) {
    if (tagsLower.includes(o)) return o;
  }
  return null;
}

/**
 * Write a spec file for a task from its ADO description.
 * @returns {string} path to the written spec file
 */
export function writeSpecFile(task, description, { config } = {}) {
  const root = config?.repoRoot ?? process.cwd();
  const specDir = join(root, '.ai', 'features', task.id);
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'spec.md');
  const cleanDescription = stripHtml(description);
  writeFileSync(specPath, cleanDescription || `# ${task.title}\n\n(No description provided in ADO)\n`, 'utf8');
  return specPath;
}

// ═══════════════════════════════════════════════════════════════
// PUSH: MeridianOS → ADO
// ═══════════════════════════════════════════════════════════════

/**
 * Push a state update to an ADO work item.
 */
export async function updateWorkItemState({ org, project, pat, id, state, comment, fetch: fetchImpl = fetch } = {}) {
  const url = `${ADO_BASE(org)}/${project}/_apis/wit/workitems/${id}?api-version=7.1-preview.3`;
  const patch = [];
  if (state) {
    patch.push({ op: 'add', path: '/fields/System.State', value: state });
  }
  if (comment) {
    patch.push({ op: 'add', path: '/fields/System.History', value: comment });
  }

  const res = await fetchWithRetry(
    url,
    {
      method: 'PATCH',
      headers: requestHeaders(pat, 'application/json-patch+json'),
      body: JSON.stringify(patch),
    },
    fetchImpl,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`azure-devops: updateWorkItem ${id} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

/**
 * Push a PR link back to the ADO work item.
 */
export async function pushPrLink({ org, project, pat, id, prUrl, state = 'Resolved', fetch: fetchImpl = fetch } = {}) {
  const comment = `PR opened: ${prUrl}`;
  return updateWorkItemState({ org, project, pat, id, state, comment, fetch: fetchImpl });
}

// ═══════════════════════════════════════════════════════════════
// SYNC: End-to-end ADO → MeridianOS sync
// ═══════════════════════════════════════════════════════════════

/**
 * Full sync: pull ADO work items, create/update MeridianOS tasks, write spec files.
 */
export async function syncFromAdo({ store, config, policy, fetch: fetchImpl = fetch } = {}) {
  const adoCfg = policy?.integrations?.azure_devops;
  if (!adoCfg?.enabled) {
    return { created: 0, updated: 0, skipped: 0, errors: [], reason: 'not-enabled' };
  }

  const patEnv = adoCfg.pat_env || 'ADO_PAT';
  const pat = process.env[patEnv];
  if (!pat) {
    const msg = `PAT not found in env var: ${patEnv}`;
    console.warn(`[aios] azure-devops: ${msg}`);
    return { created: 0, updated: 0, skipped: 0, errors: [msg], reason: 'no-pat' };
  }

  const { org, project, query } = adoCfg;
  if (!org || !project) {
    const msg = 'ADO org/project not configured';
    console.warn(`[aios] azure-devops: ${msg}`);
    return { created: 0, updated: 0, skipped: 0, errors: [msg], reason: 'no-config' };
  }

  let items;
  try {
    items = await pullWorkItems({ org, project, pat, query: query || undefined, fetch: fetchImpl });
  } catch (e) {
    const msg = e.message || String(e);
    console.warn(`[aios] azure-devops sync failed: ${msg}`);
    return { created: 0, updated: 0, skipped: 0, errors: [msg], reason: 'fetch-failed' };
  }

  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const adoItem of items) {
    try {
      const task = toTask(adoItem, { config });
      const existing = store?.state?.getTask(task.id);

      const f = extractFields(adoItem);
      writeSpecFile(task, f.description, { config });

      if (existing) {
        const newStatus = mapAdoState(f.state);
        if (existing.status !== newStatus) {
          store.state.upsertTask({ ...existing, status: newStatus });
          updated++;
        } else {
          skipped++;
        }
      } else {
        store.state.upsertTask(task);
        created++;
      }
    } catch (e) {
      errors.push(`ADO #${adoItem.id}: ${e.message}`);
    }
  }

  return { created, updated, skipped, errors, items: items.map((i) => toTask(i, { config })) };
}

// ═══════════════════════════════════════════════════════════════
// IntakeSource REGISTRY ADAPTER
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize ADO work item into shared IntakeSource item shape.
 */
function toIntakeItem(adoItem, { withBody }) {
  const f = extractFields(adoItem);
  const tags = (f.tags ?? '').split(';').map((t) => t.trim()).filter(Boolean);
  const featureTag = tags.find((t) => t.startsWith('feature:'));
  const item = {
    id: buildTaskId(f.adoId),
    source: SOURCE_NAME,
    kind: 'request',
    feature: featureTag ? featureTag.slice('feature:'.length) : null,
    status: f.state ?? null,
    path: null,
    meta: {
      adoId: f.adoId,
      title: f.title,
      url: f.url,
      tags,
      author: f.assignedTo || null,
      createdAt: f.createdDate || null,
      updatedAt: f.changedDate || null,
    },
  };
  if (withBody) {
    item.body = stripHtml(f.description);
    if (f.acceptanceCriteria) {
      item.acceptanceCriteria = stripHtml(f.acceptanceCriteria);
    }
  }
  return item;
}

/**
 * Build the `azure-devops` IntakeSource over `{ org, project, patEnv, query, fetch }`.
 */
export function createAzureDevOpsSource({ org, project, patEnv = 'ADO_PAT', query, fetch: fetchImpl = fetch } = {}) {
  async function list() {
    const pat = process.env[patEnv];
    const items = await pullWorkItems({ org, project, pat, query, fetch: fetchImpl });
    return items.map((item) => toIntakeItem(item, { withBody: false }));
  }

  async function read(id) {
    const pat = process.env[patEnv];
    const m = ID_RE.exec(id);
    if (!m) throw new Error(`azure-devops: invalid id '${id}'`);
    const item = await getWorkItem({ org, project, pat, id: m[1], fetch: fetchImpl });
    return toIntakeItem(item, { withBody: true });
  }

  return { name: SOURCE_NAME, list, read };
}
