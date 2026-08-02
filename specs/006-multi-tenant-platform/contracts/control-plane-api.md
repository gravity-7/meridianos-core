# Control Plane API Contract

**Feature**: Multi-Tenant Platform  
**Date**: 2026-08-01  
**Version**: 1.0

## Overview

This document defines the HTTP API contract for the control plane, which manages multiple MeridianOS projects. All endpoints require authentication unless explicitly marked as public.

---

## Base URL

```
http://localhost:4317/api/projects
```

---

## Project Management

### 1. List Projects

**Endpoint**: `GET /`

**Description**: List all projects accessible to the current user.

**Request**:
```http
GET /api/projects/
Authorization: Bearer {token}
```

**Query Parameters**:
- `status`: Filter by status (`running`, `stopped`, `error`, `restarting`)
- `health`: Filter by health status (`healthy`, `degraded`, `down`, `unknown`)

**Response** (200 OK):
```json
{
  "success": true,
  "projects": [
    {
      "id": "proj-abcdef123456",
      "name": "My SaaS App",
      "status": "running",
      "health_status": "healthy",
      "agent_count": 3,
      "task_count": 15,
      "current_spend_usd": 42.50,
      "port": 4318,
      "created_at": 1722000000,
      "template": "saas-web-app"
    }
  ]
}
```

---

### 2. Create Project

**Endpoint**: `POST /`

**Description**: Create a new project from a template or custom configuration.

**Request**:
```http
POST /api/projects/
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "name": "New Project",
  "template": "saas-web-app",
  "config": {
    "agents": [...],
    "categories": [...],
    "model_routing": {...}
  }
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "project": {
    "id": "proj-ghijkl789012",
    "name": "New Project",
    "status": "stopped",
    "port": 4319,
    "created_at": 1722460800,
    "template": "saas-web-app"
  }
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Project name already exists"
}
```

---

### 3. Get Project Details

**Endpoint**: `GET /{project_id}`

**Description**: Get detailed information about a specific project.

**Request**:
```http
GET /api/projects/proj-abcdef123456
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "project": {
    "id": "proj-abcdef123456",
    "name": "My SaaS App",
    "status": "running",
    "health_status": "healthy",
    "agent_count": 3,
    "task_count": 15,
    "current_spend_usd": 42.50,
    "port": 4318,
    "created_at": 1722000000,
    "created_by": "usr-1234567890abcdef",
    "template": "saas-web-app",
    "last_health_check": 1722460800,
    "restart_count": 0,
    "config": {
      "agents": [...],
      "categories": [...]
    }
  }
}
```

**Response** (404 Not Found):
```json
{
  "success": false,
  "error": "Project not found"
}
```

---

### 4. Start Project

**Endpoint**: `POST /{project_id}/start`

**Description**: Start a stopped project.

**Request**:
```http
POST /api/projects/proj-abcdef123456/start
Authorization: Bearer {operator_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Project starting",
  "project": {
    "id": "proj-abcdef123456",
    "status": "restarting"
  }
}
```

**Response** (409 Conflict):
```json
{
  "success": false,
  "error": "Project is already running"
}
```

---

### 5. Stop Project

**Endpoint**: `POST /{project_id}/stop`

**Description**: Stop a running project.

**Request**:
```http
POST /api/projects/proj-abcdef123456/stop
Authorization: Bearer {operator_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Project stopping",
  "project": {
    "id": "proj-abcdef123456",
    "status": "stopped"
  }
}
```

**Response** (409 Conflict):
```json
{
  "success": false,
  "error": "Project is already stopped"
}
```

---

### 6. Restart Project

**Endpoint**: `POST /{project_id}/restart`

**Description**: Restart a running or stopped project.

**Request**:
```http
POST /api/projects/proj-abcdef123456/restart
Authorization: Bearer {operator_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Project restarting",
  "project": {
    "id": "proj-abcdef123456",
    "status": "restarting"
  }
}
```

---

### 7. Delete Project

**Endpoint**: `DELETE /{project_id}`

**Description**: Delete a project and all its data.

**Request**:
```http
DELETE /api/projects/proj-abcdef123456
Authorization: Bearer {admin_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Project deleted successfully"
}
```

**Response** (409 Conflict):
```json
{
  "success": false,
  "error": "Cannot delete running project. Stop it first."
}
```

---

### 8. Get Project Health

**Endpoint**: `GET /{project_id}/health`

**Description**: Get real-time health status of a project.

**Request**:
```http
GET /api/projects/proj-abcdef123456/health
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "health": {
    "status": "healthy",
    "uptime_seconds": 86400,
    "cpu_usage_percent": 15.2,
    "memory_usage_mb": 256,
    "disk_usage_mb": 512,
    "last_check": 1722460800,
    "checks": {
      "dashboard": "ok",
      "daemon": "ok",
      "gateway": "ok"
    }
  }
}
```

---

## Project Configuration

### 9. Get Project Configuration

**Endpoint**: `GET /{project_id}/config`

**Description**: Get the policy.yaml configuration for a project.

**Request**:
```http
GET /api/projects/proj-abcdef123456/config
Authorization: Bearer {operator_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "config": {
    "board": {
      "title": "My SaaS App",
      "cadence_interval": 60
    },
    "agents": [...],
    "model_routing": {...},
    "budget": {...}
  }
}
```

---

### 10. Update Project Configuration

**Endpoint**: `PUT /{project_id}/config`

**Description**: Update the policy.yaml configuration for a project.

