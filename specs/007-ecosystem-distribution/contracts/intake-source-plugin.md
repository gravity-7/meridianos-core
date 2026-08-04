# IntakeSource Plugin Contract

**Version**: 1.0.0
**Purpose**: Define the interface for intake source plugins that import tasks from external systems

## Overview

IntakeSource plugins enable MeridianOS to import tasks from external systems like Jira, Linear, Notion, GitHub Issues, and Microsoft Teams. Plugins implement a standardized contract for fetching, creating, updating tasks, and handling webhook notifications.

## Plugin Metadata

Every plugin must include a `plugin.json` file in its root directory:

```json
{
  "name": "jira-source",
  "version": "1.0.0",
  "type": "intake-source",
  "description": "Import tasks from Jira Cloud/Server",
  "author": "MeridianOS Team",
  "main": "index.mjs",
  "config_schema": {
    "url": {
      "type": "string",
      "required": true,
      "description": "Jira base URL (e.g., https://your-domain.atlassian.net)"
    },
    "api_token": {
      "type": "string",
      "required": true,
      "sensitive": true,
      "description": "Jira API token"
    },
    "email": {
      "type": "string",
      "required": true,
      "description": "Jira account email"
    },
    "project_key": {
      "type": "string",
      "required": true,
      "description": "Jira project key (e.g., PROJ)"
    }
  }
}
```

## Interface Contract

### Required Methods

#### fetchTasks()

Fetch all tasks from the external system.

**Signature**:
```javascript
async fetchTasks(config)
```

**Parameters**:
- `config` (Object): Plugin configuration from `plugin.json` schema

**Returns**:
```javascript
Promise<Array<{
  externalId: string,      // Unique identifier in external system
  title: string,            // Task title
  body: string,             // Task description/body
  status: string,           // Task status (todo, in-progress, done)
  priority: string,         // Task priority (low, medium, high, critical)
  tags: Array<string>,      // Task tags/labels
  url: string,              // URL to view task in external system
  createdAt: number,        // Unix timestamp
  updatedAt: number         // Unix timestamp
}>>
```

**Throws**:
- `Error` with descriptive message if fetch fails

