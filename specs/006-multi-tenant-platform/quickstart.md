# Quickstart Guide: Multi-Tenant Platform

**Feature**: Multi-Tenant Platform  
**Date**: 2026-08-01  
**Version**: 1.0

## Overview

This guide provides runnable validation scenarios to verify the multi-tenant platform implementation. Each scenario includes prerequisites, setup commands, test/run commands, and expected outcomes.

---

## Prerequisites

- Node.js 24+ installed
- MeridianOS repository cloned
- Stripe test mode account (for billing scenarios)
- Kubernetes cluster (for K8s deployment scenarios)

---

## Scenario 1: Multi-Project Management

**Objective**: Verify control plane can manage multiple concurrent projects with isolated state.

### Setup

```bash
# Clone repository and install dependencies
git clone https://github.com/gravity-7/meridianos-core.git
cd meridianos-core
npm install

# Start control plane
node control-plane.mjs
```

### Test Commands

```bash
# Create first project from template
curl -X POST http://localhost:4317/api/projects/ \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Project Alpha",
    "template": "saas-web-app"
  }'

# Create second project from template
curl -X POST http://localhost:4317/api/projects/ \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Project Beta",
    "template": "mobile-app"
  }'

# Start both projects
curl -X POST http://localhost:4317/api/projects/{project_alpha_id}/start \
  -H "Authorization: Bearer {admin_token}"

curl -X POST http://localhost:4317/api/projects/{project_beta_id}/start \
  -H "Authorization: Bearer {admin_token}"

# List all projects
curl http://localhost:4317/api/projects/ \
  -H "Authorization: Bearer {admin_token}"
```

### Expected Outcomes

- Both projects created successfully with unique IDs
- Both projects start and show status "running"
- Project list shows 2 projects with different ports
- Each project has isolated state databases
- Dashboard accessible at different ports (e.g., :4318, :4319)

### Validation

```bash
# Verify project isolation
sqlite3 .ai/projects/{project_alpha_id}/state/aios.db "SELECT COUNT(*) FROM tasks"
sqlite3 .ai/projects/{project_beta_id}/state/aios.db "SELECT COUNT(*) FROM tasks"

# Verify shared gateway with tenant labeling
sqlite3 .ai/gateway/ledger.db "SELECT tenant, COUNT(*) FROM token_events GROUP BY tenant"
```

---

## Scenario 2: Authentication and Authorization

**Objective**: Verify user authentication, JWT tokens, and role-based access control.

### Setup

```bash
# Start control plane with authentication enabled
node control-plane.mjs --auth-enabled
```

### Test Commands

```bash
# Create admin user
curl -X POST http://localhost:4317/api/auth/users \
  -H "Authorization: Bearer {system_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!",
    "full_name": "Admin User",
    "role": "admin"
  }'

# Login with email/password
curl -X POST http://localhost:4317/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePass123!"
  }'

# Save JWT token from response
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get current user info
curl http://localhost:4317/api/auth/me \
  -H "Authorization: Bearer $JWT_TOKEN"

# Create operator user
curl -X POST http://localhost:4317/api/auth/users \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "operator@example.com",
    "password": "SecurePass456!",
    "full_name": "Operator User",
    "role": "operator",
    "project_id": "{project_id}"
  }'

# Login as operator
curl -X POST http://localhost:4317/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "operator@example.com",
    "password": "SecurePass456!"
  }'

# Save operator JWT token
export OPERATOR_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Test RBAC: Operator should NOT be able to create users
curl -X POST http://localhost:4317/api/auth/users \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!"
  }'
```

### Expected Outcomes

- Admin user created successfully
- Login returns JWT token with user info and roles
- `/me` endpoint returns current user details
- Operator user created successfully
- Operator login returns JWT token with operator role
- Operator attempt to create user returns 403 Forbidden

### Validation

```bash
# Verify JWT token structure
echo $JWT_TOKEN | cut -d'.' -f2 | base64 -d | jq

# Verify password hashing in database
sqlite3 .ai/control-plane.db "SELECT email, password_hash FROM users WHERE email='admin@example.com'"

# Verify role assignment
sqlite3 .ai/control-plane.db "SELECT user_id, project_id, role FROM project_users"
```

---

## Scenario 3: Team Collaboration

**Objective**: Verify team member invitations, activity feed, and task comments.

### Setup

```bash
# Start control plane with authentication enabled
node control-plane.mjs --auth-enabled

# Create a project
curl -X POST http://localhost:4317/api/projects/ \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Team Project",
    "template": "saas-web-app"
  }'
```

