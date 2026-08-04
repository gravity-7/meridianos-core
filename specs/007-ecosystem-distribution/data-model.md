# Data Model: Ecosystem, Distribution & Marketplace

**Feature**: Phase 7 - Ecosystem, Distribution & Marketplace
**Date**: 2026-08-03

## Overview

This document defines the data entities, relationships, and validation rules for Phase 7 features: packaged binaries, Electron desktop app, REST API, plugin marketplace, and hybrid cloud control plane.

## Entities

### 1. API Key

**Purpose**: Authentication token for REST API access with scoped permissions

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique identifier, format `mk-{random}`
- `name` (TEXT, NOT NULL): Human-readable name for the key
- `scopes` (TEXT, NOT NULL): Comma-separated permissions (tasks:read, tasks:write, costs:read, providers:read, providers:write, config:read, config:write)
- `created_at` (INTEGER, NOT NULL): Unix timestamp
- `last_used_at` (INTEGER): Unix timestamp of last API call
- `is_active` (INTEGER, NOT NULL, DEFAULT 1): 1 = active, 0 = revoked

**Validation Rules**:
- `id` must match pattern `^mk-[a-zA-Z0-9]{32}$`
- `scopes` must be non-empty and contain only valid scope names
- `is_active` must be 0 or 1

**Relationships**:
- One-to-many with RateLimitEntry (via API key usage tracking)

---

### 2. RateLimitEntry

**Purpose**: Track API request timestamps for rate limiting (in-memory, not persisted)

**Fields**:
- `api_key_id` (TEXT): Reference to API Key
- `timestamp` (INTEGER, NOT NULL): Unix timestamp of request
- `count` (INTEGER, NOT NULL): Request count in current window

**Validation Rules**:
- `timestamp` must be within last 60 seconds (sliding window)
- `count` must be positive

**Storage**: In-memory Map, not persisted to SQLite

---

### 3. Webhook

**Purpose**: Registered HTTP endpoints for receiving event notifications

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique identifier
- `url` (TEXT, NOT NULL): HTTPS endpoint URL
- `events` (TEXT, NOT NULL): Comma-separated event types (task.created, task.completed, task.failed, budget.warning, budget.critical, provider.error, model.deprecated, cost.spike)
- `secret` (TEXT): Optional HMAC secret for signature verification
- `is_active` (INTEGER, NOT NULL, DEFAULT 1): 1 = active, 0 = disabled
- `created_at` (INTEGER, NOT NULL): Unix timestamp
- `last_delivery_at` (INTEGER): Unix timestamp of last successful delivery
- `failure_count` (INTEGER, DEFAULT 0): Consecutive failure count

**Validation Rules**:
- `url` must be valid HTTPS URL
- `events` must be non-empty and contain only valid event types
- `is_active` must be 0 or 1
- `failure_count` must be non-negative

**Relationships**:
- One-to-many with WebhookDeliveryLog

---

### 4. WebhookDeliveryLog

**Purpose**: Track webhook delivery attempts and results

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique identifier
- `webhook_id` (TEXT, NOT NULL): Reference to Webhook
- `event_type` (TEXT, NOT NULL): Event type that triggered delivery
- `payload` (TEXT, NOT NULL): JSON payload sent
- `status` (TEXT, NOT NULL): success, failed, retrying
- `http_status` (INTEGER): HTTP status code from endpoint
- `error_message` (TEXT): Error details if failed
- `attempt_number` (INTEGER, NOT NULL): Retry attempt (1-3)
- `delivered_at` (INTEGER, NOT NULL): Unix timestamp

**Validation Rules**:
- `status` must be one of: success, failed, retrying
- `attempt_number` must be between 1 and 3
- `http_status` must be valid HTTP status code (100-599)

**Relationships**:
- Many-to-one with Webhook

---

### 5. Plugin