**Example**:
```javascript
export async function fetchTasks(config) {
  const response = await fetch(`${config.url}/rest/api/3/search?jql=project=${config.project_key}`, {
    headers: {
      'Authorization': `Basic ${btoa(`${config.email}:${config.api_token}`)}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Jira API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  return data.issues.map(issue => ({
    externalId: issue.id,
    title: issue.fields.summary,
    body: issue.fields.description || '',
    status: mapJiraStatus(issue.fields.status.name),
    priority: mapJiraPriority(issue.fields.priority.name),
    tags: issue.fields.labels || [],
    url: `${config.url}/browse/${issue.key}`,
    createdAt: new Date(issue.fields.created).getTime(),
    updatedAt: new Date(issue.fields.updated).getTime()
  }));
}
```

---

#### createTask(task)

Create a new task in the external system.

**Signature**:
```javascript
async createTask(task, config)
```

**Parameters**:
- `task` (Object): Task to create
  - `title` (string): Task title
  - `body` (string): Task description
  - `priority` (string): Task priority
  - `tags` (Array<string>): Task tags
- `config` (Object): Plugin configuration

**Returns**:
```javascript
Promise<{
  externalId: string,      // Created task's external ID
  url: string              // URL to view created task
}>
```

**Throws**:
- `Error` with descriptive message if creation fails

**Example**:
```javascript
export async function createTask(task, config) {
  const response = await fetch(`${config.url}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${config.email}:${config.api_token}`)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        project: { key: config.project_key },
        summary: task.title,
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ text: task.body }] }] },
        priority: { name: mapPriorityToJira(task.priority) },
        labels: task.tags
      }
    })
  });
  
  if (!response.ok) {
    throw new Error(`Jira API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  return {
    externalId: data.id,
    url: `${config.url}/browse/${data.key}`
  };
}
```

---

#### updateTask(externalId, updates)

Update an existing task in the external system.

**Signature**:
```javascript
async updateTask(externalId, updates, config)
```

**Parameters**:
- `externalId` (string): External task ID to update
- `updates` (Object): Fields to update
  - `title` (string, optional): New title
  - `body` (string, optional): New description
  - `status` (string, optional): New status
  - `priority` (string, optional): New priority
  - `tags` (Array<string>, optional): New tags
- `config` (Object): Plugin configuration

**Returns**:
```javascript
Promise<{
  success: boolean
}>
```

**Throws**:
- `Error` with descriptive message if update fails

**Example**:
```javascript
export async function updateTask(externalId, updates, config) {
  const fields = {};
  
  if (updates.title) fields.summary = updates.title;
  if (updates.body) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ text: updates.body }] }] };
  if (updates.status) fields.status = { name: mapStatusToJira(updates.status) };
  if (updates.priority) fields.priority = { name: mapPriorityToJira(updates.priority) };
  if (updates.tags) fields.labels = updates.tags;
  
  const response = await fetch(`${config.url}/rest/api/3/issue/${externalId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${btoa(`${config.email}:${config.api_token}`)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (!response.ok) {
    throw new Error(`Jira API error: ${response.status}`);
  }
  
  return { success: true };
}
```

---

#### handleWebhook(payload)

Handle webhook notification from external system.

**Signature**:
```javascript
async handleWebhook(payload, config)
```

**Parameters**:
- `payload` (Object): Webhook payload from external system
- `config` (Object): Plugin configuration

**Returns**:
```javascript
Promise<{
  action: string,          // 'created', 'updated', 'deleted'
  externalId: string,      // Affected task's external ID
  task: Object | null      // Task data (null if deleted)
}>
```

**Throws**:
- `Error` with descriptive message if webhook processing fails

**Example**:
```javascript
export async function handleWebhook(payload, config) {
  const issue = payload.issue;
  
  if (payload.webhookEvent === 'jira:issue_created') {
    return {
      action: 'created',
      externalId: issue.id,
      task: {
        externalId: issue.id,
        title: issue.fields.summary,
        body: issue.fields.description || '',
        status: mapJiraStatus(issue.fields.status.name),
        priority: mapJiraPriority(issue.fields.priority.name),
        tags: issue.fields.labels || [],
        url: `${config.url}/browse/${issue.key}`,
        createdAt: new Date(issue.fields.created).getTime(),
        updatedAt: new Date(issue.fields.updated).getTime()
      }
    };
  }
  
  if (payload.webhookEvent === 'jira:issue_updated') {
    return {
      action: 'updated',
      externalId: issue.id,
      task: {
        externalId: issue.id,
        title: issue.fields.summary,
        body: issue.fields.description || '',
        status: mapJiraStatus(issue.fields.status.name),
        priority: mapJiraPriority(issue.fields.priority.name),
        tags: issue.fields.labels || [],
        url: `${config.url}/browse/${issue.key}`,
        createdAt: new Date(issue.fields.created).getTime(),
        updatedAt: new Date(issue.fields.updated).getTime()
      }
    };
  }
  
  if (payload.webhookEvent === 'jira:issue_deleted') {
    return {
      action: 'deleted',
      externalId: issue.id,
      task: null
    };
  }
  
  throw new Error(`Unknown webhook event: ${payload.webhookEvent}`);
}
```

---

## Optional Methods

#### testConnection(config)

Test connection to external system.

**Signature**:
```javascript
async testConnection(config)
```

**Parameters**:
- `config` (Object): Plugin configuration

**Returns**:
```javascript
Promise<{
  success: boolean,
  message: string,
  latency_ms?: number
}>
```

**Example**:
```javascript
export async function testConnection(config) {
  const start = Date.now();
  
  try {
    const response = await fetch(`${config.url}/rest/api/3/myself`, {
      headers: {
        'Authorization': `Basic ${btoa(`${config.email}:${config.api_token}`)}`,
        'Accept': 'application/json'
      }
    });
    
    const latency = Date.now() - start;
    
    if (!response.ok) {
      return {
        success: false,
        message: `Authentication failed: ${response.status}`,
        latency_ms: latency
      };
    }
    
    return {
      success: true,
      message: 'Connection successful',
      latency_ms: latency
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}
```

---

## Status Mapping

Plugins must map external system statuses to MeridianOS canonical statuses:

- `todo` - Task not started
- `in-progress` - Task actively being worked on
- `done` - Task completed

**Example**:
```javascript
function mapJiraStatus(jiraStatus) {
  const statusMap = {
    'To Do': 'todo',
    'In Progress': 'in-progress',
    'Done': 'done',
    'Backlog': 'todo',
    'Selected for Development': 'todo',
    'In Review': 'in-progress'
  };
  
  return statusMap[jiraStatus] || 'todo';
}
```

---

## Priority Mapping

Plugins must map external system priorities to MeridianOS canonical priorities:

- `low` - Low priority
- `medium` - Medium priority
- `high` - High priority
- `critical` - Critical priority

**Example**:
```javascript
function mapJiraPriority(jiraPriority) {
  const priorityMap = {
    'Lowest': 'low',
    'Low': 'low',
    'Medium': 'medium',
    'High': 'high',
    'Highest': 'critical'
  };
  
  return priorityMap[jiraPriority] || 'medium';
}
```

---

## Error Handling

All methods must throw descriptive `Error` objects:

```javascript
throw new Error('Jira API authentication failed: Invalid credentials');
throw new Error('Network timeout: Could not reach Jira API');
throw new Error('Rate limit exceeded: Too many requests to Jira API');
```

---

## Security Considerations

### Sensitive Configuration
- Mark sensitive fields in `config_schema` with `"sensitive": true`
- Never log sensitive configuration values
- Store sensitive values encrypted in OS keychain (Electron app)

### Network Security
- Use HTTPS for all external API calls
- Validate SSL certificates
- Implement request timeouts (default: 30 seconds)

### Input Validation
- Validate all configuration values before use
- Sanitize user-provided data before sending to external APIs
- Handle malformed responses gracefully

---

## Testing

Plugins must include a `test.mjs` file with contract validation tests:

```javascript
import assert from 'node:assert';
import { fetchTasks, createTask, updateTask, handleWebhook } from './index.mjs';

// Test contract compliance
assert(typeof fetchTasks === 'function', 'fetchTasks must be a function');
assert(typeof createTask === 'function', 'createTask must be a function');
assert(typeof updateTask === 'function', 'updateTask must be a function');
assert(typeof handleWebhook === 'function', 'handleWebhook must be a function');

// Test return types
const mockConfig = { url: 'https://test.atlassian.net', api_token: 'test', email: 'test@test.com', project_key: 'TEST' };

// Test fetchTasks returns correct structure
const tasks = await fetchTasks(mockConfig);
assert(Array.isArray(tasks), 'fetchTasks must return array');
if (tasks.length > 0) {
  const task = tasks[0];
  assert(typeof task.externalId === 'string', 'task.externalId must be string');
  assert(typeof task.title === 'string', 'task.title must be string');
  assert(['todo', 'in-progress', 'done'].includes(task.status), 'task.status must be valid');
}

console.log('All contract tests passed');
```

---

## Plugin Discovery

Plugins are auto-discovered from:
- `node_modules/@meridian-plugins/intake-*/`
- `.ai/plugins/`

Plugins must implement the IntakeSource contract to be loaded successfully.