### Test Commands

```bash
# Invite team member
curl -X POST http://localhost:4317/api/auth/invitations \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teammate@example.com",
    "project_id": "{project_id}",
    "role": "operator"
  }'

# Save invitation link from response
export INVITE_LINK="http://localhost:4317/invite/abc123def456"

# Accept invitation (in browser or via API)
curl -X POST http://localhost:4317/api/auth/invitations/abc123def456/accept \
  -H "Content-Type: application/json" \
  -d '{
    "password": "TeamPass789!",
    "full_name": "Teammate User"
  }'

# Login as teammate
curl -X POST http://localhost:4317/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teammate@example.com",
    "password": "TeamPass789!"
  }'

# Save teammate JWT token
export TEAMMATE_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# List project members
curl http://localhost:4317/api/projects/{project_id}/members \
  -H "Authorization: Bearer $JWT_TOKEN"

# Get activity feed
curl http://localhost:4317/api/projects/{project_id}/activity \
  -H "Authorization: Bearer $JWT_TOKEN"

# Add task comment
curl -X POST http://localhost:4317/api/projects/{project_id}/tasks/{task_id}/comments \
  -H "Authorization: Bearer $TEAMMATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "I'll review this task tomorrow."
  }'
```

### Expected Outcomes

- Invitation created successfully with invite link
- Teammate accepts invitation and sets password
- Teammate can login and access project
- Project members list shows both users with correct roles
- Activity feed shows invitation, acceptance, and comment events
- Task comment created successfully

### Validation

```bash
# Verify invitation in database
sqlite3 .ai/control-plane.db "SELECT email, role, status, updated_at FROM invitations"

# Verify activity feed
sqlite3 .ai/control-plane.db "SELECT action, user_id, timestamp FROM activity_log ORDER BY timestamp DESC LIMIT 10"

# Verify task comment
sqlite3 .ai/projects/{project_id}/state/aios.db "SELECT user_id, content FROM task_comments"
```

---

## Scenario 4: Project Templates

**Objective**: Verify project templates create correctly configured projects.

### Setup

```bash
# Start control plane
node control-plane.mjs
```

### Test Commands

```bash
# List available templates
curl http://localhost:4317/api/projects/templates

# Get template details
curl http://localhost:4317/api/projects/templates/saas-web-app

# Create project from SaaS template
curl -X POST http://localhost:4317/api/projects/ \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SaaS App from Template",
    "template": "saas-web-app"
  }'

# Create project from Mobile template
curl -X POST http://localhost:4317/api/projects/ \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mobile App from Template",
    "template": "mobile-app"
  }'

# Start projects
curl -X POST http://localhost:4317/api/projects/{saas_project_id}/start \
  -H "Authorization: Bearer $JWT_TOKEN"

curl -X POST http://localhost:4317/api/projects/{mobile_project_id}/start \
  -H "Authorization: Bearer $JWT_TOKEN"

# Verify project configurations
curl http://localhost:4317/api/projects/{saas_project_id}/config \
  -H "Authorization: Bearer $JWT_TOKEN"

curl http://localhost:4317/api/projects/{mobile_project_id}/config \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Expected Outcomes

- Template list shows 7 templates (saas-web-app, mobile-app, cli-tool, library-sdk, documentation-site, data-pipeline, blank)
- Template details show agents, categories, and model routing
- Projects created from templates boot with correct configurations
- SaaS project has 3 agents (builder, reviewer, designer)
- Mobile project has 3 agents with React Native-specific prompts
- Both projects have appropriate task categories

### Validation

```bash
# Verify agent roster in project database
sqlite3 .ai/projects/{saas_project_id}/state/aios.db "SELECT name, harness, default_tier FROM agents"

# Verify task categories
sqlite3 .ai/projects/{saas_project_id}/state/aios.db "SELECT name FROM categories"

# Verify model routing
cat .ai/projects/{saas_project_id}/policy.yaml | grep -A 20 "model_routing"
```

---

## Scenario 5: Stripe Billing Integration

**Objective**: Verify Stripe checkout, license generation, and tier enforcement.

### Setup

```bash
# Set Stripe test mode keys
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."

# Start control plane with billing enabled
node control-plane.mjs --billing-enabled
```

### Test Commands

```bash
# Create checkout session for Pro tier
curl -X POST http://localhost:4317/api/billing/checkout \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "pro",
    "success_url": "http://localhost:4317/billing/success",
    "cancel_url": "http://localhost:4317/billing/cancel"
  }'

