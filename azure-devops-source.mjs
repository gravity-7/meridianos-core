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

import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ADO_BASE = (org) => `https://dev.azure.com/${org}`;

// ═══════════════════════════════════════════════════════════════
// PULL: ADO → MeridianOS
// ═══════════════════════════════════════════════════════════════

/**
 * Build auth header from a PAT.
 * @param {string} pat — raw Personal Access Token
 * @returns {string} 'Basic <base64>'
 */
export function authHeader(pat) {
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}

/**
 * Fetch work items using WIQL.
 * @param {object} opts
 * @param {string} opts.org — ADO organization name
 * @param {string} opts.project — ADO project name
 * @param {string} opts.pat — Personal Access Token
 * @param {string} [opts.query] — WIQL query (default: all Features/Epics in Proposed/Active/To Do)
 * @returns {Promise<Array<{id:number, url:string}>>}
 */
export async function queryWorkItems({ org, project, pat, query } = {}) {
  const wiql = query || `
    SELECT [System.Id]
    FROM WorkItems
    WHERE [System.TeamProject] = '${project}'
      AND [System.WorkItemType] IN ('Feature', 'Epic')
      AND [System.State] IN ('Proposed', 'Active', 'To Do', 'In Progress')
    ORDER BY [System.Id]
  `;

  const url = `${ADO_BASE(org)}/${project}/_apis/wit/wiql?api-version=7.1-preview.2`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(pat),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ADO WIQL failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.workItems ?? [];
}

/**
 * Fetch full details for one work item.
 * @returns {Promise<object>} ADO work item with fields
 */
