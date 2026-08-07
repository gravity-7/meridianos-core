# MeridianOS Multi-Tenant Platform API Documentation

**Version**: 1.0.0  
**Last Updated**: 2026-08-02  
**Base URL**: `http://localhost:4317/api`

## Table of Contents

1. [Authentication](#authentication)
2. [Project Management](#project-management)
3. [Team Collaboration](#team-collaboration)
4. [Billing](#billing)
5. [Compliance Reporting](#compliance-reporting)
6. [OAuth SSO](#oauth-sso)
7. [Error Responses](#error-responses)

---

## Authentication

### POST /api/auth/login
Authenticate with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "admin"
  }
}
```

**Error (401 Unauthorized):**
```json
{
  "error": "Invalid credentials"
}
```

### GET /api/auth/me
Get current user information.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "admin"
  }
}
```

### POST /api/auth/refresh
Refresh JWT token.

**Request Body:**
```json
{
  "token": "expired-jwt-token"
}
```

**Response (200 OK):**
```json
{
  "token": "new-jwt-token"
}
```

### POST /api/auth/logout
Logout and invalidate token.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

### POST /api/auth/users
Create a new user (admin only).

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "securepassword",
  "name": "New User",
  "role": "operator"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "newuser@example.com",
    "name": "New User",
    "role": "operator"
  }
}
```

---

## Project Management

### GET /api/projects
List all projects with optional filters.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `status`: Filter by status (running, stopped, error)
- `limit`: Maximum number of results (default: 50)
- `offset`: Number of results to skip (default: 0)

**Response (200 OK):**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "My Project",
      "status": "running",
      "created_at": "2026-08-01T10:00:00Z",
      "health": {
        "status": "healthy",
        "latency_ms": 45,
        "last_check": "2026-08-02T10:00:00Z"
      }
    }
  ],
  "total": 1
}
```

### POST /api/projects
Create a new project from a template.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "My Project",
  "template": "saas-web-app",
  "config": {
    "agent_count": 3
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "project": {
    "id": "uuid",
    "name": "My Project",
    "status": "stopped",
    "created_at": "2026-08-02T10:00:00Z"
  }
}
```

### GET /api/projects/{id}
Get project details.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "project": {
    "id": "uuid",
    "name": "My Project",
    "status": "running",
    "created_at": "2026-08-01T10:00:00Z",
    "config": {
      "agents": ["builder", "reviewer", "designer"]
    },
    "health": {
      "status": "healthy",
      "latency_ms": 45,
      "last_check": "2026-08-02T10:00:00Z"
    }
  }
}
```

### POST /api/projects/{id}/start
Start a project.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Project started successfully"
}
```

### POST /api/projects/{id}/stop
Stop a project.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Project stopped successfully"
}
```

### POST /api/projects/{id}/restart
Restart a project.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Project restarted successfully"
}
```

### DELETE /api/projects/{id}
Delete a project.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Project deleted successfully"
}
```

### GET /api/projects/{id}/health
Get project health status.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "health": {
    "status": "healthy",
    "latency_ms": 45,
    "last_check": "2026-08-02T10:00:00Z",
    "cpu_usage": 23.5,
    "memory_usage_mb": 512,
    "disk_usage_mb": 1024
  }
}
```

### GET /api/projects/templates
List available project templates.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "templates": [
    {
      "id": "saas-web-app",
      "name": "SaaS Web App",
      "description": "3 agents for building, reviewing, and designing SaaS applications",
      "agent_count": 3,
      "category_count": 10
    },
    {
      "id": "mobile-app",
      "name": "Mobile App",
      "description": "React Native development template",
      "agent_count": 3,
      "category_count": 8
    }
  ]
}
```

### GET /api/projects/templates/{id}
Get template details.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "template": {
    "id": "saas-web-app",
    "name": "SaaS Web App",
    "description": "3 agents for building, reviewing, and designing SaaS applications",
    "agents": ["builder", "reviewer", "designer"],
    "categories": ["frontend", "backend", "testing", "deployment", "documentation", "security", "performance"]
  }
}
```

---

## Team Collaboration

### POST /api/auth/invitations
Create a team invitation.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "email": "colleague@example.com",
  "role": "operator",
  "project_id": "uuid"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "invitation": {
    "id": "uuid",
    "email": "colleague@example.com",
    "role": "operator",
    "token": "invitation-token",
    "expires_at": "2026-08-16T10:00:00Z"
  }
}
```

### POST /api/auth/invitations/{token}/accept
Accept an invitation.

**Request Body:**
```json
{
  "password": "newpassword"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "colleague@example.com",
    "name": "Colleague Name",
    "role": "operator"
  }
}
```