# Open checkout URL in browser to complete purchase
# After purchase, Stripe sends webhook to /api/billing/webhook/stripe

# Get license status
curl http://localhost:4317/api/billing/license \
  -H "Authorization: Bearer $JWT_TOKEN"

# Validate license key manually
curl -X POST http://localhost:4317/api/billing/license/validate \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "license_key": "mer-ABCD-1234-EFGH-5678"
  }'

# Check feature access
curl -X POST http://localhost:4317/api/billing/check-feature \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "feature": "unlimited_agents"
  }'

# Get tier limits
curl http://localhost:4317/api/billing/limits \
  -H "Authorization: Bearer $JWT_TOKEN"

# Get customer portal URL
curl "http://localhost:4317/api/billing/portal?return_url=http://localhost:4317" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Expected Outcomes

- Checkout session created successfully with Stripe URL
- After purchase, webhook generates license key
- License status shows Pro tier with features
- License validation succeeds
- Feature check returns allowed=true for Pro features
- Tier limits show unlimited agents, 5 users max
- Customer portal URL returned successfully

### Validation

```bash
# Verify license in database
sqlite3 .ai/control-plane.db "SELECT tier, status, features FROM licenses"

# Verify license key format
echo "mer-ABCD-1234-EFGH-5678" | grep -E "^mer-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$"

# Verify Stripe customer/subscription IDs
sqlite3 .ai/control-plane.db "SELECT customer_id, subscription_id FROM licenses"
```

---

## Scenario 6: Kubernetes Deployment

**Objective**: Verify Helm chart deployment and autoscaling.

### Setup

```bash
# Install Helm (if not installed)
# macOS: brew install helm
# Linux: curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Add kubectl context to your Kubernetes cluster
kubectl config use-context your-cluster

# Build Docker images (if needed)
docker build -t meridianos-gateway:latest -f docker/gateway/Dockerfile .
docker build -t meridianos-daemon:latest -f docker/daemon/Dockerfile .
docker build -t meridianos-dashboard:latest -f docker/dashboard/Dockerfile .
```

### Test Commands

```bash
# Install MeridianOS via Helm
helm install meridianos ./deploy/helm/meridianos \
  --values deploy/helm/meridianos/values.yaml \
  --set gateway.image.tag=latest \
  --set daemon.image.tag=latest \
  --set dashboard.image.tag=latest

# Verify all pods are running
kubectl get pods -l app=meridianos

# Verify services
kubectl get services -l app=meridianos

# Verify ingress
kubectl get ingress meridianos-dashboard

# Port-forward to dashboard locally
kubectl port-forward svc/meridianos-dashboard 4317:4317

# Access dashboard
open http://localhost:4317

# Generate load on gateway to test HPA
kubectl run -i --tty load-generator --image=busybox /bin/sh
# Inside container: while true; do wget -q -O- http://meridianos-gateway/health; done

# Watch HPA scale up
kubectl get hpa meridianos-gateway -w

# Check scaled pods
kubectl get pods -l app=meridianos-gateway

# Verify persistent volume claims
kubectl get pvc -l app=meridianos

# Verify ConfigMaps
kubectl get configmap -l app=meridianos

# Verify Secrets
kubectl get secret -l app=meridianos
```

### Expected Outcomes

- Helm chart installs successfully
- All pods (gateway, daemon, dashboard) are running
- Services are created and accessible
- Ingress routes external traffic to dashboard
- Dashboard accessible via HTTPS with valid certificate
- Gateway HPA scales up under load (1 → 10 pods)
- Persistent volume claims are bound
- ConfigMaps contain policy.yaml configuration
- Secrets contain API keys and TLS certificates

### Validation

```bash
# Run Helm tests
helm test meridianos

# Check pod logs
kubectl logs -l app=meridianos-gateway --tail=50
kubectl logs -l app=meridianos-daemon --tail=50
kubectl logs -l app=meridianos-dashboard --tail=50

# Verify data persistence
kubectl exec -it meridianos-daemon-0 -- sqlite3 /data/state/aios.db "SELECT COUNT(*) FROM tasks"

# Scale down and verify data persists
kubectl scale deployment meridianos-gateway --replicas=1
kubectl get pods -l app=meridianos-gateway
```

---

## Scenario 7: Compliance Reporting

**Objective**: Verify SOC2, GDPR, and compliance report generation.