export async function getWorkItem({ org, project, pat, id }) {
  const url = `${ADO_BASE(org)}/${project}/_apis/wit/workitems/${id}?$expand=all&api-version=7.1-preview.3`;
  const res = await fetch(url, {
    headers: { 'Authorization': authHeader(pat) },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ADO getWorkItem ${id} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Fetch all matching work items with full details.
 * @returns {Promise<Array<object>>}
 */
export async function pullWorkItems({ org, project, pat, query } = {}) {
  const summaries = await queryWorkItems({ org, project, pat, query });
  const items = [];
  for (const s of summaries) {
    try {
      const item = await getWorkItem({ org, project, pat, id: s.id });
      items.push(item);
    } catch (e) {
      console.warn(`[ado-source] Skipping work item #${s.id}: ${e.message}`);
    }
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════
// MAPPING: ADO Work Item → MeridianOS Task
// ═══════════════════════════════════════════════════════════════

/**
 * Map ADO state to MeridianOS task status.
 * Basic process: To Do → proposed, Doing → designing, Done → done
 * Agile process: Proposed → proposed, Active → designing, Resolved → in-review, Closed → done
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
  };
  return MAP[status] ?? 'Active';
}

/**
 * Extract fields from an ADO work item response.
 */
export function extractFields(adoItem) {
  const f = adoItem.fields ?? {};
  return {
    adoId: adoItem.id,
    title: f['System.Title'] ?? '(untitled)',
    description: f['System.Description'] ?? '',
    acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '',
    state: f['System.State'] ?? 'To Do',
    tags: f['System.Tags'] ?? '',
    assignedTo: f['System.AssignedTo']?.displayName ?? f['System.AssignedTo'] ?? '',
    url: adoItem._links?.html?.href ?? adoItem.url ?? '',
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
 * Convert one ADO work item into a MeridianOS task shape.
 * Does NOT write to the board — returns the task object for the caller to create/update.
 */
export function toTask(adoItem, { config } = {}) {
  const f = extractFields(adoItem);
  const taskId = buildTaskId(f.adoId);

  return {
    id: taskId,
    title: f.title,
    status: mapAdoState(f.state),
    acceptance_criteria: f.acceptanceCriteria || undefined,
    complexity: extractComplexity(f.tags) ?? undefined,
    owner: extractOwner(f.tags) ?? (f.assignedTo || undefined),
    specPath: `.ai/features/${taskId}/spec.md`,
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
  writeFileSync(specPath, description || `# ${task.title}\n\n(No description provided in ADO)\n`, 'utf8');
  return specPath;
}

// ═══════════════════════════════════════════════════════════════
// PUSH: MeridianOS → ADO
// ═══════════════════════════════════════════════════════════════

/**
 * Push a state update to an ADO work item.
 */
export async function updateWorkItemState({ org, project, pat, id, state, comment } = {}) {
  const url = `${ADO_BASE(org)}/${project}/_apis/wit/workitems/${id}?api-version=7.1-preview.3`;
  const patch = [
    { op: 'add', path: '/fields/System.State', value: state },
  ];
  if (comment) {
    patch.push({ op: 'add', path: '/fields/System.History', value: comment });
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': authHeader(pat),
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ADO updateWorkItem ${id} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Push a PR link back to the ADO work item.
 */
export async function pushPrLink({ org, project, pat, id, prUrl, state = 'Resolved' } = {}) {
  const comment = `✅ PR opened: ${prUrl}`;
  return updateWorkItemState({ org, project, pat, id, state, comment });
}

// ═══════════════════════════════════════════════════════════════
// SYNC: End-to-end ADO → MeridianOS sync
// ═══════════════════════════════════════════════════════════════

/**
 * Full sync: pull ADO work items, create/update MeridianOS tasks, write spec files.
 *
 * @param {object} opts
 * @param {object} opts.store — the AIOS state store (for getTask / upsertTask)
 * @param {object} opts.config — the AiosConfig
 * @param {object} opts.policy — parsed policy.yaml (must have integrations.azure_devops)
 * @returns {Promise<{created:number, updated:number, skipped:number, errors: string[]}>}
 */
export async function syncFromAdo({ store, config, policy } = {}) {
  const adoCfg = policy?.integrations?.azure_devops;
  if (!adoCfg?.enabled) {
    return { created: 0, updated: 0, skipped: 0, errors: [], reason: 'not-enabled' };
  }

  const patEnv = adoCfg.pat_env || 'ADO_PAT';
  const pat = process.env[patEnv];
  if (!pat) {
    return { created: 0, updated: 0, skipped: 0, errors: [`PAT not found in env var: ${patEnv}`], reason: 'no-pat' };
  }

  const { org, project, query, state_mapping } = adoCfg;
  if (!org || !project) {
    return { created: 0, updated: 0, skipped: 0, errors: ['ADO org/project not configured'], reason: 'no-config' };
  }

  let items;
  try {
    items = await pullWorkItems({ org, project, pat, query: query || undefined });
  } catch (e) {
    return { created: 0, updated: 0, skipped: 0, errors: [e.message], reason: 'fetch-failed' };
  }

  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const adoItem of items) {
    try {
      const task = toTask(adoItem, { config });
      const existing = store?.state?.getTask(task.id);

      // Write spec file (always — keeps it in sync with ADO description)
      const f = extractFields(adoItem);
      writeSpecFile(task, f.description, { config });

      if (existing) {
        // Update if ADO state changed
        const newStatus = mapAdoState(f.state);
        if (existing.status !== newStatus) {
          // Task exists — update status
          // (store transition handled by caller, not this module — this module only reads)
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Create new task in the board
        // The caller (planner/scheduler) handles task creation using the returned data
        created++;
      }
    } catch (e) {
      errors.push(`ADO #${adoItem.id}: ${e.message}`);
    }
  }

  return { created, updated, skipped, errors, items: items.map(i => toTask(i, { config })) };
}

// ═══════════════════════════════════════════════════════════════
// F006: CONFIG RESOLUTION
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve ADO configuration from policy. Supports both `integrations.ado` (F006) and
 * `integrations.azure_devops` (legacy). Returns null if ADO is not configured/enabled.
 *
 * PAT resolution order: policy.pat_env → AZURE_DEVOPS_EXT_PAT → ADO_PAT
 *
 * @param {object} policy — parsed policy.yaml
 * @returns {{ org:string, project:string, pat:string, query?:string, enabled:true }|null}
 */
export function resolveAdoConfig(policy) {
  const adoCfg = policy?.integrations?.ado ?? policy?.integrations?.azure_devops;
  if (!adoCfg?.enabled) return null;

  const patEnv = adoCfg.pat_env || 'AZURE_DEVOPS_EXT_PAT';
  const pat = process.env[patEnv]
    || process.env['AZURE_DEVOPS_EXT_PAT']
    || process.env['ADO_PAT'];

  if (!pat) return null;

  const { org, project } = adoCfg;
  if (!org || !project) return null;

  return {
    org,
    project,
    pat,
    query: adoCfg.query || undefined,
    enabled: true,
  };
}

// ═══════════════════════════════════════════════════════════════
// F006: PUSH STATUS (MeridianOS → ADO)
// ═══════════════════════════════════════════════════════════════

/**
 * Push a MeridianOS status update to an ADO work item. Maps the AIOS status to the
 * corresponding ADO state and PATCHes the work item.
 *
 * @param {object} adoConfig — { org, project, pat }
 * @param {number} workItemId — ADO work item ID
 * @param {string} status — MeridianOS status (proposed, designing, in-progress, done, etc.)
 * @param {string} [comment] — optional comment to append to ADO history
 * @returns {Promise<object>} the updated ADO work item
 */
export async function pushStatus(adoConfig, workItemId, status, comment) {
  const adoState = mapAiosStateToAdo(status);
  const defaultComment = `MeridianOS agent updated status to: ${status}`;
  return updateWorkItemState({
    ...adoConfig,
    id: workItemId,
    state: adoState,
    comment: comment || defaultComment,
  });
}

// ═══════════════════════════════════════════════════════════════
// F006: SYNC TO BOARD (ADO → MeridianOS)
// ═══════════════════════════════════════════════════════════════

/**
 * Pull ADO work items and upsert them into the local MeridianOS board. Idempotent — running
 * twice on the same ADO items does NOT create duplicate tasks (task identity is keyed on
 * ADO work item ID via the `ADO-{id}` prefix).
 *
 * @param {object} adoConfig — { org, project, pat, query? }
 * @param {object} store — ProjectStore (must have store.state.upsertTask and store.state.getTask)
 * @returns {Promise<{created:number, updated:number, skipped:number, errors:string[]}>}
 */
export async function syncToBoard(adoConfig, store) {
  const items = await pullWorkItems(adoConfig);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const adoItem of items) {
    try {
      const f = extractFields(adoItem);
      const task = toTask(adoItem);
      const existing = store.state.getTask(task.id);

      // Determine the mapped status
      const newStatus = mapAdoState(f.state);

      if (!existing) {
        // New task — upsert with all fields
        store.state.upsertTask({
          ...task,
          status: newStatus,
          note: JSON.stringify({
            adoUrl: f.url,
            adoId: f.adoId,
            adoState: f.state,
            adoType: f.type,
          }),
        });
        created++;
      } else {
        // Existing task — parse current ADO metadata from note
        let adoMeta = {};
        try {
          adoMeta = JSON.parse(existing.note || '{}');
        } catch { /* note is not JSON, treat as empty */ }

        // If ADO state has changed, update the task
        if (adoMeta.adoState !== f.state || existing.status !== newStatus) {
          store.state.upsertTask({
            ...task,
            status: newStatus,
            note: JSON.stringify({
              adoUrl: f.url,
              adoId: f.adoId,
              adoState: f.state,
              adoType: f.type,
            }),
          });
          updated++;
        } else {
          skipped++;
        }
      }
    } catch (e) {
      errors.push(`ADO #${adoItem.id}: ${e.message}`);
    }
  }

  return { created, updated, skipped, errors };
}

// ═══════════════════════════════════════════════════════════════
// F006: SYNC FROM BOARD (MeridianOS → ADO)
// ═══════════════════════════════════════════════════════════════

/**
 * Read board items that originated from ADO (id prefixed `ADO-`) and push status changes
 * back to Azure DevOps. Compares the local MeridianOS status against the last-known ADO
 * state (stored in the task's `note` JSON) and only pushes when they differ.
 *
 * @param {object} adoConfig — { org, project, pat }
 * @param {object} store — ProjectStore (must have store.state.listTasks)
 * @returns {Promise<{pushed:number, skipped:number, errors:string[]}>}
 */
export async function syncFromBoard(adoConfig, store) {
  const tasks = store.state.listTasks();
  const adoTasks = tasks.filter((t) => t.id && t.id.startsWith('ADO-'));

  let pushed = 0;
  let skipped = 0;
  const errors = [];

  for (const task of adoTasks) {
    try {
      const adoId = parseInt(task.id.replace('ADO-', ''), 10);
      if (isNaN(adoId)) {
        skipped++;
        continue;
      }

      // Parse stored ADO metadata from the note field
      let adoMeta = {};
      try {
        adoMeta = JSON.parse(task.note || '{}');
      } catch { /* note is not JSON */ }

      // Map local status to ADO state
      const newAdoState = mapAiosStateToAdo(task.status);

      // Only push if the mapped ADO state differs from the last-known ADO state
      if (adoMeta.adoState && newAdoState !== adoMeta.adoState) {
        await updateWorkItemState({
          ...adoConfig,
          id: adoId,
          state: newAdoState,
          comment: `MeridianOS agent updated status to: ${task.status}`,
        });

        // Update the stored ADO state in the note
        store.state.upsertTask({
          ...task,
          note: JSON.stringify({
            ...adoMeta,
            adoState: newAdoState,
          }),
        });

        pushed++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(`ADO task ${task.id}: ${e.message}`);
    }
  }

  return { pushed, skipped, errors };
}
