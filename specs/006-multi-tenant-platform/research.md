# Research: Multi-Tenant Platform

**Feature**: Multi-Tenant Platform  
**Date**: 2026-08-01  
**Status**: Complete

## Overview

This document consolidates research findings for technical decisions required to implement the multi-tenant platform. All unknowns from the Technical Context have been resolved through investigation of best practices, existing patterns in the MeridianOS codebase, and industry standards.

---

## Research Topics

### 1. Stripe SDK Integration for Node.js

**Question**: What is the best approach for integrating Stripe billing in a Node.js ES module environment while maintaining security and reliability?

**Decision**: Use `stripe` npm package (v14+) with ES module support

**Rationale**:
- Official Stripe SDK provides secure webhook signature verification
- Handles subscription lifecycle events reliably
- Built-in error handling and retry logic
- ES module support via `import stripe from 'stripe'`
- Type definitions available for better development experience

**Alternatives Considered**:
- Manual API calls with fetch: Rejected due to complexity of webhook signature verification and subscription state management
- Third-party billing wrappers: Rejected due to additional abstraction layer and maintenance burden

**Implementation Notes**:
- Store Stripe secret key in environment variable (`STRIPE_SECRET_KEY`)
- Use webhook signing secret for signature verification (`STRIPE_WEBHOOK_SECRET`)
- Implement idempotency keys for all API calls
- Cache subscription data to reduce API calls

---

### 2. JWT Implementation with Node.js Built-ins

**Question**: How to implement JWT token generation and validation using only Node.js built-ins (no external dependencies)?

**Decision**: Implement JWT using `node:crypto` for HMAC-SHA256 signing

**Rationale**:
- JWT specification is simple (header.payload.signature)
- Node.js `crypto.createHmac()` provides secure HMAC implementation
- Avoids `jsonwebtoken` dependency (zero-dependency philosophy)
- Full control over token claims and expiration logic

**Alternatives Considered**:
- `jsonwebtoken` npm package: Rejected to maintain zero-dependency philosophy
- Session-based auth only: Rejected because API keys require stateless tokens

**Implementation Notes**:
```javascript
import crypto from 'node:crypto';

function generateJWT(payload, secret, expiresIn = '24h') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiration(expiresIn);
  
  const tokenPayload = { ...payload, iat: now, exp };
  const encoded = base64url(JSON.stringify(header)) + '.' + 
                  base64url(JSON.stringify(tokenPayload));
  const signature = crypto.createHmac('sha256', secret)
                         .update(encoded)
                         .digest('base64url');
  
  return encoded + '.' + signature;
}

function verifyJWT(token, secret) {
  const [headerB64, payloadB64, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret)
                       .update(headerB64 + '.' + payloadB64)
                       .digest('base64url');
  
  if (signature !== expected) throw new Error('Invalid signature');
  
  const payload = JSON.parse(base64urlDecode(payloadB64));
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  
  return payload;
}
```

---

### 3. Password Hashing with crypto.scrypt

**Question**: How to implement secure password hashing using Node.js built-in crypto.scrypt instead of bcrypt?

**Decision**: Use `crypto.scrypt()` with salt and appropriate parameters (N=16384, r=8, p=1)

**Rationale**:
- `crypto.scrypt()` is a memory-hard KDF resistant to GPU/ASIC attacks
- Node.js built-in, no external dependency
- Comparable security to bcrypt when properly configured
- Recommended by OWASP for password hashing

**Alternatives Considered**:
- `bcrypt` npm package: Rejected to maintain zero-dependency philosophy
- `crypto.pbkdf2()`: Rejected because scrypt is more memory-hard and resistant to specialized hardware attacks

**Implementation Notes**:
```javascript
import crypto from 'node:crypto';

async function hashPassword(password, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
  return `${salt}:${derivedKey}`;
}

async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
  return key === derivedKey;
}
```

---

### 4. OIDC Integration Patterns

**Question**: How to implement optional OIDC SSO integration for enterprise customers?

**Decision**: Implement OIDC using standard OAuth 2.0 authorization code flow with PKCE

**Rationale**:
- Industry-standard protocol supported by Azure AD, Google Workspace, GitHub OAuth
- PKCE (Proof Key for Code Exchange) provides security without client secret
- Can be implemented with Node.js built-in `https` module
- Optional feature - doesn't affect core functionality

**Alternatives Considered**:
- SAML 2.0: Rejected due to complexity and XML parsing requirements
- Custom auth providers: Rejected due to maintenance burden

**Implementation Notes**:
- Support Azure AD, Google Workspace, GitHub OAuth out of the box
- Store provider configurations in policy.yaml
- Implement PKCE using `crypto.randomBytes()` and SHA-256
- Map provider claims to MeridianOS user roles
- Cache provider tokens to reduce API calls

---

### 5. Kubernetes Helm Chart Best Practices

