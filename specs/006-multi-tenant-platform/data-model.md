# Data Model: Multi-Tenant Platform

**Feature**: Multi-Tenant Platform  
**Date**: 2026-08-01  
**Status**: Complete

## Overview

This document defines the data model for the multi-tenant platform, including entities, fields, relationships, validation rules, and state transitions. The model extends the existing MeridianOS schema with multi-tenant capabilities while maintaining backward compatibility.

---

## Entity Definitions

### Project

Represents a MeridianOS instance with isolated state, configuration, agents, and budget.

**Table**: `projects` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique project identifier (UUID v4) |
| name | TEXT | NOT NULL, UNIQUE | Human-readable project name |
| status | TEXT | NOT NULL, DEFAULT 'stopped' | Status: 'running', 'stopped', 'error', 'restarting' |
| template | TEXT | NULL | Template used for creation (e.g., 'saas-web-app') |
| config_path | TEXT | NOT NULL | Path to project-specific policy.yaml |
| state_path | TEXT | NOT NULL | Path to project state directory |
| port | INTEGER | NOT NULL, UNIQUE | Dashboard port for this project |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| created_by | TEXT | NOT NULL | User ID who created the project |
| health_status | TEXT | NOT NULL, DEFAULT 'unknown' | Health: 'healthy', 'degraded', 'down', 'unknown' |
| last_health_check | INTEGER | NULL | Unix timestamp of last health check |
| restart_count | INTEGER | NOT NULL, DEFAULT 0 | Number of restarts in current hour |
| last_restart | INTEGER | NULL | Unix timestamp of last restart |

**Relationships**:
- One-to-many with `project_users` (users assigned to project)
- One-to-many with `activity_events` (project-specific activity)
- One-to-many with `task_comments` (project-specific comments)

**Validation Rules**:
- `name`: 1-100 characters, alphanumeric + spaces + hyphens + underscores
- `port`: 1024-65535, must be unique across all projects
- `status`: Must be one of ['running', 'stopped', 'error', 'restarting']
- `health_status`: Must be one of ['healthy', 'degraded', 'down', 'unknown']

**State Transitions**:
```
stopped → running (start)
running → stopped (stop)
running → error (crash)
error → restarting (auto-restart)
restarting → running (restart success)
restarting → error (restart failed)
```

---

### User

Represents a team member with authentication credentials and roles.

**Table**: `users` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique user identifier (UUID v4) |
| email | TEXT | NOT NULL, UNIQUE | User email address |
| password_hash | TEXT | NOT NULL | Scrypt-hashed password (salt:key format) |
| full_name | TEXT | NULL | User's full name |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| last_login | INTEGER | NULL | Unix timestamp of last login |
| is_active | BOOLEAN | NOT NULL, DEFAULT true | Account active status |

