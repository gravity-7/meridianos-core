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
| role | TEXT | NOT NULL, DEFAULT 'viewer' | Global/site role: 'admin', 'operator', 'viewer' (distinct from a project-scoped `project_users.role` — see ProjectUser) |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| updated_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| last_login | INTEGER | NULL | Unix timestamp of last login |
| is_active | INTEGER | NOT NULL, DEFAULT 1 | Account active status (SQLite has no native BOOLEAN — 0/1) |

**Relationships**:
- One-to-many with `project_users` (user's project memberships)
- One-to-many with `api_tokens` (user's API keys)
- One-to-many with `activity_log` (user's actions — see ActivityEvent; table renamed from an
  earlier `activity_events` this doc used to specify, which is not what the code creates)
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
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) — column is `created_at`, not `joined_at` |
| updated_at | INTEGER | NOT NULL | Unix timestamp (seconds) |

Note: there is no `invited_by` column in the real implementation — which user sent a given
invitation is not currently tracked anywhere (Invitation below has the same gap: no `created_by`).

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

**Table**: `activity_log` (in control plane database — an earlier version of this doc named it
`activity_events`; that table is not what `compliance/audit-log.mjs`'s ActivityLogger actually
creates, so anything querying `activity_events` against a real `.ai/control-plane.db` found
nothing. `target_type`/`target_id`/`ip_address` below were likewise aspirational — ActivityLogger
never writes them. There is a *separate* `compliance_log` table, with its own `category`/
`ip_address` columns, for SOC2/GDPR compliance trail purposes — a different concern from this
team-activity log, owned by the same file's `AuditLogger` class.)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique event identifier (UUID v4) |
| user_id | TEXT | NULL | User who performed action (NULL = system) |
| project_id | TEXT | NULL | Project context (NULL = global) |
| action | TEXT | NOT NULL | Action type (see Action Types) |
| details | TEXT | NOT NULL, DEFAULT '{}' | Additional detail (JSON string) — column is `details`, not `detail` |
| timestamp | INTEGER | NOT NULL | Unix timestamp (seconds) |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) — always equal to `timestamp` at insert time |

**Relationships**:
- Many-to-one with `users` (user who performed action) — not FK-enforced at the SQLite level
- Many-to-one with `projects` (project context) — not FK-enforced at the SQLite level

**Validation Rules**:
- `action`: Must be one of defined action types (not enforced by the table itself — `action` is
  just `NOT NULL`; the code that calls `ActivityLogger.log()` is responsible for using a real one)
- `details`: Must be valid JSON (ActivityLogger.log() always JSON.stringify()s whatever it's given)

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
| content | TEXT | NOT NULL | Comment content — column is `content`, not `body` |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| updated_at | INTEGER | NOT NULL | Unix timestamp (seconds) — set equal to `created_at` at insert time, not NULL until first edit |

**Relationships**:
- Many-to-one with `tasks` (task this comment belongs to) — not FK-enforced at the SQLite level
- Many-to-one with `users` (user who wrote comment) — not FK-enforced at the SQLite level

**Validation Rules**:
- `content`: non-empty string enforced by TaskComment.create() at the application layer (not a
  DB-level CHECK constraint); HTML-escaped via TaskComment.sanitizeContent() before storage
- `updated_at`: always >= `created_at`

---

### Invitation

Represents a pending team member invitation.

**Table**: `invitations` (in control plane database)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique invitation identifier (UUID v4) |
| token | TEXT | NOT NULL, UNIQUE | Invitation token (UUID v4 — not a 32-char hex string as this doc used to claim; `crypto.randomUUID()`) |
| email | TEXT | NOT NULL | Email address of invitee |
| project_id | TEXT | NOT NULL | Project to invite to — not FK-enforced at the SQLite level |
| role | TEXT | NOT NULL | Role to assign: 'admin', 'operator', 'viewer' |
| expires_at | INTEGER | NOT NULL | Unix timestamp of expiration (24h from creation) |
| status | TEXT | NOT NULL, DEFAULT 'pending' | 'pending' or 'accepted' — there is no separate `accepted_at` column; acceptance is `status='accepted'` + `updated_at` |
| created_at | INTEGER | NOT NULL | Unix timestamp (seconds) |
| updated_at | INTEGER | NOT NULL | Unix timestamp (seconds) — bumped on acceptance |

There is no `created_by` column — which admin sent a given invitation is not currently tracked
(same gap noted on ProjectUser above).

**Relationships**:
- Many-to-one with `projects` (project this invitation is for) — not FK-enforced at the SQLite level

**Validation Rules**:
- `token`: UUID v4
- `email`: Valid email format (checked at the application layer, not a DB constraint)
- `role`: Must be one of ['admin', 'operator', 'viewer'] (checked at the application layer)
- `expires_at`: Always `created_at + 86400` (24h) — not independently settable

**State Transitions**:
```
pending → accepted (user accepts invitation)
pending → expired (expires_at passed)
```
Note: "expired" is not a stored `status` value — `InvitationManager.validate()` computes it at
read time by comparing `expires_at` against the current time while `status` is still 'pending'.
Only 'pending' and 'accepted' actually appear in the `status` column.

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