**Question**: What are the best practices for creating production-ready Helm charts for a multi-component application?

**Decision**: Follow Helm chart best practices with separate deployments for gateway, daemon, and dashboard

**Rationale**:
- Separation of concerns allows independent scaling
- StatefulSet for daemon ensures single instance with leader election
- HPA for gateway and dashboard enables autoscaling
- ConfigMaps and Secrets separate configuration from code
- Ingress with TLS provides secure external access

**Alternatives Considered**:
- Single deployment for all components: Rejected due to scaling limitations
- Docker Compose for Kubernetes: Rejected due to limited feature set

**Implementation Notes**:
- Use Helm 3 (no Tiller)
- Implement health checks and readiness probes
- Use persistent volume claims for SQLite data
- Configure resource limits and requests
- Support multiple environments via values.yaml overrides
- Include Helm tests for connectivity verification

---

### 6. SOC2/GDPR Compliance Reporting Requirements

**Question**: What data and format are required for SOC2 audit trails and GDPR data flow mapping?

**Decision**: Implement comprehensive audit logging with structured data export in CSV/JSON/PDF formats

**Rationale**:
- SOC2 requires: access logs, change logs, authentication logs, data access tracking
- GDPR requires: data flow mapping, retention periods, data categories, processing regions
- Structured logging enables automated report generation
- Multiple export formats support different stakeholder needs

**Alternatives Considered**:
- Third-party compliance tools: Rejected due to cost and integration complexity
- Manual report generation: Rejected due to error-proneness and scalability issues

**Implementation Notes**:
- Dedicated `audit_log` table separate from operational logs
- Immutable append-only log (no updates/deletes)
- Track: user, timestamp, action, target_type, target_id, ip_address, outcome
- GDPR data flow: extract from token_events with provider region mapping
- Cost allocation: aggregate by department/project tags
- Model usage: analyze task completion rates and costs per model

---

### 7. Multi-Process Project Supervision Patterns

**Question**: How to implement reliable multi-process project supervision with auto-restart and health monitoring?

**Decision**: Extend existing `control-plane.mjs` with child process management and health checks

**Rationale**:
- Node.js `child_process` module provides process spawning and monitoring
- Existing control-plane architecture can be extended
- Health checks via HTTP heartbeat to project dashboard
- Auto-restart with exponential backoff prevents restart loops

**Alternatives Considered**:
- PM2 process manager: Rejected due to additional dependency
- Docker containers per project: Rejected due to overhead and complexity

**Implementation Notes**:
- Use `child_process.spawn()` with detached: true for project processes
- Implement health check via HTTP GET to `localhost:{port}/health`
- Track restart count per project (max 3 per hour)
- Resource monitoring via `process.cpuUsage()` and `process.memoryUsage()`
- Graceful shutdown via SIGTERM with timeout

---

### 8. SQLite Multi-Tenant Isolation Strategies

**Question**: How to achieve proper data isolation between multiple projects using SQLite?

**Decision**: Separate database files per project with shared gateway ledger using tenant labels

**Rationale**:
- Complete isolation: each project has its own `.ai/projects/{id}/state/aios.db`
- Shared gateway: single ledger with `tenant` column for cost attribution
- WAL mode enables concurrent reads
- Simpler than row-level security or schema-based isolation

**Alternatives Considered**:
- Single database with row-level security: Rejected due to SQLite limitations
- Schema-based isolation: Rejected due to complexity and migration challenges

**Implementation Notes**:
- Project databases: `.ai/projects/{projectId}/state/aios.db`
- Gateway ledger: shared with `tenant` column in `token_events`
- Use WAL mode for all databases: `PRAGMA journal_mode=WAL`
- Implement connection pooling per project
- Backup strategy: per-project snapshots

---

## Summary

All technical unknowns have been resolved through research. Key decisions:

1. **Stripe SDK**: Use official `stripe` npm package for billing integration
2. **JWT**: Implement with Node.js `crypto` module (no external dependency)
3. **Password Hashing**: Use `crypto.scrypt()` (no bcrypt dependency)
4. **OIDC**: Implement OAuth 2.0 with PKCE using Node.js built-ins
5. **Kubernetes**: Production-ready Helm charts with HPA and persistent storage
6. **Compliance**: Structured audit logging with multi-format export
7. **Process Supervision**: Extend control-plane with child process management
8. **Multi-Tenancy**: Separate databases per project, shared ledger with tenant labels

**Constitution Compliance**: All decisions align with MeridianOS principles:
- Zero-dependency philosophy maintained (except Stripe SDK, justified)
- Configuration over code (all behavior controlled via policy.yaml)
- Gateway as single source of truth (shared with tenant labeling)
- ES modules and modern JavaScript throughout

**Next Steps**: Proceed to Phase 1 (Design & Contracts) to create data model, API contracts, and quickstart guide.