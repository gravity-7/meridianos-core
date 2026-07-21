# F006 – Azure DevOps Connector

**Feature ID:** F006
**Area:** Integrations
**Wedge:** Multi-Tool Integration Hub (Wedge 3)
**Status:** Proposed
**Priority:** P0 — Bootstrap (unlocks all other features)
**Estimated Effort:** 2 days
**Assigned To:** builder (DeepSeek V4 Pro via gateway)
**Dependencies:** F002 (gateway npm published)
**Blocks:** All self-build features (F004, F005, F007, F008, F011)
**ADR Integration Target:** `dev.azure.com/qaisarit/meridianOS`

---

## Business Context

### Problem
MeridianOS's scheduler/planner/launcher loop works against a local SQLite board (`.ai/state/board.json`). Features must be manually created as tasks on this board. For the self-build strategy, we need MeridianOS to autonomously pull work items from Azure DevOps — the source of truth for feature planning — and convert them into executable MeridianOS tasks. Without this connector, the mos-dev tenant has nothing to schedule.

### Why This Matters
- **Bootstrap:** This is THE feature that unlocks all other features. Without it, mos-dev cannot self-build.
- **Differentiator:** Jira Agents (Atlassian) works with Jira-only. GitHub Copilot Cloud Agents works with GitHub-only. MeridianOS is the ONLY system that can pull work from Azure DevOps, refine it, implement it, and push PRs back.
- **Enterprise wedge:** The Microsoft ecosystem (ADO + Azure + VS Code + Copilot) is underserved by AI automation tools. This connector makes MeridianOS the bridge.
- **Live proof:** Using the founder's own ADO org (`dev.azure.com/qaisarit/meridianOS`) as the integration target proves the connector works with a real enterprise tool.

### Success Criteria
1. MeridianOS scheduler pulls Feature work items from `dev.azure.com/qaisarit/meridianOS`
2. Each ADO Feature becomes a MeridianOS task with: title, description (spec), acceptance criteria, state
3. When an agent completes implementation and opens a PR, the PR link is written back to the ADO work item
4. State transitions in MeridianOS (in-review → done) are reflected in ADO
5. The connector works with Azure DevOps Personal Access Token (PAT) authentication

---

## Functional Requirements

### FR1: ADO Work Item Import
The connector SHALL pull work items from a configured Azure DevOps query:
- Organization: `qaisarit`
- Project: `meridianOS`
- Work item type: `Feature` (filterable)
- States: `Proposed`, `Active` (configurable)
- Fields imported: `System.Id`, `System.Title`, `System.Description`, `Microsoft.VSTS.Common.AcceptanceCriteria`, `System.State`, `System.AssignedTo`, `System.Tags`