### Setup

```bash
# Start control plane with compliance enabled
node control-plane.mjs --compliance-enabled

# Generate some activity data
# (Run previous scenarios to create users, projects, tasks, etc.)
```

### Test Commands

```bash
# Generate SOC2 audit trail report
curl -X POST http://localhost:4317/api/compliance/reports/soc2 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2026-07-01",
    "end_date": "2026-07-31",
    "format": "csv"
  }'

# Generate GDPR data flow report
curl -X POST http://localhost:4317/api/compliance/reports/gdpr \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2026-07-01",
    "end_date": "2026-07-31",
    "format": "json"
  }'

# Generate cost allocation report
curl -X POST http://localhost:4317/api/compliance/reports/cost-allocation \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2026-07-01",
    "end_date": "2026-07-31",
    "group_by": "department",
    "format": "csv"
  }'

# Generate model usage report
curl -X POST http://localhost:4317/api/compliance/reports/model-usage \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2026-07-01",
    "end_date": "2026-07-31",
    "format": "pdf"
  }'

# List available reports
curl http://localhost:4317/api/compliance/reports \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Expected Outcomes

- SOC2 report generated with access logs, change logs, auth logs
- GDPR report generated with data flows, provider regions, retention periods
- Cost allocation report generated with per-department breakdown
- Model usage report generated with success rates and cost efficiency
- Reports generated in under 30 seconds for 30-day ranges
- Report generation logged in audit log
- Only admin users can generate reports

### Validation

```bash
# Verify audit log entries
sqlite3 .ai/control-plane.db "SELECT action, user_id, timestamp FROM audit_log WHERE action='report.generated'"

# Verify report files exist
ls -lh .ai/reports/

# Verify SOC2 report content
head -20 .ai/reports/soc2-2026-07-01-to-2026-07-31.csv

# Verify GDPR report structure
cat .ai/reports/gdpr-2026-07-01-to-2026-07-31.json | jq '.data_flows[0]'
```

---

## Performance Validation

### Scenario 8: Concurrent Project Performance

**Objective**: Verify system handles 10+ concurrent projects without degradation.

### Test Commands

```bash
# Create 10 projects
for i in {1..10}; do
  curl -X POST http://localhost:4317/api/projects/ \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"Load Test Project $i\",
      \"template\": \"blank\"
    }"
done

# Start all projects
for i in {1..10}; do
  curl -X POST http://localhost:4317/api/projects/load-test-project-$i/start \
    -H "Authorization: Bearer $JWT_TOKEN"
done

# Monitor system resources
watch -n 1 'ps aux | grep node | grep -v grep'

# Check project health
for i in {1..10}; do
  curl http://localhost:4317/api/projects/load-test-project-$i/health \
    -H "Authorization: Bearer $JWT_TOKEN"
done
```

### Expected Outcomes

- All 10 projects created and started successfully
- System CPU usage remains < 80%
- System memory usage remains < 2GB
- All projects show "healthy" status
- Dashboard responsive with < 2s page load times

---

## Troubleshooting

### Common Issues

**Issue**: Projects fail to start with "port already in use" error
**Solution**: Check port allocation in control plane configuration, ensure ports 4318-4330 are available

**Issue**: JWT token validation fails
**Solution**: Verify JWT secret exists at `.ai/auth/jwt-secret`, check token expiration

**Issue**: Stripe webhook signature verification fails
**Solution**: Verify `STRIPE_WEBHOOK_SECRET` environment variable is set correctly

**Issue**: Kubernetes pods fail to start
**Solution**: Check pod logs: `kubectl logs -l app=meridianos`, verify image pull secrets

**Issue**: Compliance reports take > 30 seconds
**Solution**: Check database indexes, ensure audit_log table has proper indexes on timestamp

---

## Summary

This quickstart guide provides comprehensive validation scenarios for all multi-tenant platform features:

1. ✅ Multi-project management with isolated state
2. ✅ Authentication and authorization with RBAC
3. ✅ Team collaboration with invitations and activity feeds
4. ✅ Project templates with pre-configured setups
5. ✅ Stripe billing integration with tier enforcement
6. ✅ Kubernetes deployment with autoscaling
7. ✅ Compliance reporting for SOC2/GDPR
8. ✅ Performance validation with 10+ concurrent projects

All scenarios include setup commands, test commands, expected outcomes, and validation steps. Run these scenarios to verify the multi-tenant platform implementation meets all requirements.