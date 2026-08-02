# Migration Guide: Single-User to Multi-Tenant Platform

**Version**: 1.0.0
**Last Updated**: 2026-08-02
**Target Audience**: Existing MeridianOS users upgrading to multi-tenant platform

## Table of Contents

1. [Overview](#overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Backup Strategy](#backup-strategy)
4. [Migration Steps](#migration-steps)
5. [Post-Migration Verification](#post-migration-verification)
6. [Common Issues and Solutions](#common-issues-and-solutions)
7. [Rollback Plan](#rollback-plan)

---

## Overview

This guide helps you migrate from the single-user MeridianOS setup to the multi-tenant platform. The migration process is designed to be **non-destructive** and **backward compatible**.

### Key Changes

| Feature | Single-User | Multi-Tenant |
|---------|-------------|--------------|
| Authentication | Local file-based | JWT + OAuth SSO |
| Projects | Single project | Multiple isolated projects |
| Team Collaboration | None | Invitations, roles, activity feeds |
| Billing | None | Stripe integration, tier enforcement |
| Compliance | None | SOC2, GDPR, cost allocation reports |
| Dashboard | Local only | Remote access with HTTPS |
| Database | Single SQLite | Multi-tenant control plane DB |

---

## Pre-Migration Checklist

### Prerequisites

- [ ] MeridianOS version 1.0.0 or later
- [ ] Admin access to the control plane
- [ ] Backup of all existing data
- [ ] Stripe account (for billing features)
- [ ] Domain name (for custom OAuth providers)
- [ ] SSL certificate (for HTTPS)

### Data Assessment

- [ ] Review current project configurations
- [ ] Identify all users and their roles
- [ ] Document custom templates (if any)
- [ ] Check for any custom integrations
- [ ] Verify all agents are running successfully

### Environment Preparation

- [ ] Update to latest MeridianOS version
- [ ] Install Stripe SDK: `npm install stripe`
- [ ] Create new control plane database
- [ ] Generate JWT secret: `openssl rand -hex 32 > .ai/auth/jwt-secret`
- [ ] Set appropriate file permissions (0600 for JWT secret)

---

## Backup Strategy

### 1. Database Backup

```bash
# Backup control plane database
cp .ai/control-plane.db .ai/control-plane.db.backup

# Backup project databases
cp -r .ai/projects .ai/projects.backup

# Backup ledger database
cp .ai/ledger.db .ai/ledger.db.backup
```

### 2. Configuration Backup

```bash
# Backup policy configuration
cp .ai/policy.yaml .ai/policy.yaml.backup

# Backup custom templates
cp -r templates .ai/templates.backup

# Backup OAuth provider configurations
cp .ai/oauth-config.yaml .ai/oauth-config.yaml.backup
```

### 3. Application State Backup

```bash
# Backup AIOS worktrees
cp -r .aios-worktrees .aios-worktrees.backup

# Backup any custom scripts
cp -r scripts .ai/scripts.backup
```

### 4. Verification

```bash
# Verify backup integrity
ls -lh .ai/*.backup
ls -lh .ai/projects.backup
ls -lh .ai/templates.backup
```

---

## Migration Steps

### Step 1: Update Dependencies

```bash
# Install Stripe SDK
npm install stripe

# Verify installation
npm list stripe
```

### Step 2: Initialize Multi-Tenant Database

```bash
# Run database initialization
node -e "
import { openDb } from './db.mjs';
import { createProjectStore } from './project-store.mjs';
import { createAios } from './config.mjs';

const config = createAios();
const db = openDb(undefined, config);
const store = createProjectStore({ db, config });

console.log('Multi-tenant database initialized successfully');
"
```

### Step 3: Create Initial User

```bash
# Create admin user
node -e "
import { getUserStore } from './auth/user-store.mjs';
import { hashPassword } from './auth/user-store.mjs';

const userStore = getUserStore();
const hashedPassword = await hashPassword('your-secure-password');

await userStore.createUser({
  email: 'admin@example.com',
  password: hashedPassword,
  name: 'Administrator',
  role: 'admin'
});

console.log('Admin user created successfully');
"
```

### Step 4: Configure OAuth Providers (Optional)

Edit `.ai/oauth-config.yaml`:

```yaml
oauth:
  google:
    clientId: "your-google-client-id"
    clientSecret: "your-google-client-secret"
    redirectUri: "https://your-domain.com/api/auth/oauth/google/callback"
  github:
    clientId: "your-github-client-id"
    clientSecret: "your-github-client-secret"
    redirectUri: "https://your-domain.com/api/auth/oauth/github/callback"
  azuread:
    clientId: "your-azure-client-id"
    clientSecret: "your-azure-client-secret"
    tenantId: "your-tenant-id"
    redirectUri: "https://your-domain.com/api/auth/oauth/azuread/callback"
```

### Step 5: Configure Stripe (For Billing)

Edit `.ai/stripe-config.yaml`:

```yaml
stripe:
  secretKey: "sk_test_your_stripe_secret_key"
  webhookSecret: "whsec_your_webhook_secret"
  publishableKey: "pk_test_your_publishable_key"
```

### Step 6: Update Policy Configuration

Update `.ai/policy.yaml` to include multi-tenant settings:

```yaml
authentication:
  jwt:
    secretPath: ".ai/auth/jwt-secret"
    expirationMinutes: 30
    refreshWindowMinutes: 60
  rateLimiting:
    enabled: true
    windowMs: 60000
    maxRequests: 100

projects:
  maxProjects: 100
  defaultAgentCount: 3
  templateDir: "templates"

billing:
  enabled: true
  stripe:
    secretKey: "sk_test_your_stripe_secret_key"
    webhookSecret: "whsec_your_webhook_secret"
```

### Step 7: Generate JWT Secret

```bash
# Generate secure JWT secret
openssl rand -hex 32 > .ai/auth/jwt-secret

# Set secure permissions
chmod 600 .ai/auth/jwt-secret
```

### Step 8: Restart Services

```bash
# Stop existing services
pkill -f "node dashboard/server.mjs"
pkill -f "node gateway/server.mjs"

# Start control plane
node dashboard/server.mjs &

# Start gateway
node gateway/server.mjs &

# Start daemon (if needed)
node daemon-entry.mjs &
```

### Step 9: Verify Migration

```bash
# Check control plane health
curl http://localhost:4320/api/status

# Check authentication endpoint
curl -X POST http://localhost:4320/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-secure-password"}'

# Check project list
curl http://localhost:4320/api/projects \
  -H "Authorization: Bearer <your-jwt-token>"
```

---

## Post-Migration Verification

### 1. Authentication Test

```bash
# Test login
curl -X POST http://localhost:4320/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "your-secure-password"
  }'

# Verify token is returned
# Check that user object includes role and provider fields
```

### 2. Project Management Test

```bash
# Create a test project
curl -X POST http://localhost:4320/api/projects \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Project",
    "template": "saas-web-app"
  }'

# Verify project was created
curl http://localhost:4320/api/projects \
  -H "Authorization: Bearer <your-jwt-token>"
```

### 3. Team Collaboration Test

```bash
# Create a team member
curl -X POST http://localhost:4320/api/auth/users \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "member@example.com",
    "password": "secure-password",
    "name": "Team Member",
    "role": "operator"
  }'

# Verify member was created
curl http://localhost:4320/api/projects/{project-id}/members \
  -H "Authorization: Bearer <admin-token>"
```

### 4. Billing Test (Optional)

```bash
# Get license status
curl http://localhost:4320/api/billing/license \
  -H "Authorization: Bearer <your-jwt-token>"

# Get pricing plans
curl http://localhost:4320/api/billing/pricing
```

### 5. Compliance Reporting Test (Optional)

```bash
# Generate SOC2 report
curl -X POST http://localhost:4320/api/compliance/reports/soc2 \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "days": 30,
    "format": "csv"
  }'
```

---

## Common Issues and Solutions

### Issue 1: JWT Secret Not Found

**Error**: `Error: Failed to read JWT secret from .ai/auth/jwt-secret`

**Solution**:
```bash
# Generate new JWT secret
openssl rand -hex 32 > .ai/auth/jwt-secret

# Set correct permissions
chmod 600 .ai/auth/jwt-secret

# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

### Issue 2: Database Migration Failed

**Error**: `Error: Failed to migrate database schema`

**Solution**:
```bash
# Restore backup
cp .ai/control-plane.db.backup .ai/control-plane.db

# Re-run migration
node -e "
import { openDb } from './db.mjs';
import { createProjectStore } from './project-store.mjs';
import { createAios } from './config.mjs';

const config = createAios();
const db = openDb(undefined, config);
const store = createProjectStore({ db, config });

console.log('Database restored successfully');
"
```

### Issue 3: OAuth Provider Configuration Error

**Error**: `Error: Invalid OAuth provider configuration`

**Solution**:
```bash
# Verify OAuth config file
cat .ai/oauth-config.yaml

# Ensure redirect URI matches exactly
# Check that client ID and secret are correct

# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

### Issue 4: Stripe Webhook Not Working

**Error**: `Error: Stripe webhook signature verification failed`

**Solution**:
```bash
# Verify webhook secret
cat .ai/stripe-config.yaml

# Ensure webhook endpoint is accessible
curl https://your-domain.com/api/billing/webhook/stripe

# Check Stripe dashboard for webhook events
```

### Issue 5: Rate Limiting Too Strict

**Error**: `Error: Too many requests. Please try again later.`

**Solution**:
```bash
# Edit policy configuration
# Increase rate limit window or max requests

# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

---

## Rollback Plan

If migration fails, follow these steps to rollback:

### 1. Stop Multi-Tenant Services

```bash
pkill -f "node dashboard/server.mjs"
pkill -f "node gateway/server.mjs"
pkill -f "node daemon-entry.mjs"
```

### 2. Restore Backup

```bash
# Restore control plane database
cp .ai/control-plane.db.backup .ai/control-plane.db

# Restore project databases
cp -r .ai/projects.backup .ai/projects

# Restore configuration
cp .ai/policy.yaml.backup .ai/policy.yaml
cp .ai/oauth-config.yaml.backup .ai/oauth-config.yaml
cp .ai/stripe-config.yaml.backup .ai/stripe-config.yaml
```

### 3. Restore Application State

```bash
cp -r .aios-worktrees.backup .aios-worktrees
cp -r .ai/templates.backup .ai/templates
cp -r .ai/scripts.backup .ai/scripts
```

### 4. Restart Single-User Services

```bash
# Start control plane (single-user mode)
node dashboard/server.mjs &

# Start gateway
node gateway/server.mjs &

# Start daemon
node daemon-entry.mjs &
```

### 5. Verify Rollback

```bash
# Check control plane health
curl http://localhost:4320/api/status

# Verify single-user mode is active
curl http://localhost:4320/api/status | grep -i "single-user"
```

---

## Additional Resources

- [API Documentation](./multi-tenant-api.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [User Documentation](./user-guide.md)
- [GitHub Issues](https://github.com/gravity-7/meridianos-core/issues)
- [Support Email](support@meridianos.dev)

---

## Support

If you encounter issues during migration:

1. Check the troubleshooting guide
2. Review the backup and rollback procedures
3. Contact support@meridianos.dev
4. Open an issue on GitHub with:
   - Migration steps you followed
   - Error messages received
   - Backup files (if applicable)

---

**End of Migration Guide**
