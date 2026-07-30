# MCP Tool Contracts: IDE & Platform Traffic Integration

**Feature**: 004-ide-platform-integration | **Date**: 2026-07-30
**Protocol**: MCP (Model Context Protocol) version `2024-11-05` over stdio (JSON-RPC 2.0)

## Transport

- **Mechanism**: Standard input/output (stdio)
- **Message Format**: JSON-RPC 2.0, newline-delimited JSON
- **Launch**: Claude Code/Cowork launches `node mcp-server.mjs` as a child process

## Server Metadata

```json
{
  "name": "meridianos",
  "version": "1.0.0",
  "description": "MeridianOS task board, spend tracking, and budget management"
}
```

---

## Tool: meridian_list_tasks

List tasks from the MeridianOS board with optional filters.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["todo", "in-progress", "review", "done", "blocked"],
      "description": "Filter by task status"
    },
    "agent": {
      "type": "string",
      "description": "Filter by assigned agent name"
    },
    "category": {
      "type": "string",
      "description": "Filter by task category"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 20,
      "description": "Maximum number of tasks to return"
    }
  },
  "additionalProperties": false
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "status": { "type": "string" },
          "agent": { "type": "string" },
          "priority": { "type": "string" },
          "category": { "type": "string" },
          "createdAt": { "type": "string" }
        },
        "required": ["id", "title", "status"]
      }
    },
    "totalCount": { "type": "integer" },
    "filteredCount": { "type": "integer" }
  },
  "required": ["tasks", "totalCount"]
}
```

### Example

**Request**:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"meridian_list_tasks","arguments":{"status":"in-progress","limit":5}}}
```

**Response**:
```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Found 3 tasks in progress:\n1. [REVIEW] Fix auth middleware (builder) - high priority\n2. [IN-PROGRESS] Add provider wizard (builder) - high priority\n3. [IN-PROGRESS] Update docs (docs-writer) - medium priority"}]}}
```

---

## Tool: meridian_create_task

Create a new task on the MeridianOS board.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Task title"
    },
    "category": {
      "type": "string",
      "description": "Task category (e.g., feature, bug, chore, docs)"
    },
    "priority": {
      "type": "string",
      "enum": ["low", "medium", "high", "critical"],
      "default": "medium",
      "description": "Task priority"
    },
    "body": {
      "type": "string",
      "description": "Detailed task description or acceptance criteria"
    }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "taskId": { "type": "string" },
    "title": { "type": "string" },
    "status": { "type": "string" },
    "priority": { "type": "string" },
    "createdAt": { "type": "string" }
  },
  "required": ["taskId", "title", "status"]
}
```

### Example

**Request**:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"meridian_create_task","arguments":{"title":"Refactor the auth module","category":"feature","priority":"high","body":"The auth module needs to support subscription-based authentication"}}}
```

**Response**:
```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"Task created: #42 'Refactor the auth module' (high priority, status: todo)"}]}}
```

---

## Tool: meridian_get_spend

Query current AI spend from the gateway ledger.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "period": {
      "type": "string",
      "enum": ["session", "day", "week", "month"],
      "default": "week",
      "description": "Time period for spend query"
    }
  },
  "additionalProperties": false
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "period": { "type": "string" },
    "totalCostUsd": { "type": "number" },
    "totalTokens": { "type": "integer" },
    "byProvider": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "provider": { "type": "string" },
          "costUsd": { "type": "number" },
          "tokens": { "type": "integer" }
        }
      }
    },
    "bySource": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": { "type": "string" },
          "costUsd": { "type": "number" },
          "tokens": { "type": "integer" }
        }
      }
    }
  },
  "required": ["period", "totalCostUsd", "totalTokens"]
}
```

---

## Tool: meridian_get_budget

Check current budget status against configured caps.

### Input Schema

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "monthlyCapUsd": { "type": "number" },
    "currentSpendUsd": { "type": "number" },
    "percentUsed": { "type": "number" },
    "projectedOverageUsd": { "type": "number" },
    "daysUntilCap": { "type": "integer" },
    "status": {
      "type": "string",
      "enum": ["under_budget", "approaching_cap", "over_cap"]
    }
  },
  "required": ["monthlyCapUsd", "currentSpendUsd", "percentUsed", "status"]
}
```

### Example

**Request**:
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"meridian_get_budget","arguments":{}}}
```

**Response**:
```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Budget: $45.67 of $100.00 (45.7%). Projected to stay under cap with 23 days remaining. Status: under_budget."}]}}
```

---

## Tool: meridian_get_board_summary

Get a high-level summary of the MeridianOS task board.

### Input Schema

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### Output Schema

```json
{
  "type": "object",
  "properties": {
    "totalTasks": { "type": "integer" },
    "todo": { "type": "integer" },
    "inProgress": { "type": "integer" },
    "inReview": { "type": "integer" },
    "done": { "type": "integer" },
    "blocked": { "type": "integer" },
    "activeAgents": { "type": "integer" },
    "completedToday": { "type": "integer" }
  },
  "required": ["totalTasks", "todo", "inProgress", "inReview", "done"]
}
```

### Example

**Request**:
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"meridian_get_board_summary","arguments":{}}}
```

**Response**:
```json
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"Board Summary: 24 tasks (8 todo, 5 in progress, 3 in review, 7 done, 1 blocked). 4 active agents. 3 tasks completed today."}]}}
```

---

## Error Handling

All tools return errors in the standard JSON-RPC 2.0 error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid parameters",
    "data": {
      "validationErrors": [
        {"field": "title", "message": "Required field is missing"}
      ]
    }
  }
}
```

**Standard Error Codes**:
| Code | Meaning |
|------|---------|
| -32602 | Invalid params — validation failed |
| -32603 | Internal error — dashboard API unreachable or returned an error |
| -32601 | Method not found — unknown tool name |
| -32700 | Parse error — invalid JSON received |
