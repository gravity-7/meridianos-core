# REST API Contract v1

**Version**: 1.0.0
**Base URL**: `http://localhost:4317/api/v1`
**Authentication**: Bearer token (`Authorization: Bearer mk-{apiKey}`)
**Rate Limiting**: 100 requests/minute per API key

## Authentication

All endpoints require authentication via Bearer token in the `Authorization` header.

**Request Header**:
```
Authorization: Bearer mk-{apiKey}
```

**Scopes**:
- `tasks:read` - Read task data
- `tasks:write` - Create, update, delete tasks
- `costs:read` - Read cost and usage data
- `providers:read` - Read provider information
- `providers:write` - Manage providers
- `config:read` - Read configuration
- `config:write` - Update configuration

**Error Response** (401 Unauthorized):
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

**Error Response** (403 Forbidden):
```json
{
  "error": "Forbidden",
  "message": "API key lacks required scope: tasks:write"
}
```

**Error Response** (429 Too Many Requests):
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded",
  "retry_after": 45
}
```

## Endpoints

### Tasks

#### List Tasks

**GET** `/tasks`

**Scopes**: `tasks:read`

**Query Parameters**:
- `status` (optional): Filter by status (todo, in-progress, done)
- `source` (optional): Filter by source (agent, ide, cli, api)
- `limit` (optional): Maximum number of results (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Response** (200 OK):
```json
{
  "tasks": [
    {
      "id": "task-123",
      "title": "Implement feature X",
      "body": "Detailed description...",
      "status": "in-progress",
      "priority": "high",
      "source": "agent",
      "created_at": 1691234567,
      "updated_at": 1691234567,
      "tags": ["frontend", "p1"]
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

#### Create Task

**POST** `/tasks`

**Scopes**: `tasks:write`

**Request Body**:
```json
{
  "title": "Implement feature Y",
  "body": "Description...",
  "priority": "medium",
  "tags": ["backend"]
}
```

**Response** (201 Created):
```json
{
  "id": "task-124",
  "title": "Implement feature Y",
  "body": "Description...",
  "status": "todo",
  "priority": "medium",
  "source": "api",
  "created_at": 1691234568,
  "updated_at": 1691234568,
  "tags": ["backend"]
}
```

#### Get Task

**GET** `/tasks/{id}`

**Scopes**: `tasks:read`

**Response** (200 OK):
```json
{
  "id": "task-123",
  "title": "Implement feature X",
  "body": "Detailed description...",
  "status": "in-progress",
  "priority": "high",
  "source": "agent",
  "created_at": 1691234567,
  "updated_at": 1691234567,
  "tags": ["frontend", "p1"]
}
```

**Error Response** (404 Not Found):
```json
{
  "error": "Not Found",
  "message": "Task not found: task-123"
}
```

#### Update Task

**PATCH** `/tasks/{id}`

**Scopes**: `tasks:write`

**Request Body**:
```json
{
  "status": "done",
  "priority": "high"
}
```

**Response** (200 OK):
```json
{
  "id": "task-123",
  "title": "Implement feature X",
  "body": "Detailed description...",
  "status": "done",
  "priority": "high",
  "source": "agent",
  "created_at": 1691234567,
  "updated_at": 1691234569,
  "tags": ["frontend", "p1"]
}
```

#### Delete Task

**DELETE** `/tasks/{id}`

**Scopes**: `tasks:write`

**Response** (204 No Content)

---

### Costs

#### Query Costs

**GET** `/costs`

**Scopes**: `costs:read`

**Query Parameters**:
- `start_time` (optional): Unix timestamp (default: 24 hours ago)
- `end_time` (optional): Unix timestamp (default: now)
- `provider` (optional): Filter by provider name
- `model` (optional): Filter by model name
- `agent` (optional): Filter by agent name
- `source` (optional): Filter by source (agent, ide, cli, api)

**Response** (200 OK):
```json
{
  "costs": [
    {
      "timestamp": 1691234567,
      "provider": "anthropic",
      "model": "claude-sonnet-4",
      "agent": "meridian-build",
      "source": "agent",
      "tokens": 1234,
      "cost": 0.037
    }
  ],
  "total_tokens": 12345,
  "total_cost": 0.37,
  "count": 10
}
```

#### Get Cost Summary

**GET** `/costs/summary`

**Scopes**: `costs:read`

**Query Parameters**:
- `start_time` (optional): Unix timestamp (default: 30 days ago)
- `end_time` (optional): Unix timestamp (default: now)
- `group_by` (optional): Group by field (provider, model, agent, source, day)

**Response** (200 OK):
```json
{
  "summary": [
    {
      "provider": "anthropic",
      "total_tokens": 50000,
      "total_cost": 1.50,
      "request_count": 42
    },
    {
      "provider": "deepseek",
      "total_tokens": 30000,
      "total_cost": 0.15,
      "request_count": 28
    }
  ],
  "grand_total_tokens": 80000,
  "grand_total_cost": 1.65,
  "grand_total_requests": 70
}
```

---

### Providers

#### List Providers

**GET** `/providers`

**Scopes**: `providers:read`

**Response** (200 OK):
```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "enabled": true,
      "health": "healthy",
      "last_checked": 1691234567
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "enabled": true,
      "health": "healthy",
      "last_checked": 1691234567
    }
  ]
}
```

#### Create Provider

**POST** `/providers`

**Scopes**: `providers:write`

**Request Body**:
```json
{
  "id": "openai",
  "name": "OpenAI",
  "api_key_env": "OPENAI_API_KEY",
  "base_url": "https://api.openai.com/v1"
}
```

**Response** (201 Created):
```json
{
  "id": "openai",
  "name": "OpenAI",
  "enabled": true,
  "health": "unknown",
  "last_checked": null
}
```

#### Get Provider

**GET** `/providers/{id}`

**Scopes**: `providers:read`

**Response** (200 OK):
```json
{
  "id": "anthropic",
  "name": "Anthropic",
  "enabled": true,
  "health": "healthy",
  "last_checked": 1691234567,
  "models": [
    {
      "id": "claude-sonnet-4",
      "name": "Claude Sonnet 4",
      "tier": "premium",
      "enabled": true
    }
  ]
}
```

#### Delete Provider

**DELETE** `/providers/{id}`

**Scopes**: `providers:write`

**Response** (204 No Content)

#### Test Provider Connection

**POST** `/providers/{id}/test`

**Scopes**: `providers:write`

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Connection successful",
  "latency_ms": 234
}
```

---

### Models

#### List Models

**GET** `/models`

**Scopes**: `providers:read`

**Query Parameters**:
- `provider` (optional): Filter by provider

**Response** (200 OK):
```json
{
  "models": [
    {
      "id": "claude-sonnet-4",
      "provider": "anthropic",
      "name": "Claude Sonnet 4",
      "tier": "premium",
      "enabled": true,
      "context_window": 200000,
      "pricing": {
        "input": 0.003,
        "output": 0.015
      }
    }
  ]
}
```

#### Refresh Models

**POST** `/models/refresh`

**Scopes**: `providers:write`

**Response** (200 OK):
```json
{
  "message": "Models refreshed successfully",
  "refreshed_at": 1691234567,
  "count": 15
}
```

#### Update Model Tier

**PUT** `/models/{id}/tier`

**Scopes**: `providers:write`

**Request Body**:
```json
{
  "tier": "standard"
}
```

**Response** (200 OK):
```json
{
  "id": "claude-sonnet-4",
  "tier": "standard",
  "updated_at": 1691234567
}
```

---

### Configuration

#### Get Configuration

**GET** `/config`

**Scopes**: `config:read`

**Response** (200 OK):
```json
{
  "gateway": {
    "port": 4317,
    "disabled": false
  },
  "budget": {
    "monthly_limit": 100.00,
    "current_spend": 37.50,
    "warning_threshold": 0.8,
    "critical_threshold": 1.0
  },
  "providers": {
    "anthropic": {
      "enabled": true
    }
  }
}
```

#### Update Configuration

**PUT** `/config`

**Scopes**: `config:write`

**Request Body**:
```json
{
  "budget": {
    "monthly_limit": 150.00
  }
}
```

**Response** (200 OK):
```json
{
  "message": "Configuration updated successfully",
  "updated_at": 1691234567
}
```

---

### Webhooks

#### List Webhooks

**GET** `/webhooks`

**Scopes**: `config:read`

**Response** (200 OK):
```json
{
  "webhooks": [
    {
      "id": "webhook-123",
      "url": "https://example.com/webhook",
      "events": ["task.created", "task.completed"],
      "is_active": true,
      "created_at": 1691234567,
      "last_delivery_at": 1691234568,
      "failure_count": 0
    }
  ]
}
```

#### Create Webhook

**POST** `/webhooks`

**Scopes**: `config:write`

**Request Body**:
```json
{
  "url": "https://example.com/webhook",
  "events": ["task.created", "task.failed"],
  "secret": "optional-hmac-secret"
}
```

**Response** (201 Created):
```json
{
  "id": "webhook-124",
  "url": "https://example.com/webhook",
  "events": ["task.created", "task.failed"],
  "is_active": true,
  "created_at": 1691234567
}
```

#### Delete Webhook

**DELETE** `/webhooks/{id}`

**Scopes**: `config:write`

**Response** (204 No Content)

---

## Webhook Event Payloads

### task.created

```json
{
  "event": "task.created",
  "timestamp": 1691234567,
  "data": {
    "id": "task-123",
    "title": "Implement feature X",
    "status": "todo",
    "priority": "high",
    "source": "agent"
  }
}
```

### task.completed

```json
{
  "event": "task.completed",
  "timestamp": 1691234567,
  "data": {
    "id": "task-123",
    "title": "Implement feature X",
    "status": "done",
    "duration_seconds": 3600
  }
}
```

### task.failed

```json
{
  "event": "task.failed",
  "timestamp": 1691234567,
  "data": {
    "id": "task-123",
    "title": "Implement feature X",
    "error": "Provider timeout",
    "retry_count": 3
  }
}
```

### budget.warning

```json
{
  "event": "budget.warning",
  "timestamp": 1691234567,
  "data": {
    "monthly_limit": 100.00,
    "current_spend": 85.00,
    "percentage": 0.85
  }
}
```

### budget.critical

```json
{
  "event": "budget.critical",
  "timestamp": 1691234567,
  "data": {
    "monthly_limit": 100.00,
    "current_spend": 100.50,
    "percentage": 1.005
  }
}
```

### provider.error

```json
{
  "event": "provider.error",
  "timestamp": 1691234567,
  "data": {
    "provider": "anthropic",
    "error": "Rate limit exceeded",
    "affected_requests": 5
  }
}
```

### model.deprecated

```json
{
  "event": "model.deprecated",
  "timestamp": 1691234567,
  "data": {
    "provider": "anthropic",
    "model": "claude-instant-1.2",
    "deprecation_date": "2026-09-01",
    "replacement": "claude-haiku-3.5"
  }
}
```

### cost.spike

```json
{
  "event": "cost.spike",
  "timestamp": 1691234567,
  "data": {
    "threshold": 10.00,
    "actual": 25.00,
    "period_minutes": 60,
    "provider": "anthropic"
  }
}
```

---

## OpenAPI Specification

The complete OpenAPI 3.0 specification is available at:
- `/api/v1/openapi.yaml` - Raw YAML specification
- `/api/v1/docs` - Interactive Swagger UI documentation

---

## Common Error Responses

### 400 Bad Request

```json
{
  "error": "Bad Request",
  "message": "Invalid request body: missing required field 'title'"
}
```

### 404 Not Found

```json
{
  "error": "Not Found",
  "message": "Resource not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred"
}
```

---

## Rate Limiting

- **Limit**: 100 requests per minute per API key
- **Window**: Sliding window (60 seconds)
- **Response Headers**:
  - `X-RateLimit-Limit`: 100
  - `X-RateLimit-Remaining`: 95
  - `X-RateLimit-Reset`: 1691234627
- **Retry-After**: Seconds until next request allowed (returned on 429)