**Purpose**: Extensible module implementing IntakeSource or WireAdapter contract

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique identifier
- `name` (TEXT, NOT NULL): Plugin name
- `type` (TEXT, NOT NULL): intake-source or wire-adapter
- `description` (TEXT): Human-readable description
- `author` (TEXT): Plugin author
- `version` (TEXT, NOT NULL): Semantic version (e.g., 1.0.0)
- `rating` (REAL, DEFAULT 0): Average rating (1-5 stars)
- `install_count` (INTEGER, DEFAULT 0): Number of installations
- `repository` (TEXT): Git repository URL
- `is_installed` (INTEGER, NOT NULL, DEFAULT 0): 1 = installed, 0 = not installed
- `is_enabled` (INTEGER, NOT NULL, DEFAULT 0): 1 = enabled, 0 = disabled
- `installed_at` (INTEGER): Unix timestamp of installation
- `config` (TEXT): JSON configuration object

**Validation Rules**:
- `type` must be one of: intake-source, wire-adapter
- `version` must match semantic versioning pattern
- `rating` must be between 0 and 5
- `install_count` must be non-negative
- `is_installed` and `is_enabled` must be 0 or 1

**Relationships**:
- One-to-many with PluginConfiguration

---

### 6. PluginConfiguration

**Purpose**: Plugin-specific configuration settings

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique identifier
- `plugin_id` (TEXT, NOT NULL): Reference to Plugin
- `key` (TEXT, NOT NULL): Configuration key
- `value` (TEXT, NOT NULL): Configuration value
- `is_sensitive` (INTEGER, NOT NULL, DEFAULT 0): 1 = sensitive (e.g., API token), 0 = not sensitive

**Validation Rules**:
- `key` must be non-empty
- `is_sensitive` must be 0 or 1

**Relationships**:
- Many-to-one with Plugin

---

### 7. CloudMachine

**Purpose**: Connected MeridianOS instance in cloud control plane

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique machine identifier
- `org_id` (TEXT, NOT NULL): Organization identifier
- `name` (TEXT): Human-readable machine name
- `api_key` (TEXT, NOT NULL): Per-machine authentication key
- `last_seen` (INTEGER, NOT NULL): Unix timestamp of last metadata report
- `status` (TEXT, NOT NULL, DEFAULT 'online'): online, offline, degraded
- `os_type` (TEXT): Operating system (windows, macos, linux)
- `meridianos_version` (TEXT): Installed version
- `reporting_interval` (INTEGER, DEFAULT 60): Metadata reporting interval in seconds (30-300)

**Validation Rules**:
- `status` must be one of: online, offline, degraded
- `os_type` must be one of: windows, macos, linux
- `reporting_interval` must be between 30 and 300

**Relationships**:
- Many-to-one with CloudOrganization
- One-to-many with CloudMetadata

---

### 8. CloudOrganization

**Purpose**: Multi-tenant organization in cloud control plane

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique organization identifier
- `name` (TEXT, NOT NULL): Organization name
- `created_at` (INTEGER, NOT NULL): Unix timestamp
- `is_active` (INTEGER, NOT NULL, DEFAULT 1): 1 = active, 0 = suspended

**Validation Rules**:
- `is_active` must be 0 or 1

**Relationships**:
- One-to-many with CloudMachine
- One-to-many with CloudUser

---

### 9. CloudUser

**Purpose**: User account for cloud control plane access

**Fields**:
- `id` (TEXT, PRIMARY KEY): Unique user identifier
- `org_id` (TEXT, NOT NULL): Reference to CloudOrganization
- `email` (TEXT, NOT NULL, UNIQUE): User email
- `password_hash` (TEXT, NOT NULL): Bcrypt hash of password
- `role` (TEXT, NOT NULL, DEFAULT 'viewer'): admin, operator, viewer
- `created_at` (INTEGER, NOT NULL): Unix timestamp
- `last_login_at` (INTEGER): Unix timestamp of last login

**Validation Rules**:
- `email` must be valid email format
- `role` must be one of: admin, operator, viewer

**Relationships**:
- Many-to-one with CloudOrganization

---

### 10. CloudMetadata

**Purpose**: Anonymized metadata reported from local machines

