# Troubleshooting Guide: Multi-Tenant Platform

**Version**: 1.0.0
**Last Updated**: 2026-08-02
**Target Audience**: Users experiencing issues with the multi-tenant platform

## Table of Contents

1. [Authentication Issues](#authentication-issues)
2. [Project Management Issues](#project-management-issues)
3. [Billing and Licensing Issues](#billing-and-licensing-issues)
4. [Team Collaboration Issues](#team-collaboration-issues)
5. [Compliance Reporting Issues](#compliance-reporting-issues)
6. [Performance Issues](#performance-issues)
7. [Database Issues](#database-issues)
8. [OAuth SSO Issues](#oauth-ssi-issues)
9. [Common Error Messages](#common-error-messages)

---

## Authentication Issues

### Issue: "Missing authorization header"

**Symptoms:**
- 401 Unauthorized error when accessing protected endpoints
- Error message: "Missing authorization header"

**Possible Causes:**
- Forgetting to include Authorization header
- Using wrong header format
- Token expired

**Solutions:**

1. **Verify header format:**
   ```bash
   # Correct format
   curl -H "Authorization: Bearer <your-jwt-token>" http://localhost:4317/api/projects

   # Incorrect format
   curl -H "Authorization: <your-jwt-token>" http://localhost:4317/api/projects
   ```

2. **Check token expiration:**
   ```bash
   # Refresh your token
   curl -X POST http://localhost:4317/api/auth/refresh \
     -H "Authorization: Bearer <expired-token>"
   ```

3. **Regenerate token:**
   ```bash
   # Login again
   curl -X POST http://localhost:4317/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password"}'
   ```

### Issue: "Invalid or expired token"

**Symptoms:**
- 401 Unauthorized error
- Error message: "Invalid or expired token"

**Solutions:**

1. **Refresh the token:**
   ```bash
   curl -X POST http://localhost:4317/api/auth/refresh \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Check token validity:**
   ```bash
   # Decode JWT token (without verification)
   echo "<your-token>" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .
   ```

3. **Verify JWT secret:**
   ```bash
   # Check if secret file exists and has correct permissions
   ls -la .ai/auth/jwt-secret
   cat .ai/auth/jwt-secret
   ```

### Issue: "Invalid authorization header format"

**Symptoms:**
- 401 Unauthorized error
- Error message: "Invalid authorization header format"

**Solutions:**

1. **Ensure proper header format:**
   ```bash
   # Correct: Bearer <token>
   curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

   # Incorrect: No scheme
   curl -H "Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

2. **Check for extra spaces:**
   ```bash
   # Correct
   curl -H "Authorization: Bearer <token>"

   # Incorrect (extra space after Bearer)
   curl -H "Authorization: Bearer  <token>"
   ```

---

## Project Management Issues

### Issue: "Project not found"

**Symptoms:**
- 404 Not Found error
- Error message: "Project not found"

**Solutions:**

1. **Verify project ID:**
   ```bash
   # List all projects
   curl http://localhost:4317/api/projects \
     -H "Authorization: Bearer <your-token>"

   # Use correct project ID from the list
   curl http://localhost:4317/api/projects/<correct-id> \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Check project status:**
   ```bash
   # Get project details
   curl http://localhost:4317/api/projects/<id> \
     -H "Authorization: Bearer <your-token>"

   # Check if project exists and is accessible
   ```

3. **Verify project permissions:**
   ```bash
   # Check if you have access to this project
   # Only users with admin/operator role can access all projects
   ```

### Issue: "Cannot start project - license limit exceeded"

**Symptoms:**
- 403 Forbidden error
- Error message: "License limit exceeded"

**Solutions:**

1. **Check license status:**
   ```bash
   curl http://localhost:4317/api/billing/license \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Upgrade license:**
   ```bash
   # Get pricing plans
   curl http://localhost:4317/api/billing/pricing

   # Create checkout session
   curl -X POST http://localhost:4317/api/billing/checkout \
     -H "Authorization: Bearer <your-token>" \
     -H "Content-Type: application/json" \
     -d '{"plan":"pro"}'
   ```

3. **Check tier limits:**
   ```bash
   curl http://localhost:4317/api/billing/limits \
     -H "Authorization: Bearer <your-token>"
   ```

### Issue: "Template not found"

**Symptoms:**
- 404 Not Found error
- Error message: "Template not found"

**Solutions:**

1. **List available templates:**
   ```bash
   curl http://localhost:4317/api/projects/templates \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Use correct template ID:**
   ```bash
   # Correct template IDs: saas-web-app, mobile-app, cli-tool, etc.
   curl -X POST http://localhost:4317/api/projects \
     -H "Authorization: Bearer <your-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "My Project",
       "template": "saas-web-app"
     }'
   ```

3. **Verify template files exist:**
   ```bash
   ls -la templates/
   ```

---

## Billing and Licensing Issues

### Issue: "Stripe webhook signature verification failed"

**Symptoms:**
- 500 Internal Server Error
- Error message: "Stripe webhook signature verification failed"

**Solutions:**

1. **Verify webhook secret:**
   ```bash
   # Check Stripe configuration
   cat .ai/stripe-config.yaml

   # Verify webhook secret matches Stripe dashboard
   ```

2. **Test webhook endpoint:**
   ```bash
   curl https://your-domain.com/api/billing/webhook/stripe \
     -X POST \
     -H "Stripe-Signature: <signature>" \
     -d '{"type":"checkout.session.completed"}'
   ```

3. **Check Stripe dashboard:**
   - Go to Stripe Dashboard → Webhooks
   - Verify webhook endpoint is configured
   - Check webhook logs for errors

### Issue: "License key validation failed"

**Symptoms:**
- 401 Unauthorized error
- Error message: "License key validation failed"

**Likely cause if this started happening after a routine restart**: `licensing/license-key.mjs`
generates its RSA signing keypair in memory on first use and does not currently persist it to
disk. Every process restart mints a fresh keypair, so any license key signed before that restart
fails signature verification afterward — this is a known gap, not necessarily a problem with the
key itself. Re-issue the license (or restart the checkout flow) rather than assuming the key is
corrupt.

**Solutions:**

1. **Validate license key:**
   ```bash
   curl -X POST http://localhost:4317/api/billing/license/validate \
     -H "Authorization: Bearer <your-token>" \
     -H "Content-Type: application/json" \
     -d '{"license_key":"<your-license-key>"}'
   ```

2. **Check license status:**
   ```bash
   curl http://localhost:4317/api/billing/license \
     -H "Authorization: Bearer <your-token>"
   ```

3. **Refresh license:**
   ```bash
   curl -X POST http://localhost:4317/api/billing/license/refresh \
     -H "Authorization: Bearer <your-token>"
   ```

### Issue: "Subscription not found"

**Symptoms:**
- 404 Not Found error
- Error message: "Subscription not found"

**Solutions:**

1. **Get subscription details:**
   ```bash
   curl http://localhost:4317/api/billing/subscription \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Check if you have a subscription:**
   - If no subscription, you're on a trial or free tier
   - Create a subscription via checkout

3. **Contact support:**
   - If subscription exists but not accessible, contact support

---

## Team Collaboration Issues

### Issue: "Invitation expired"

**Symptoms:**
- 400 Bad Request error
- Error message: "Invitation expired"

**Solutions:**

1. **Check invitation expiration:**
   ```bash
   # List invitations
   curl http://localhost:4317/api/auth/invitations \
     -H "Authorization: Bearer <admin-token>"
   ```

2. **Create new invitation:**
   ```bash
   curl -X POST http://localhost:4317/api/auth/invitations \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "email": "newuser@example.com",
       "role": "operator",
       "project_id": "<project-id>"
     }'
   ```

3. **Use invitation within 24 hours:**
   - Invitations expire after 24 hours (`auth/user-store.mjs`)
   - Create a new invitation if expired

### Issue: "Member not found"

**Symptoms:**
- 404 Not Found error
- Error message: "Member not found"

**Solutions:**

1. **List project members:**
   ```bash
   curl http://localhost:4317/api/projects/<project-id>/members \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Verify member ID:**
   - Use correct member ID from the list
   - Member IDs are UUIDs

3. **Check member permissions:**
   - Only admins can manage members
   - Verify you have admin role

### Issue: "Activity feed not loading"

**Symptoms:**
- 500 Internal Server Error
- Error message: "Failed to fetch activity feed"

**Solutions:**

1. **Check database connection:**
   ```bash
   # Verify control plane database exists
   ls -la .ai/control-plane.db

   # Check database integrity
   sqlite3 .ai/control-plane.db "PRAGMA integrity_check;"
   ```

2. **Check activity logger:**
   ```bash
   # Verify activity logger is running
   curl http://localhost:4317/api/activity/stats \
     -H "Authorization: Bearer <your-token>"
   ```

3. **Check project ID:**
   ```bash
   # Verify project exists
   curl http://localhost:4317/api/projects/<project-id> \
     -H "Authorization: Bearer <your-token>"
   ```

---

## Compliance Reporting Issues

### Issue: "Report generation failed"

**Symptoms:**
- 500 Internal Server Error
- Error message: "Report generation failed"

**Solutions:**

1. **Check database size:**
   ```bash
   # Check ledger database size
   ls -lh .ai/ledger.db

   # Check control plane database size
   ls -lh .ai/control-plane.db
   ```

2. **Verify report type:**
   ```bash
   # List available report types
   curl http://localhost:4317/api/compliance/reports \
     -H "Authorization: Bearer <your-token>"
   ```

3. **Check report format:**
   ```bash
   # Supported formats: csv, json (PDF export methods exist in the report classes but
   # aren't wired to any route yet — requesting "pdf" falls through to the JSON response)
   curl -X POST http://localhost:4317/api/compliance/reports/soc2 \
     -H "Authorization: Bearer <your-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "days": 30,
       "format": "csv"
     }'
   ```

### Issue: "Report file not found"

**Symptoms:**
- 404 Not Found error
- Error message: "Report file not found"

**Solutions:**

1. **List generated reports:**
   ```bash
   curl http://localhost:4317/api/compliance/reports \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Check report generation status:**
   - Reports are generated asynchronously
   - Wait a few seconds and retry

3. **Check disk space:**
   ```bash
   # Check available disk space
   df -h

   # Check report directory
   ls -la .ai/reports/
   ```

---

## Performance Issues

### Issue: "Too many requests. Please try again later."

**Symptoms:**
- 429 Too Many Requests error
- Error message: "Too many requests. Please try again later."

**Solutions:**

1. **Check rate limit headers:**
   ```bash
   curl -I http://localhost:4317/api/projects \
     -H "Authorization: Bearer <your-token>"

   # Check X-RateLimit-* headers
   ```

2. **Adjust rate limiting:**
   ```bash
   # Edit policy configuration
   # Increase max requests or window size

   # Restart services
   pkill -f "node dashboard/server.mjs"
   node dashboard/server.mjs &
   ```

3. **Use pagination:**
   ```bash
   # Use limit and offset parameters
   curl http://localhost:4317/api/projects?limit=10&offset=0 \
     -H "Authorization: Bearer <your-token>"
   ```

### Issue: "Dashboard loading slowly"

**Symptoms:**
- Slow page load times
- Timeout errors

**Solutions:**

1. **Check server resources:**
   ```bash
   # Check CPU usage
   top

   # Check memory usage
   free -h

   # Check disk I/O
   iotop
   ```

2. **Optimize database queries:**
   ```bash
   # Check database indexes
   sqlite3 .ai/control-plane.db "SELECT * FROM sqlite_master WHERE type='index';"

   # Rebuild database indexes
   sqlite3 .ai/control-plane.db "REINDEX;"
   ```

3. **Reduce data volume:**
   ```bash
   # Archive old activity logs
   # Clean up old reports
   # Remove unused projects
   ```

---

## Database Issues

### Issue: "Database locked"

**Symptoms:**
- 500 Internal Server Error
- Error message: "Database is locked"

**Solutions:**

1. **Check for concurrent connections:**
   ```bash
   # Check database connections
   sqlite3 .ai/control-plane.db "PRAGMA busy_timeout=5000;"

   # Increase busy timeout
   sqlite3 .ai/control-plane.db "PRAGMA busy_timeout=30000;"
   ```

2. **Restart services:**
   ```bash
   # Stop all services
   pkill -f "node dashboard/server.mjs"
   pkill -f "node gateway/server.mjs"

   # Start services again
   node dashboard/server.mjs &
   node gateway/server.mjs &
   ```

3. **Check database integrity:**
   ```bash
   # Run integrity check
   sqlite3 .ai/control-plane.db "PRAGMA integrity_check;"

   # If errors found, restore from backup
   cp .ai/control-plane.db.backup .ai/control-plane.db
   ```

### Issue: "Database migration failed"

**Symptoms:**
- 500 Internal Server Error
- Error message: "Failed to migrate database schema"

**Solutions:**

1. **Check database version:**
   ```bash
   # Check schema version
   sqlite3 .ai/control-plane.db "PRAGMA user_version;"
   ```

2. **Restore from backup:**
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

3. **Check migration scripts:**
   ```bash
   # Check schema.sql
   cat schema.sql

   # Verify migration scripts exist
   ls -la .ai/migrations/
   ```

---

## OAuth SSO Issues

**Before troubleshooting a specific error below**: OAuth SSO login does not currently complete
end-to-end regardless of configuration. `dashboard/server.mjs`'s OAuth handlers call
`auth/oauth-provider.mjs` methods with the wrong argument count (and one method,
`exchangeCodeForTokens`, that doesn't exist — the real method is `exchangeCode`), and there is no
session store backing the authorize→callback round trip on this server's raw `node:http` stack, so
"check if session cookie is set" below will never find one. Use email/password login or an API key
until this is fixed in code — see [KNOWN-ISSUES.md](KNOWN-ISSUES.md). The sections below are kept
for when that's fixed and for diagnosing config-level problems once it is.

### Issue: "OAuth provider not configured"

**Symptoms:**
- 500 Internal Server Error
- Error message: "OAuth provider not configured"

**Solutions:**

1. **Check OAuth configuration:**
   ```bash
   # Verify OAuth config file exists
   cat .ai/oauth-config.yaml

   # Check provider configuration
   ```

2. **Configure OAuth provider:**
   ```bash
   # Edit OAuth configuration
   # Add provider credentials

   # Restart services
   pkill -f "node dashboard/server.mjs"
   node dashboard/server.mjs &
   ```

3. **Verify provider setup:**
   - Ensure OAuth provider is configured in policy.yaml
   - Verify redirect URI matches exactly
   - Check client ID and secret are correct

### Issue: "OAuth state verification failed"

**Symptoms:**
- 400 Bad Request error
- Error message: "Invalid or missing state parameter"

**Solutions:**

1. **Check state parameter:**
   ```bash
   # Verify state is passed correctly
   curl "http://localhost:4317/api/auth/oauth/google/authorize?state=xyz" \
     -H "Authorization: Bearer <your-token>"
   ```

2. **Check session storage:**
   ```bash
   # Verify session is stored correctly
   # Check if session cookie is set
   ```

3. **Clear browser cookies:**
   - Clear cookies and retry OAuth flow
   - Ensure cookies are enabled

---

## Common Error Messages

### Error: "Failed to connect to database"

**Solution:**
```bash
# Check database file exists
ls -la .ai/control-plane.db

# Check database permissions
chmod 644 .ai/control-plane.db

# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

### Error: "JWT secret not found"

**Solution:**
```bash
# Generate new JWT secret
openssl rand -hex 32 > .ai/auth/jwt-secret

# Set correct permissions
chmod 600 .ai/auth/jwt-secret

# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

### Error: "Stripe secret key not configured"

**Solution:**
```bash
# Edit Stripe configuration
cat .ai/stripe-config.yaml

# Add Stripe secret key
# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

### Error: "Rate limit exceeded"

**Solution:**
```bash
# Edit policy configuration
# Increase rate limit settings

# Restart services
pkill -f "node dashboard/server.mjs"
node dashboard/server.mjs &
```

---

## Getting Help

If you encounter issues not covered in this guide:

1. **Check the logs:**
   ```bash
   # Check dashboard logs
   tail -f logs/dashboard.log

   # Check gateway logs
   tail -f logs/gateway.log
   ```

2. **Review error messages:**
   - Error messages contain detailed information
   - Copy error messages when seeking help

3. **Contact support:**
   - Email: support@meridianos.dev
   - GitHub Issues: https://github.com/gravity-7/meridianos-core/issues

4. **Provide diagnostic information:**
   - Version of MeridianOS
   - Error messages
   - Configuration files
   - Logs

---

**End of Troubleshooting Guide**