**Relationships**:
- One-to-many with `project_users` (user's project memberships)
- One-to-many with `api_tokens` (user's API keys)
- One-to-many with `activity_events` (user's actions)
- One-to-many with `task_comments` (user's comments)

**Validation Rules**:
- `email`: Valid email format, lowercase, 1-255 characters
- `password_hash`: Must match scrypt format (64-char hex key with 32-char hex salt)
- `full_name`: 1-200 characters if present

---

### ProjectUser

Represents a user's membership in a project with assigned role.

**Table**: `project_users` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique membership identifier (UUID v4) |
| project_id | TEXT | NOT NULL, FK → projects.id | Project identifier |
| user_id | TEXT | NOT NULL, FK → users.id | User identifier |
| role | TEXT | NOT NULL | Role: 'admin', 'operator', 'viewer' |
| joined_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| invited_by | TEXT | NULL | User ID who sent invitation |

**Relationships**:
- Many-to-one with `projects` (project this membership belongs to)
- Many-to-one with `users` (user this membership belongs to)

**Validation Rules**:
- `role`: Must be one of ['admin', 'operator', 'viewer']
- Unique constraint on (project_id, user_id)

**Role Permissions**:
- `admin`: Full control - manage users, modify config, delete project
- `operator`: Task management - create/complete tasks, view config, no user management
- `viewer`: Read-only - view tasks, spend, config, no modifications

---

### APIToken

Represents an API key for programmatic access.

**Table**: `api_tokens` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique token identifier (UUID v4) |
| token_hash | TEXT | NOT NULL, UNIQUE | SHA-256 hash of token value |
| user_id | TEXT | NOT NULL, FK → users.id | User who owns this token |
| name | TEXT | NOT NULL | Human-readable token name |
| scope | TEXT | NOT NULL | Scope: 'admin', 'operator', 'viewer' |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| last_used | INTEGER | NULL | Unix timestamp of last use |
| expires_at | INTEGER | NULL | Unix timestamp of expiration (NULL = no expiry) |
| is_revoked | BOOLEAN | NOT NULL, DEFAULT false | Revocation status |

**Relationships**:
- Many-to-one with `users` (user who owns this token)

**Validation Rules**:
- `token_hash`: 64-character hex string (SHA-256)
- `name`: 1-100 characters
- `scope`: Must be one of ['admin', 'operator', 'viewer']
- `expires_at`: Must be > `created_at` if present

**Token Format**: `mk-{random}` where random is 32-character base32 string

---

### ActivityEvent

Represents an auditable action in the system.

**Table**: `activity_events` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique event identifier (UUID v4) |
| timestamp | INTEGER | NOT NULL | Unix timestamp (seconds) |
| user_id | TEXT | NULL, FK → users.id | User who performed action (NULL = system) |
| project_id | TEXT | NULL, FK → projects.id | Project context (NULL = global) |
| action | TEXT | NOT NULL | Action type (see Action Types) |
| target_type | TEXT | NULL | Type of target (e.g., 'task', 'config', 'user') |
| target_id | TEXT | NULL | Identifier of target |
| detail | TEXT | NULL | Additional detail (JSON string) |
| ip_address | TEXT | NULL | IP address of request |

**Relationships**:
- Many-to-one with `users` (user who performed action)
- Many-to-one with `projects` (project context)

**Validation Rules**:
- `action`: Must be one of defined action types
- `detail`: Must be valid JSON if present

**Action Types**:
- `user.login`, `user.logout`, `user.created`, `user.invited`
- `task.created`, `task.completed`, `task.commented`, `task.assigned`
- `config.updated`, `provider.added`, `provider.removed`
- `project.created`, `project.started`, `project.stopped`, `project.deleted`
- `license.activated`, `license.expired`, `license.upgraded`
- `report.generated`, `data.exported`

---

### TaskComment

Represents comments on tasks for team collaboration.

**Table**: `task_comments` (in project database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique comment identifier (UUID v4) |
| task_id | TEXT | NOT NULL | Task identifier |
| user_id | TEXT | NOT NULL | User who wrote comment |
| body | TEXT | NOT NULL | Comment content |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| updated_at | INTEGER | NULL | Unix timestamp of last edit |

**Relationships**:
- Many-to-one with `tasks` (task this comment belongs to)
- Many-to-one with `users` (user who wrote comment)

**Validation Rules**:
- `body`: 1-10000 characters
- `updated_at`: Must be >= `created_at` if present

---

### Invitation

Represents a pending team member invitation.

**Table**: `invitations` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique invitation identifier (UUID v4) |
| token | TEXT | NOT NULL, UNIQUE | Invitation token (32-character hex) |
| email | TEXT | NOT NULL | Email address of invitee |
| project_id | TEXT | NOT NULL, FK → projects.id | Project to invite to |
| role | TEXT | NOT NULL | Role to assign: 'admin', 'operator', 'viewer' |
| created_by | TEXT | NOT NULL, FK → users.id | User who sent invitation |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| expires_at | INTEGER | NOT NULL | Unix timestamp of expiration |
| accepted_at | INTEGER | NULL | Unix timestamp of acceptance (NULL = pending) |

**Relationships**:
- Many-to-one with `projects` (project this invitation is for)
- Many-to-one with `users` (user who sent invitation)

**Validation Rules**:
- `token`: 32-character hex string
- `email`: Valid email format
- `role`: Must be one of ['admin', 'operator', 'viewer']
- `expires_at`: Must be > `created_at`
- `accepted_at`: Must be > `created_at` and < `expires_at` if present

**State Transitions**:
```
pending → accepted (user accepts invitation)
pending → expired (expires_at passed)
```

---

### License

Represents a subscription license with tier and feature entitlements.

**Table**: `licenses` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique license identifier (UUID v4) |
| license_key | TEXT | NOT NULL, UNIQUE | License key: `mer-XXXX-XXXX-XXXX-XXXX` |
| tier | TEXT | NOT NULL | Tier: 'free', 'pro', 'enterprise' |
| customer_id | TEXT | NULL | Stripe customer ID |
| subscription_id | TEXT | NULL | Stripe subscription ID |
| status | TEXT | NOT NULL | Status: 'active', 'expired', 'revoked', 'grace_period' |
| features | TEXT | NOT NULL | JSON array of enabled features |
| expires_at | INTEGER | NULL | Unix timestamp of expiration (NULL = lifetime) |
| last_validated | INTEGER | NOT NULL | Unix timestamp of last validation |
| validation_cache | TEXT | NULL | Cached validation response (JSON) |

**Relationships**:
- One-to-many with `projects` (projects using this license)

**Validation Rules**:
- `license_key`: Must match format `mer-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}`
- `tier`: Must be one of ['free', 'pro', 'enterprise']
- `status`: Must be one of ['active', 'expired', 'revoked', 'grace_period']
- `features`: Must be valid JSON array
- `last_validated`: Must be <= current timestamp

**Tier Features**:
- `free`: 1 agent, DeepSeek only, metering only, local-only dashboard
- `pro`: Unlimited agents, all providers, budget enforcement, remote dashboard, team collaboration (5 users)
- `enterprise`: Pro + SSO, unlimited users, priority support, custom models, compliance reports

**State Transitions**:
```
active → grace_period (subscription expires, 72h grace)
grace_period → expired (grace period ends)
active → revoked (manual revocation)
expired → active (subscription renewed)
```

---

### Template

Represents a pre-configured project template.

**Storage**: YAML files in `templates/` directory

**Structure**:
```yaml
name: "SaaS Web App"
description: "Full-stack web application with React frontend and Node.js backend"
agents:
  - name: "builder"
    harness: "claude-code"
    default_tier: "medium"
    prompts:
      - category: "feature"
        template: "Build a {feature} for the SaaS platform using React and Node.js"
  - name: "reviewer"
    harness: "claude-code"
    default_tier: "complex"
  - name: "designer"
    harness: "claude-code"
    default_tier: "medium"
categories:
  - "feature"
  - "bug-fix"
  - "refactor"
  - "ui-design"
  - "api-integration"
  - "testing"
  - "docs"
model_routing:
  tiers:
    simple:
      candidates:
        - model: "deepseek-chat"
          weight: 100
    medium:
      candidates:
        - model: "claude-sonnet-4"
          weight: 70
        - model: "deepseek-chat"
          weight: 30
    complex:
      candidates:
        - model: "claude-sonnet-4"
          weight: 100
```

**Validation Rules**:
- `name`: 1-100 characters
- `description`: 1-500 characters
- `agents`: At least 1 agent required
- `categories`: At least 1 category required
- `model_routing`: Must have at least 'simple' tier

---

## Schema Extensions

### Gateway Ledger Schema Extensions

**Existing table**: `token_events` (in gateway ledger)

**New columns**:
```sql
ALTER TABLE token_events ADD COLUMN tenant TEXT NOT NULL DEFAULT 'default';
ALTER TABLE token_events ADD COLUMN user_id TEXT;
ALTER TABLE token_events ADD COLUMN project_id TEXT;
```

**New table**: `audit_log` (separate from operational logs)
```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip_address TEXT,
  project_id TEXT
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_project ON audit_log(project_id);
```

---

## Data Access Patterns

### Multi-Project Isolation

1. **Project Databases**: Each project has its own SQLite database at `.ai/projects/{projectId}/state/aios.db`
2. **Shared Gateway**: Single gateway ledger with `tenant` column for cost attribution
3. **Control Plane**: Central database for users, projects, licenses, invitations
4. **Connection Pooling**: Separate connection pools per project database

### Authentication Flow

1. User provides credentials (email/password or API key)
2. System validates against `users` table (password hash) or `api_tokens` table (token hash)
3. On success, generate JWT with user ID, roles, and expiration
4. JWT returned to client and stored in localStorage/cookie
5. Subsequent requests include JWT in `Authorization: Bearer {token}` header
6. Middleware validates JWT and extracts user context

### Authorization Flow

1. Extract user ID and project ID from JWT or request
2. Query `project_users` table for user's role in project
3. Check role permissions against requested action
4. Allow or deny based on role permissions matrix

---

## Migration Strategy

### Phase 1: Schema Extensions
1. Add new columns to existing `token_events` table
2. Create new `audit_log` table
3. Create control plane database with new tables
4. Maintain backward compatibility (default tenant = 'default')

### Phase 2: Data Migration
1. Migrate existing single-user setup to default project
2. Create default admin user from existing configuration
3. Generate initial license key (free tier)
4. Import project templates

### Phase 3: Feature Rollout
1. Enable authentication (optional initially)
2. Enable multi-project support
3. Enable team collaboration
4. Enable billing integration

---

## Summary

The data model introduces 8 new entities (Project, User, ProjectUser, APIToken, ActivityEvent, TaskComment, Invitation, License) and extends existing schemas with tenant labeling and audit logging. All entities follow MeridianOS conventions:
- UUID v4 primary keys
- Unix timestamps for temporal data
- SQLite with WAL mode
- ES modules for data access
- Configuration-driven behavior

The model supports the full multi-tenant platform requirements while maintaining backward compatibility with existing single-user deployments.