### GET /api/projects/{id}/members
List project members.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "members": [
    {
      "id": "uuid",
      "email": "user1@example.com",
      "name": "User One",
      "role": "admin",
      "joined_at": "2026-08-01T10:00:00Z"
    },
    {
      "id": "uuid",
      "email": "user2@example.com",
      "name": "User Two",
      "role": "operator",
      "joined_at": "2026-08-02T10:00:00Z"
    }
  ]
}
```

### POST /api/projects/{id}/members
Add a member to a project.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "user_id": "uuid",
  "role": "operator"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "member": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "operator",
    "joined_at": "2026-08-02T10:00:00Z"
  }
}
```

### PUT /api/projects/{id}/members/{user_id}
Update member role.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Request Body:**
```json
{
  "role": "viewer"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "member": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "viewer",
    "updated_at": "2026-08-02T10:00:00Z"
  }
}
```

### DELETE /api/projects/{id}/members/{user_id}
Remove a member from a project.

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

### GET /api/projects/{id}/activity
Get project activity feed.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `limit`: Maximum number of results (default: 50)
- `offset`: Number of results to skip (default: 0)

**Response (200 OK):**
```json
{
  "activities": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "user_name": "John Doe",
      "action": "task_completed",
      "target": "Task #123",
      "timestamp": "2026-08-02T10:00:00Z"
    },
    {
      "id": "uuid",
      "user_id": "uuid",
      "user_name": "Jane Smith",
      "action": "config_modified",
      "target": "Agent configuration",
      "timestamp": "2026-08-02T09:30:00Z"
    }
  ],
  "total": 2
}
```

### POST /api/projects/{id}/tasks/{task_id}/comments
Add a comment to a task.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "content": "This looks good!"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "comment": {
    "id": "uuid",
    "task_id": "uuid",
    "user_id": "uuid",
    "user_name": "John Doe",
    "content": "This looks good!",
    "created_at": "2026-08-02T10:00:00Z"
  }
}
```

---

## Billing

### GET /api/billing/license
Get license status.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "license": {
    "tier": "pro",
    "customer_id": "cus_1234567890",
    "features": ["unlimited_agents", "priority_support", "advanced_analytics"],
    "expires_at": "2026-12-31T23:59:59Z"
  }
}
```

### POST /api/billing/license/validate
Validate a license key.

**Request Body:**
```json
{
  "license_key": "BASE32ENCODEDKEY=="
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "valid": true,
  "tier": "pro",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

### POST /api/billing/license/refresh
Force refresh license validation.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "license": {
    "tier": "pro",
    "expires_at": "2026-12-31T23:59:59Z"
  }
}
```

### POST /api/billing/checkout
Create Stripe checkout session.

**Request Body:**
```json
{
  "plan": "pro"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "checkout_url": "https://checkout.stripe.com/..."
}
```

### GET /api/billing/portal
Get customer portal URL.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "portal_url": "https://billing.stripe.com/..."
}
```

### GET /api/billing/subscription
Get subscription details.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "subscription": {
    "id": "sub_1234567890",
    "status": "active",
    "plan": "pro",
    "current_period_start": "2026-08-01T00:00:00Z",
    "current_period_end": "2026-09-01T00:00:00Z",
    "cancel_at_period_end": false
  }
}
```

### POST /api/billing/webhook/stripe
Handle Stripe webhook.

**Headers:**
```
Stripe-Signature: <signature>
```

**Response (200 OK):**
```json
{
  "success": true,
  "event": "checkout.session.completed"
}
```

### POST /api/billing/check-feature
Check if feature is available.

**Request Body:**
```json
{
  "feature": "unlimited_agents"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "available": true,
  "tier": "pro"
}
```

### GET /api/billing/limits
Get tier limits.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "limits": {
    "free": {
      "max_agents": 1,
      "max_projects": 3,
      "max_storage_gb": 10
    },
    "pro": {
      "max_agents": 10,
      "max_projects": 100,
      "max_storage_gb": 100
    },
    "enterprise": {
      "max_agents": -1,
      "max_projects": -1,
      "max_storage_gb": -1
    }
  }
}
```

### GET /api/billing/pricing
Get available pricing plans.

**Response (200 OK):**
```json
{
  "plans": [
    {
      "tier": "free",
      "name": "Free",
      "price": 0,
      "features": ["1 agent", "3 projects", "10 GB storage"],
      "recommended": false
    },
    {
      "tier": "pro",
      "name": "Pro",
      "price": 29,
      "features": ["10 agents", "100 projects", "100 GB storage", "priority support"],
      "recommended": true
    },
    {
      "tier": "enterprise",
      "name": "Enterprise",
      "price": "custom",
      "features": ["unlimited agents", "unlimited projects", "unlimited storage", "dedicated support"],
      "recommended": false
    }
  ]
}
```

---

## Compliance Reporting

### POST /api/compliance/reports/soc2
Generate SOC2 audit trail report.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "days": 30,
  "format": "csv"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "report": {
    "id": "uuid",
    "type": "soc2",
    "format": "csv",
    "generated_at": "2026-08-02T10:00:00Z",
    "url": "/api/compliance/reports/soc2/uuid.csv"
  }
}
```

