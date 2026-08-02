# Implementation Plan: Multi-Tenant Platform

**Branch**: `006-multi-tenant-platform` | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-multi-tenant-platform/spec.md`

## Summary

Transform MeridianOS from a single-user tool into a commercial-grade multi-tenant platform supporting multiple concurrent projects, team collaboration, remote dashboard access with authentication, subscription billing, Kubernetes deployment, and compliance reporting. The implementation extends the existing control plane architecture, adds authentication/authorization layers, integrates Stripe for billing, and provides enterprise deployment artifacts.

## Technical Context

**Language/Version**: Node.js 24+ (ES modules, .mjs extension)

**Primary Dependencies**: better-sqlite3 (existing), Node.js built-ins (crypto, net, http, https, stream, fs, path)

**Storage**: SQLite with WAL mode for multi-project isolation, separate databases per project, shared gateway ledger with tenant labeling

**Testing**: Node.js native test runner (node --test), cassette system for LLM mocking, integration tests for auth/billing

**Target Platform**: Cross-platform (Windows, macOS, Linux) + Kubernetes (Helm charts)

**Project Type**: Web service (dashboard + control plane) + CLI tool + DevOps artifacts (Helm charts, deployment manifests)

**Performance Goals**:
- 10+ concurrent projects without performance degradation
- Remote dashboard authentication completes in under 2 seconds
- Project auto-restart within 10 seconds (95% of cases)
- License validation completes in under 500ms with 24-hour offline cache
- Kubernetes scaling from 1 to 10 gateway pods within 2 minutes under load
- Compliance reports generate in under 30 seconds for 30-day ranges with 10,000+ events

**Constraints**:
- Zero-dependency philosophy (only better-sqlite3 as external runtime dependency)
- Configuration over code (behavior controlled by policy.yaml)
- Gateway as single source of truth for all AI traffic
- ES modules exclusively (no require/module.exports)
- Test-first discipline with 915+ passing tests

**Scale/Scope**:
- Support 10+ concurrent projects per control plane instance
- Multi-user teams with role-based access control
- Enterprise deployment with Kubernetes and compliance reporting
- Subscription billing with tier enforcement (Free/Pro/Enterprise)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Provider & Model Agnosticism (NON-NEGOTIABLE)
✅ **PASS**: Multi-tenant platform does not introduce provider-specific code. All provider/model configuration remains declarative via policy.yaml and provider registry.

### II. Gateway as Single Source of Truth (NON-NEGOTIABLE)
✅ **PASS**: All projects route through shared gateway instance. Ledger entries tagged with tenant labels for cost isolation. No bypass paths introduced.

### III. Zero-Dependency Philosophy
⚠️ **VIOLATION**: Stripe SDK and bcrypt library may be needed for billing and password hashing.
**Justification**: 
- Stripe SDK: Required for secure webhook signature verification and subscription management. Cannot be implemented with Node.js built-ins due to cryptographic signature verification complexity.
- bcrypt: Password hashing requires industry-standard algorithm. Node.js crypto.scrypt can be used as alternative to avoid dependency.
**Decision**: Use Node.js built-in crypto.scrypt for password hashing (no bcrypt dependency). Stripe SDK will be the single additional dependency for billing, justified by security requirements.

### IV. Test-First Discipline
✅ **PASS**: All new features will have tests written before implementation. Existing 915 tests must continue passing.

### V. Configuration over Code
✅ **PASS**: All multi-tenant behavior controlled via policy.yaml extensions (projects, auth, billing, compliance). No hardcoded feature switches.

### VI. Observability & Auditability
✅ **PASS**: Activity feed and audit log provide comprehensive tracking. All actions logged with user attribution and timestamps.

### VII. Non-Technical Usability
✅ **PASS**: Browser-first setup wizard, project templates, and self-service billing portal maintain non-technical usability.

### VIII. ES Modules & Modern JavaScript
✅ **PASS**: All new code uses .mjs extension with import/export syntax.

### IX. PR Discipline & Code Review
✅ **PASS**: All changes will follow PR discipline with proper branching and review process.

### X. Spec-Driven Development
✅ **PASS**: This plan follows the spec-kit workflow (spec → plan → tasks → implement).

**GATE STATUS**: ✅ **PASS** (with justified dependency exception for Stripe SDK)

## Project Structure

### Documentation (this feature)

```text
specs/006-multi-tenant-platform/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── auth-api.md      # Authentication API contracts
│   ├── control-plane-api.md  # Control plane API contracts
│   └── billing-api.md   # Stripe billing integration contracts
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
# Multi-tenant platform extensions
auth/                          # NEW: Authentication and authorization
├── auth.mjs                   # Authentication middleware
├── user-store.mjs             # User CRUD operations
├── api-tokens.mjs             # API key management
├── jwt.mjs                    # JWT token generation/validation
└── oauth-provider.mjs         # Optional OIDC integration

licensing/                     # NEW: License and billing
├── license-validate.mjs       # License key validation
├── license-refresh.mjs        # License heartbeat/refresh
├── stripe-webhook.mjs         # Stripe webhook handler
└── license-key.mjs            # RSA key generation/validation

compliance/                    # NEW: Compliance reporting
├── audit-log.mjs              # Dedicated compliance event log
└── reports/
    ├── soc2.mjs               # SOC2 audit trail reports
    ├── gdpr.mjs               # GDPR data flow reports
    ├── cost-allocation.mjs    # Cost allocation reports
    └── model-usage.mjs        # Model usage reports

templates/                     # NEW: Project templates
├── saas-web-app.yaml
├── mobile-app.yaml
├── cli-tool.yaml
├── library-sdk.yaml
├── documentation-site.yaml
├── data-pipeline.yaml
└── blank.yaml

deploy/                        # NEW: Deployment artifacts
└── kubernetes/
    ├── README.md
    └── helm/
        └── meridianos/
            ├── Chart.yaml
            ├── values.yaml
            └── templates/
                ├── gateway-deployment.yaml
                ├── daemon-statefulset.yaml
                ├── dashboard-deployment.yaml
                ├── pvc.yaml
                ├── configmap.yaml
                ├── secret.yaml
                ├── ingress.yaml
                └── service.yaml

# Existing modules to extend
control-plane.mjs              # EXTEND: Multi-project supervision
dashboard/
├── server.mjs                 # EXTEND: Auth middleware, project APIs
├── index.html                 # EXTEND: Login page, projects panel, team panel
└── static/
    ├── projects-panel.mjs     # NEW: Project management UI
    ├── team-panel.mjs         # NEW: Team collaboration UI
    ├── templates-panel.mjs    # NEW: Template gallery UI
    └── billing-panel.mjs      # NEW: Subscription management UI

gateway/
├── ledger-schema.sql          # EXTEND: Tenant labeling, audit tables
└── server.mjs                 # EXTEND: Tenant-aware routing

tests/
├── auth/                      # NEW: Authentication tests
├── licensing/                 # NEW: License validation tests
├── compliance/                # NEW: Report generation tests
└── integration/               # NEW: Multi-project integration tests
```

**Structure Decision**: Multi-module extension approach. New modules (auth/, licensing/, compliance/, templates/, deploy/) encapsulate multi-tenant functionality. Existing modules (control-plane.mjs, dashboard/, gateway/) are extended with tenant-aware features. This maintains separation of concerns while minimizing disruption to existing single-user code paths.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Stripe SDK dependency | Secure webhook signature verification and subscription management require cryptographic operations that are error-prone to implement with Node.js built-ins | Manual webhook verification would be security-critical and prone to implementation bugs; Stripe SDK is battle-tested and maintained by Stripe |