**Request**:
```http
PUT /api/projects/proj-abcdef123456/config
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "board": {
    "title": "Updated Title"
  },
  "budget": {
    "monthly_usd": 200
  }
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Configuration updated",
  "backup_path": ".ai/projects/proj-abcdef123456/config.backup.1722460800.yaml"
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Invalid configuration: budget.monthly_usd must be positive"
}
```

---

## Project Members

### 11. List Project Members

**Endpoint**: `GET /{project_id}/members`

**Description**: List all users with access to a project.

**Request**:
```http
GET /api/projects/proj-abcdef123456/members
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "members": [
    {
      "user_id": "usr-1234567890abcdef",
      "email": "admin@example.com",
      "full_name": "Admin User",
      "role": "admin",
      "joined_at": 1722000000
    },
    {
      "user_id": "usr-0987654321fedcba",
      "email": "operator@example.com",
      "full_name": "Operator User",
      "role": "operator",
      "joined_at": 1722100000
    }
  ]
}
```

---

### 12. Add Project Member

**Endpoint**: `POST /{project_id}/members`

**Description**: Add a user to a project with a specific role.

**Request**:
```http
POST /api/projects/proj-abcdef123456/members
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "user_id": "usr-0987654321fedcba",
  "role": "operator"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "member": {
    "user_id": "usr-0987654321fedcba",
    "email": "operator@example.com",
    "role": "operator",
    "joined_at": 1722460800
  }
}
```

**Response** (409 Conflict):
```json
{
  "success": false,
  "error": "User is already a member of this project"
}
```

---

### 13. Update Member Role

**Endpoint**: `PUT /{project_id}/members/{user_id}`

**Description**: Update a member's role in a project.

**Request**:
```http
PUT /api/projects/proj-abcdef123456/members/usr-0987654321fedcba
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "role": "admin"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "member": {
    "user_id": "usr-0987654321fedcba",
    "role": "admin"
  }
}
```

---

### 14. Remove Project Member

**Endpoint**: `DELETE /{project_id}/members/{user_id}`

**Description**: Remove a user from a project.

**Request**:
```http
DELETE /api/projects/proj-abcdef123456/members/usr-0987654321fedcba
Authorization: Bearer {admin_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

---

## Project Templates

### 15. List Templates

**Endpoint**: `GET /templates`

**Description**: List all available project templates.

**Request**:
```http
GET /api/projects/templates
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "templates": [
    {
      "id": "saas-web-app",
      "name": "SaaS Web App",
      "description": "Full-stack web application with React frontend and Node.js backend",
      "agent_count": 3,
      "category_count": 7
    },
    {
      "id": "mobile-app",
      "name": "Mobile App",
      "description": "React Native mobile application with iOS and Android support",
      "agent_count": 3,
      "category_count": 6
    }
  ]
}
```

---

### 16. Get Template Details

**Endpoint**: `GET /templates/{template_id}`

**Description**: Get detailed configuration for a specific template.

**Request**:
```http
GET /api/projects/templates/saas-web-app
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "template": {
    "id": "saas-web-app",
    "name": "SaaS Web App",
    "description": "Full-stack web application with React frontend and Node.js backend",
    "agents": [
      {
        "name": "builder",
        "harness": "claude-code",
        "default_tier": "medium"
      }
    ],
    "categories": ["feature", "bug-fix", "refactor", "ui-design"],
    "model_routing": {...}
  }
}
```

---

## Activity Feed

### 17. Get Project Activity

**Endpoint**: `GET /{project_id}/activity`

**Description**: Get activity feed for a project.

**Request**:
```http
GET /api/projects/proj-abcdef123456/activity?limit=20&offset=0
Authorization: Bearer {token}
```

**Query Parameters**:
- `limit`: Number of events to return (default: 20, max: 100)
- `offset`: Pagination offset (default: 0)
- `action`: Filter by action type

**Response** (200 OK):
```json
{
  "success": true,
  "activity": [
    {
      "id": "act-1234567890abcdef",
      "timestamp": 1722460800,
      "user": {
        "id": "usr-1234567890abcdef",
        "email": "admin@example.com",
        "full_name": "Admin User"
      },
      "action": "task.completed",
      "target_type": "task",
      "target_id": "task-123456",
      "detail": {
        "task_title": "Implement user authentication",
        "agent": "builder"
      }
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `PROJECT_NOT_FOUND` | Project does not exist |
| `PROJECT_ALREADY_EXISTS` | Project name already exists |
| `PROJECT_INVALID_STATE` | Invalid state transition |
| `PROJECT_CANNOT_DELETE_RUNNING` | Cannot delete running project |
| `PROJECT_CONFIG_INVALID` | Configuration validation failed |
| `MEMBER_NOT_FOUND` | User is not a member of this project |
| `MEMBER_ALREADY_EXISTS` | User is already a member |
| `TEMPLATE_NOT_FOUND` | Template does not exist |
| `INSUFFICIENT_PERMISSIONS` | User lacks required role/permissions |

---

## Rate Limiting

- Project creation: 5 projects per admin per day
- Configuration updates: 10 updates per project per hour
- Member additions: 20 members per project per day
- Activity feed queries: 60 queries per user per minute

---

## Summary

The control plane API provides comprehensive project management capabilities including lifecycle control (start/stop/restart/delete), configuration management, team collaboration, and activity tracking. All endpoints require authentication and enforce role-based access control. The API follows REST conventions and returns consistent JSON responses.