**Fields**:
- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT): Auto-incrementing ID
- `machine_id` (TEXT, NOT NULL): Reference to CloudMachine
- `timestamp` (INTEGER, NOT NULL): Unix timestamp
- `provider` (TEXT): LLM provider name
- `model` (TEXT): Model name
- `tokens` (INTEGER): Token count
- `cost` (REAL): Cost in USD
- `latency_ms` (INTEGER): Request latency in milliseconds

**Validation Rules**:
- `tokens` must be non-negative
- `cost` must be non-negative
- `latency_ms` must be non-negative

**Relationships**:
- Many-to-one with CloudMachine

**Retention**: Automatically deleted after 90 days via D1 cron trigger

---

## State Transitions

### Webhook State Machine

```
active → disabled (manual disable)
disabled → active (manual enable)
active → failed (3 consecutive failures)
failed → active (successful delivery)
```

### CloudMachine State Machine

```
online → offline (no report for 5 minutes)
offline → online (report received)
online → degraded (provider errors)
degraded → online (providers healthy)
```

### Plugin State Machine

```
not_installed → installed (install action)
installed → enabled (enable action)
enabled → disabled (disable action)
disabled → enabled (enable action)
installed → not_installed (uninstall action)
```

---

## Indexes

### SQLite (Local)

```sql
CREATE INDEX idx_webhooks_is_active ON webhooks(is_active);
CREATE INDEX idx_webhook_delivery_logs_webhook_id ON webhook_delivery_logs(webhook_id);
CREATE INDEX idx_webhook_delivery_logs_delivered_at ON webhook_delivery_logs(delivered_at);
CREATE INDEX idx_plugins_type ON plugins(type);
CREATE INDEX idx_plugins_is_installed ON plugins(is_installed);
CREATE INDEX idx_plugin_configurations_plugin_id ON plugin_configurations(plugin_id);
```

### D1 (Cloud)

```sql
CREATE INDEX idx_cloud_metadata_machine_id ON cloud_metadata(machine_id);
CREATE INDEX idx_cloud_metadata_timestamp ON cloud_metadata(timestamp);
CREATE INDEX idx_cloud_machines_org_id ON cloud_machines(org_id);
CREATE INDEX idx_cloud_users_org_id ON cloud_users(org_id);
CREATE INDEX idx_cloud_users_email ON cloud_users(email);
```

---

## Data Flow

### REST API Request Flow

```
Client Request
  → Extract API key from Authorization header
  → Validate API key exists and is active
  → Check rate limit (in-memory sliding window)
  → Validate scope permissions
  → Execute request
  → Update last_used_at timestamp
  → Return response
```

### Webhook Delivery Flow

```
Event Triggered
  → Query active webhooks subscribed to event
  → For each webhook:
    → Create delivery log entry
    → Send POST request with JSON payload
    → On success: Update webhook.last_delivery_at, reset failure_count
    → On failure: Increment failure_count, retry with exponential backoff (max 3 attempts)
    → After 3 failures: Mark webhook as failed
```

### Cloud Metadata Reporting Flow

```
Local Agent (every 60s)
  → Collect anonymized metadata (tokens, costs, provider health)
  → Send POST to cloud control plane with machine API key
  → Cloud validates API key
  → Store metadata in D1
  → Update machine.last_seen
  → Check for pending policy changes
  → Return policy updates if any
  → Local agent applies policy on next scheduler tick
```

---

## Security Considerations

### API Key Security
- Keys stored with bcrypt hash in cloud database
- Keys never logged or exposed in error messages
- Keys can be revoked (is_active = 0)

### Webhook Security
- Optional HMAC signature verification using shared secret
- HTTPS only (no HTTP endpoints allowed)
- Rate limiting per webhook to prevent abuse

### Cloud Metadata Privacy
- Only anonymized metadata sent (no API keys, no content)
- Per-machine API keys separate from provider keys
- 90-day automatic deletion
- Audit logging for all data access

### Plugin Security
- Contract validation before loading
- Static analysis for dangerous patterns (eval, file access, network)
- Plugins run in isolated context
- Configuration marked as sensitive never displayed in UI