### POST /api/compliance/reports/gdpr
Generate GDPR data flow report.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "days": 30,
  "format": "json"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "report": {
    "id": "uuid",
    "type": "gdpr",
    "format": "json",
    "generated_at": "2026-08-02T10:00:00Z",
    "url": "/api/compliance/reports/gdpr/uuid.json"
  }
}
```

### POST /api/compliance/reports/cost-allocation
Generate cost allocation report.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "days": 30,
  "format": "csv",
  "department": "engineering"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "report": {
    "id": "uuid",
    "type": "cost-allocation",
    "format": "csv",
    "generated_at": "2026-08-02T10:00:00Z",
    "url": "/api/compliance/reports/cost-allocation/uuid.csv"
  }
}
```

### POST /api/compliance/reports/model-usage
Generate model usage report.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "days": 30,
  "format": "csv"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "report": {
    "id": "uuid",
    "type": "model-usage",
    "format": "csv",
    "generated_at": "2026-08-02T10:00:00Z",
    "url": "/api/compliance/reports/model-usage/uuid.csv"
  }
}
```

### GET /api/compliance/reports
List generated reports.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `type`: Filter by report type (soc2, gdpr, cost-allocation, model-usage)
- `limit`: Maximum number of results (default: 50)
- `offset`: Number of results to skip (default: 0)

**Response (200 OK):**
```json
{
  "reports": [
    {
      "id": "uuid",
      "type": "soc2",
      "format": "csv",
      "generated_at": "2026-08-02T10:00:00Z",
      "days": 30
    }
  ],
  "total": 1
}
```

---

## OAuth SSO

> ⚠️ **Not functional end-to-end today.** The routes below exist and are documented as designed,
> but `handleOAuthAuthorize`/`handleOAuthCallback` currently call `auth/oauth-provider.mjs`
> methods with mismatched arguments (and one non-existent method name), and there's no session
> store backing the authorize→callback round trip on this server's raw `node:http` stack. A login
> attempt will not currently complete. See [KNOWN-ISSUES.md](KNOWN-ISSUES.md). Use
> `POST /api/auth/login` (email/password) or an API key until this is fixed.

### GET /api/auth/oauth/{provider}/authorize
Generate OAuth authorization URL.

**Query Parameters:**
- `state`: Optional state parameter for CSRF protection

**Response (200 OK):**
```json
{
  "success": true,
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "random-state-string",
  "provider": "google"
}
```

### GET /api/auth/oauth/{provider}/callback
Handle OAuth callback and exchange code for tokens.

**Query Parameters:**
- `code`: Authorization code from OAuth provider
- `state`: State parameter for CSRF protection

**Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@gmail.com",
    "name": "John Doe",
    "role": "viewer",
    "provider": "google"
  }
}
```

**Error (400 Bad Request):**
```json
{
  "success": false,
  "error": "Invalid or missing state parameter"
}
```

---

## Error Responses

### Common HTTP Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Missing or invalid authentication
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `409 Conflict`: Resource conflict (e.g., duplicate email)
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

### Error Response Format

```json
{
  "success": false,
  "error": "Error message",
  "details": "Optional detailed error information"
}
```

### Example Errors

**401 Unauthorized:**
```json
{
  "success": false,
  "error": "Missing authorization header"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "error": "Insufficient permissions",
  "details": "Viewer role cannot modify project configuration"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Project not found",
  "details": "Project with ID 'uuid' does not exist"
}
```

**429 Too Many Requests:**
```json
{
  "success": false,
  "error": "Too many requests. Please try again later."
}
```

---

## Rate Limiting

All API endpoints are rate-limited to prevent abuse.

- **Window**: 1 minute
- **Max Requests**: 100 per window
- **IP-based**: Rate limits are applied per IP address

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1693766400
```

---

## Authentication Methods

### JWT Token
Most endpoints require JWT token authentication via Authorization header:

```
Authorization: Bearer <jwt-token>
```

### API Key
Some endpoints support API key authentication:

```
Authorization: Api-Key <api-key>
```

### OAuth
OAuth authentication is supported via provider-specific endpoints:

```
Authorization: Bearer <oauth-jwt-token>
```

---

## Role-Based Access Control

### Roles

- **admin**: Full access to all features
- **operator**: Can manage projects and tasks
- **viewer**: Read-only access

### Permissions

| Feature | Admin | Operator | Viewer |
|---------|-------|----------|--------|
| View projects | ✅ | ✅ | ✅ |
| Create projects | ✅ | ✅ | ❌ |
| Modify project config | ✅ | ✅ | ❌ |
| Manage team members | ✅ | ❌ | ❌ |
| View billing | ✅ | ✅ | ❌ |
| Generate reports | ✅ | ✅ | ❌ |
| Create tasks | ✅ | ✅ | ✅ |
| Add comments | ✅ | ✅ | ✅ |

---

## Versioning

API versioning is maintained via URL path:

- **Current Version**: `/api/v1`
- **Deprecated Versions**: `/api/v0`

---

## Support

For API support and issues, contact support@meridianos.dev or open an issue on GitHub.

---

**End of Documentation**