### FR2: MeridianOS Task Creation
Each imported ADO work item SHALL become a MeridianOS task:
- `task.id` ← `F<ADO-workitem-id>` (e.g., ADO #42 → `F042`)
- `task.title` ← ADO `System.Title`
- `task.spec` ← ADO `System.Description` (written to `.ai/features/F<id>/spec.md`)
- `task.acceptance_criteria` ← ADO `Microsoft.VSTS.Common.AcceptanceCriteria`
- `task.status` ← mapped from ADO state: `Proposed`→`proposed`, `Active`→`spec`, `Resolved`→`in-review`, `Closed`→`done`
- `task.owner` ← from ADO tags (e.g., `builder`, `designer`, `reviewer`, `docs-writer`)

### FR3: PR Link Write-Back
When an agent completes a MeridianOS task and records a PR number, the connector SHALL:
- Update the ADO work item's `System.State` to `Resolved` or `In Review`
- Add a comment to the ADO work item: "PR opened: <PR_URL>"
- Optionally add the PR URL to a custom field (`Custom.PullRequestUrl`)

### FR4: State Synchronization
State mapping between ADO ↔ MeridianOS:
```
ADO: Proposed        →  MeridianOS: proposed
ADO: Active          →  MeridianOS: spec (or designing)
ADO: Resolved        →  MeridianOS: in-review
ADO: Closed          →  MeridianOS: done
ADO: Removed         →  MeridianOS: archived (or deleted)
```

### FR5: Incremental Sync
The connector SHALL be idempotent:
- Running twice does NOT create duplicate tasks
- Task identity is keyed on ADO work item ID
- If a task already exists and ADO description has changed, the spec file is updated
- If a task's ADO state has changed, the MeridianOS state is synced

---

## Technical Requirements

### TR1: Module Architecture
New module: `azure-devops-source.mjs`
```js
// azure-devops-source.mjs — ADO work item → MeridianOS task bridge
export async function pullWorkItems({ org, project, pat, query, config }) → Task[]
export async function pushPrLink({ org, project, pat, workItemId, prUrl }) → void
export function mapAdoStateToAios(state) → string
export function mapAiosStateToAdo(state) → string
```

### TR2: ADO REST API Usage
The connector SHALL use the Azure DevOps REST API (not Git, not Boards SDK):
- List work items: `GET https://dev.azure.com/{org}/{project}/_apis/wit/wiql`
- Get work item details: `GET https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?$expand=all`
- Update work item: `PATCH https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}`
- Add comment: `POST https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}/comments`
- Auth: `Authorization: Basic :${Buffer.from(`:${pat}`).toString('base64')}`

### TR3: Configuration
ADO connection SHALL be configured in `.ai/policy.yaml`:
```yaml
integrations:
  azure_devops:
    enabled: true
    org: qaisarit
    project: meridianOS
    pat_env: ADO_PAT              # PAT read from this env var (NEVER in policy file)
    query: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Feature' AND [System.State] IN ('Proposed', 'Active')"
    sync_interval_minutes: 5       # how often to poll
    write_back_pr: true            # push PR links back to ADO
    state_mapping:
      proposed: Proposed
      designing: Active
      in-review: Resolved
      done: Closed
```

### TR4: PAT Security
- PAT is read from `process.env.ADO_PAT` (or the configured `pat_env`) — NEVER stored in policy.yaml, never committed
- PAT is only used server-side (in the scheduler/daemon process)
- PAT scope: `Work Items (Read, Write)` — minimum required permissions
- PAT is never logged or printed

### TR5: Error Handling
- Network failures: retry 3 times with exponential backoff (1s, 2s, 4s)
- 401/403: log error, skip this sync cycle, do NOT crash the daemon
- Malformed ADO response: log warning, skip the affected work item, continue with others
- Missing PAT: log warning, skip sync, do NOT crash

---

## Architecture

### Data Flow
```
Azure DevOps                    mos-dev (MeridianOS tenant)
─────────────                   ─────────────────────────────
                                scheduler tick (~60s)
                                     │
                                     ▼
                                azure-devops-source.mjs
                                pullWorkItems()
                                     │
                              GET /_apis/wit/wiql
                              GET /_apis/wit/workitems/{id}
                                     │
                                     ▼
                                map ADO → MeridianOS tasks
                                write spec files
                                create/update board tasks
                                     │
                                     ▼
                                planner.mjs (DoR gate)
                                launcher.mjs (spawn agent)
                                     │
                                agent implements feature
                                opens PR on GitHub
                                     │
                                     ▼
                                pushPrLink()
                              PATCH /_apis/wit/workitems/{id}
                              POST /_apis/wit/workitems/{id}/comments
                                     │
                                     ▼
                                ADO work item updated:
                                state → Resolved
                                comment: "PR: https://github.com/..."
```

### Integration Point
The ADO sync runs as part of the scheduler's planner cycle — BEFORE the planner evaluates the board for promotable tasks. This ensures newly imported features are available for agent assignment in the same tick.

---

## Database Changes

**None.** ADO work items become standard MeridianOS tasks stored in the existing SQLite board DB. The spec files are written to `.ai/features/F<id>/spec.md`.

---

## Security

- **PAT:** Read from env var only. Minimum scope: Work Items (Read, Write). Never logged.
- **Network:** HTTPS only (`dev.azure.com`). Certificate validation enforced.
- **No data exfiltration:** Work item data stays within the mos-dev tenant. Nothing sent to third parties.
- **Write-back safety:** Only updates ADO state and adds comments. Never modifies work item title, description, or acceptance criteria.

---

## Validation

- [ ] `pullWorkItems()` returns correct number of Features from the live ADO board
- [ ] Each Feature maps to a valid MeridianOS task with correct fields
- [ ] Duplicate pull does not create duplicate tasks (idempotent)
- [ ] `pushPrLink()` successfully updates ADO work item state and adds comment
- [ ] Missing PAT results in graceful skip (no crash)
- [ ] Invalid PAT (401) results in logged warning (no crash)
- [ ] Network timeout results in retry, then skip (no crash)
- [ ] ADO fields with null/empty values don't break task creation

---

## Testing

### Unit Tests
- `mapAdoStateToAios`: verify all state mappings
- `mapAiosStateToAdo`: verify reverse mappings
- Task creation from mock ADO response
- Idempotency: double-pull same work item

### Integration Tests
- Live test against `dev.azure.com/qaisarit/meridianOS` with a test PAT
- Create a test Feature, pull it, verify task created
- Push a PR link, verify ADO work item updated

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| ADO work item has empty description | Task created with empty spec. Agent discovers no spec and skips or requests clarification. |
| ADO work item has no acceptance criteria | Task created. Planner's DoR gate blocks promotion past `spec` stage until ACs are added. |
| ADO work item is deleted after import | MeridianOS task orphaned. Next sync detects missing ADO item, marks task as `archived`. |
| Two MeridianOS agents try to claim the same ADO task | Standard lease mechanism prevents double-claim (existing `claimTask` in state store). |
| ADO PAT expires mid-sync | Next tick detects 401. Log warning. Sync skipped until PAT is renewed. |
| ADO work item has HTML in description | HTML tags stripped. Markdown preserved. Plain text fallback for unsupported HTML. |

---

## Acceptance Criteria

1. ✅ Running the scheduler in mos-dev pulls Feature work items from `dev.azure.com/qaisarit/meridianOS`
2. ✅ Each Feature becomes a MeridianOS task on the mos-dev board with correct title, spec, ACs, and state
3. ✅ Running sync twice does NOT create duplicate tasks
4. ✅ After an agent opens a PR, the ADO work item is updated with the PR link and state change
5. ✅ Missing or invalid PAT causes a logged warning, NOT a crash
6. ✅ Network failures are retried, then gracefully skipped

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ADO PAT scope insufficient | Medium | Sync fails | Document minimum PAT scope; test with actual PAT |
| ADO API rate limiting | Low | Throttled sync | Exponential backoff; 5-min sync interval is well within limits |
| ADO HTML descriptions break markdown parsing | Medium | Garbled spec files | Strip HTML tags, preserve markdown; add `--raw-text` flag if needed |
| State mapping mismatch with custom ADO workflows | Low | Wrong state transitions | Configurable state mapping in policy.yaml |

---

## Dependencies

- **External:** Azure DevOps account (`dev.azure.com/qaisarit/meridianOS`), PAT with Work Items (Read, Write)
- **Internal:** `scheduler.mjs` (planner cycle), `state.mjs` (task CRUD), `planner.mjs` (DoR gate)
- **Infra:** Node.js 24+ (built-in `fetch` for HTTPS)

---

## Non-Functional Requirements

- **Sync latency:** < 10 seconds for up to 50 work items
- **API calls per sync:** N+1 (1 WIQL query + 1 detail call per work item)
- **Memory:** No caching beyond the existing board DB
- **Reliability:** Network failures must not crash the daemon

---

## AI Implementation Guidance

### Step 1: Create the module
Create `azure-devops-source.mjs` in the meridianos-core root (alongside other source modules like `github-source.mjs`, `inbox-source.mjs`).

### Step 2: Implement core functions
```js
export async function pullWorkItems({ org, project, pat, query, config })
export async function getWorkItemDetail({ org, project, pat, id })
export async function updateWorkItem({ org, project, pat, id, patch })
export async function addWorkItemComment({ org, project, pat, id, comment })
export function mapAdoStateToAios(adoState)
export function adoTaskToAiosTask(adoItem, config)
```

### Step 3: Wire into scheduler
In `scheduler.mjs` (or a new `integrations.mjs` that the scheduler calls), add a sync call before the planner runs:
```js
if (policy.integrations?.azure_devops?.enabled) {
  await syncAzureDevOps({ policy, config });
}
```

### Step 4: Handle write-back
In `runner.mjs`'s `executeRun`, after a successful agent run that produces a PR, call `pushPrLink()` if the task originated from ADO.

### Key Files to Create/Modify
- `azure-devops-source.mjs` — new module
- `integrations.mjs` — new orchestrator (optional; could inline in scheduler)
- `scheduler.mjs` — add ADO sync before planner cycle
- `runner.mjs` — add PR write-back after successful run
- `mos-dev/.ai/policy.yaml` — add `integrations.azure_devops` config

### Do NOT
- Hardcode the PAT — always read from `process.env[pat_env]`
- Block the scheduler on ADO sync failure
- Overwrite ADO work item descriptions
- Make sync synchronous with the 60s tick (use async, don't await if > 5s)

---

## Deliverables

1. `azure-devops-source.mjs` — ADO connector module
2. Updated `scheduler.mjs` — ADO sync integration
3. Updated `runner.mjs` — PR write-back
4. Updated `mos-dev/.ai/policy.yaml` — ADO integration config
5. `tests/azure-devops-source.test.mjs` — unit + integration tests

---

*Feature spec version: 1.0 | Created: 2026-07-19 | Author: GitHub Copilot*
