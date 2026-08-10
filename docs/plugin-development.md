# Plugin Development Guide

MeridianOS has two plugin contracts:

- **IntakeSource** — imports tasks from an external system (Jira, Linear, a webhook, ...) into
  MeridianOS. This is the marketplace/community plugin contract this guide focuses on.
- **WireAdapter** — teaches the gateway how to recognize and meter a new LLM provider's wire
  protocol. Built into core (`gateway/wire-adapters/`), not community-installable today; documented
  briefly at the end for completeness.

**Current limitation, read before you build one**: installing, configuring, and test-connecting an
IntakeSource plugin from the dashboard's Marketplace panel all work end-to-end today. Automatically
pulling tasks from it into the board does not — nothing in production currently calls a plugin's
`fetchTasks()` on any schedule. Azure DevOps sync (`azure-devops-source.mjs`, built into core, not
a marketplace plugin) is the only source actually wired into the scheduler's automatic loop right
now. Build and test your plugin against the contract below; just don't expect tasks to appear on
the board without a manual trigger until this is wired up.

## Quick start

```bash
node cli.mjs plugin create
# Plugin name: my-source
# Plugin type (intake-source/wire-adapter) [intake-source]: intake-source
# Author: Your Name
```

This generates `my-source/` with `plugin.json`, `index.mjs`, `test.mjs`, and `README.md` from
`templates/plugin/`. Implement the 4 required methods in `index.mjs`, then:

```bash
cd my-source
node test.mjs                                    # contract validation
node ../cli.mjs plugin publish . <registryPath>   # publish + register in the community catalog
```

## The IntakeSource contract

Every plugin ships a `plugin.json`:

```json
{
  "name": "my-source",
  "version": "1.0.0",
  "type": "intake-source",
  "description": "...",
  "author": "...",
  "main": "index.mjs",
  "config_schema": {
    "api_token": { "type": "string", "required": true, "sensitive": true, "description": "..." }
  }
}
```

`config_schema` describes the fields a user fills in via the marketplace's "Configure" form.
Mark credentials `"sensitive": true` — the dashboard never displays sensitive fields back, and
`plugin-loader.mjs`'s `getPluginConfig()` omits them unless a caller explicitly asks for
`includeSensitive: true` (only when actually connecting to the external service).

`index.mjs` exports 4 required functions plus one optional one. Every function receives the
resolved `config` object (never read secrets from `process.env` — the static analyzer in
`plugin-loader.mjs` flags that as a violation, since config must come from the injected object):

| Function | Signature | Purpose |
|---|---|---|
| `fetchTasks` | `(config) => Promise<Task[]>` | Pull all tasks from the external system |
| `createTask` | `(task, config) => Promise<{externalId, url}>` | Create a task in the external system |
| `updateTask` | `(externalId, updates, config) => Promise<{success}>` | Update an existing task |
| `handleWebhook` | `(payload, config) => Promise<{action, externalId, task}>` | React to a push notification |
| `testConnection` *(optional)* | `(config) => Promise<{success, message, latency_ms?}>` | Powers the "Test Connection" button |

### The canonical Task shape

```ts
{
  externalId: string,      // this system's own id for the item
  title: string,
  body: string,
  status: 'todo' | 'in-progress' | 'done',
  priority: 'low' | 'medium' | 'high' | 'critical',
  tags: string[],
  url: string,              // link back to the item in the external system
  createdAt: number,        // unix ms
  updatedAt: number,        // unix ms
}
```

Map your system's own status/priority vocabulary onto these three status values and four
priority values — see `intake-adapters/jira-source.mjs` for a worked example (Jira's 6+ statuses
and 5 priorities collapsed onto this canonical set).

### handleWebhook's contract

Returns `{ action: 'created' | 'updated' | 'deleted', externalId, task }` — `task` is `null` when
`action === 'deleted'`. Throw a descriptive `Error` for any payload shape you don't recognize
rather than silently ignoring it; the marketplace surfaces thrown errors to the user.

### Error handling

Every method should throw a descriptive `Error`, not return a sentinel value, on failure:

```js
throw new Error('Jira API authentication failed: Invalid credentials');
throw new Error('Rate limit exceeded: Too many requests to Jira API');
```

## Security review before your plugin loads (FR-019)

Two checks run automatically, in order, whenever a plugin is loaded (`plugin-loader.mjs`):

1. **Static analysis** of your `index.mjs` SOURCE TEXT, before any code executes. Flagged
   patterns: `eval()`, the `Function` constructor, `require('child_process')`/`node:child_process`,
   `require('fs')`/`node:fs` (filesystem access), and direct `process.env` reads. A plugin that
   trips any of these is never imported.
2. **Contract validation** of the imported module — `fetchTasks`/`createTask`/`updateTask`/
   `handleWebhook` must all be functions, checked via `validateIntakeSourceContract()`.

This is **standard-tier security** (contract + basic static analysis), not a sandbox — once
loaded, a plugin runs in-process with full Node.js capability. Don't rely on the static analyzer
to catch anything beyond the common patterns above.

## Testing

`test.mjs` (generated from `templates/plugin/test.mjs.template`) checks that your 4 required
exports are functions and that `fetchTasks()`'s return values match the canonical Task shape.
Extend it with real assertions against a sandbox/test account — never a production one. Run it
directly: `node test.mjs`.

## Publishing

```bash
node cli.mjs plugin publish <pluginDir> <registryPath>
```

This runs `npm publish --access public` (your package becomes `@meridian-plugins/<name>` — make
sure you're logged in to the target npm registry first) and then registers the plugin's metadata
(name, type, description, author, version) in the community catalog
(`plugin-registry.mjs`'s `upsertPluginEntry`), where it appears in the dashboard's "Community
Plugins" tab (`dashboard/static/community-plugins.mjs`) for other users to install and rate.

## Auto-discovery

Once published (or copied manually), a plugin is auto-discovered from either:

- `node_modules/@meridian-plugins/intake-*/` (installed via npm)
- `.ai/plugins/<name>/` (dropped in manually, e.g. during local development)

`plugin-loader.mjs`'s `discoverPlugins(config)` scans both locations on demand; a plugin that
fails static analysis or contract validation is reported (not thrown) so one broken plugin never
blocks discovery of the others.

## Reference implementations

The 6 pre-built connectors in `intake-adapters/` are full worked examples against real external
APIs (Jira, Linear's GraphQL API, Notion, GitHub Issues, Microsoft Planner/Teams, and a
configurable generic-webhook receiver) — read the one closest to what you're building.

---

## Appendix: the WireAdapter contract

Not community-installable yet (auto-discovered only from `gateway/wire-adapters/` inside core),
but documented here since FR-018 asks for both contracts. A WireAdapter teaches the gateway to
recognize and meter one more LLM wire protocol:

```ts
{
  detectRequest(req): {wire: string, model: string, provider: string} | null,  // required
  extractUsage(parsedBody): {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens} | null,  // required
  injectAuth?(headers, resolveKey): void,
  extractUsageFromSSE?(event): Partial<UsageFields> | null,
  formatDenial?(capWindow): {status: number, body: object},
  normalizeModel?(model): string,
}
```

See `gateway/wire-adapter-registry.mjs` (the loader/validator) and `gateway/wire-adapters/{anthropic,openai,generic-http}.mjs` (reference implementations) for the full picture.
