# Changelog

All notable changes to MeridianOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Ecosystem, Distribution & Marketplace (Phase 7)

**Packaged Binary & Desktop App**
- `bun compile` standalone-binary build pipeline (`scripts/build.mjs`) — no Node.js/npm required to run
- Console-based 4-question setup wizard (`scripts/setup-wizard-minimal.mjs`)
- Real OS background service registration — Windows Service (`sc.exe`), macOS launchd, Linux systemd (`scripts/install-service.mjs`)
- System tray icon with live green/yellow/red health status and a quick-action menu (`daemon-entry.mjs`, `tray-status.mjs`, `tray-icons.mjs`)
- Electron desktop app with a GUI setup wizard, OS keychain-backed credential storage (`keytar`), and `electron-updater` auto-updates (`desktop/`)

**Public REST API**
- `/api/v1/*` — tasks, costs, providers, models, config, and webhooks endpoints, scoped `mk-{key}` bearer authentication, per-key sliding-window rate limiting (100 req/min), OpenAPI 3.0 spec + Swagger UI at `/api/v1/docs`
- Webhook delivery with exponential backoff (1s/2x/60s max, 3 retries) and HMAC signing, for `task.created`, `task.completed`, `task.failed`, `budget.warning`, `budget.critical`, `provider.error`, `model.deprecated`, and `cost.spike` events

**Plugin Marketplace**
- 6 pre-built IntakeSource connectors: Jira, Linear, Notion, GitHub Issues, Microsoft Teams, and a configurable Generic Webhook receiver (`intake-adapters/`)
- Plugin install/enable/configure/test-connection lifecycle with contract validation + static security analysis (`plugin-loader.mjs`, `plugin-registry.mjs`)
- Marketplace and Community Plugins dashboard panels

**Community Plugin Development**
- Plugin scaffolding CLI (`node cli.mjs plugin create`) and publishing workflow (`node cli.mjs plugin publish`)
- `docs/plugin-development.md` — full IntakeSource/WireAdapter contract reference

**Hybrid Cloud Control Plane**
- Local cloud agent reporting anonymized usage metadata (token counts, costs, provider health — never API keys or prompt/response content) at a configurable 30-300s interval (`cloud/local-agent.mjs`)
- Cloud control plane with organizations/users/machines, policy push, provider-health aggregation, 90-day metadata retention, and a security audit log (`cloud/cloud-control-plane.mjs`, `cloud/cloud-server.mjs`)
- Opt-in, local-only telemetry counters for installs/plugin-installs/cloud-connections (`telemetry.mjs`) — disabled by default, no network calls

### Fixed
- A pre-existing merge artifact in `dashboard/server.mjs` had left two colliding `handleGetTaskComments` declarations and an orphaned code fragment (missing function signature) that made the file fail to parse; resolved by renaming the project-scoped handler and restoring the orphaned body to its actual owner (`handleGetReviewAssignments`)

## [1.0.0] - 2026-08-02

### Added

#### Enterprise Multi-Tenant Platform

**Authentication & Authorization**
- JWT-based authentication with 30-minute token expiration
- OAuth SSO integration (Azure AD, Google Workspace, GitHub)
- Role-based access control (admin/operator/viewer)
- API key authentication support
- Token refresh mechanism
- Session management

**Multi-Project Management**
- Create, start, stop, restart, and delete projects
- Project isolation with separate databases
- Project health monitoring with resource metrics
- Auto-restart on crash (max 3/hour)
- Project templates (7 pre-configured templates)
- Project management CLI commands

**Team Collaboration**
- User invitations with role assignment
- Team member management (add, update, remove)
- Activity feed with user attribution
- Task comments and notifications
- PR review assignment (round-robin)
- Real-time activity tracking

**Billing & Licensing**
- Stripe integration for subscription management
- License key generation and validation
- Tier enforcement (Free/Pro/Enterprise)
- Feature access control
- Customer portal integration
- Webhook handling for subscription events

**Compliance Reporting**
- SOC2 audit trail reports
- GDPR data flow maps
- Cost allocation reports
- Model usage reports
- Multiple export formats (CSV, JSON, PDF)
- Report generation and download

**Kubernetes Deployment**
- Production-ready Helm charts
- Horizontal Pod Autoscaling (HPA)
- Persistent volume claims (PVC)
- TLS termination with Ingress
- Health checks and readiness probes
- Resource limits and requests

**Dashboard**
- Web-based project management interface
- Real-time project status monitoring
- Activity feed visualization
- Team member management UI
- Billing and subscription management
- Compliance report generation UI

**API**
- RESTful API for all platform features
- Comprehensive API documentation
- Rate limiting (100 requests/minute)
- Error handling with actionable messages
- Webhook support for external integrations

**Security**
- HTTPS support with self-signed certificates
- CSRF protection for OAuth flows
- JWT signature verification
- Rate limiting and throttling
- Role-based access control
- Audit logging for compliance

**Monitoring & Metrics**
- Performance monitoring and metrics collection
- API response time tracking
- Database query performance tracking
- System resource monitoring (CPU, memory, disk)
- Performance alerts and notifications
- Metrics export and reporting

**Documentation**
- Complete API reference
- Migration guide (single-user to multi-tenant)
- Troubleshooting guide
- User documentation
- Kubernetes deployment guide
- Subscription setup guide

### Changed

- Updated policy.yaml schema to include authentication and billing configuration
- Enhanced error messages with actionable remediation steps
- Improved rate limiting with per-IP tracking
- Added comprehensive API documentation
- Enhanced dashboard with multi-tenant features

### Fixed

- Fixed OAuth state verification for CSRF protection
- Fixed JWT token expiration handling
- Fixed database connection pooling
- Fixed rate limiting implementation
- Fixed error message formatting

### Security

- Added JWT secret rotation support
- Enhanced OAuth provider validation
- Improved CSRF protection for all endpoints
- Added rate limiting to prevent abuse
- Implemented audit logging for compliance

### Performance

- Optimized database query performance
- Added database connection pooling
- Implemented metrics collection and monitoring
- Added response time tracking
- Optimized API endpoint performance

### Documentation

- Added comprehensive API documentation
- Created migration guide
- Added troubleshooting guide
- Updated README with multi-tenant features
- Added Kubernetes deployment guide

### Dependencies

- Added Stripe SDK for billing integration
- Added OAuth provider support (no new dependencies)

---

## [0.9.0] - 2026-07-27

### Added

- Initial multi-tenant platform foundation
- Basic project management
- User authentication system
- Database schema for multi-tenant support

### Changed

- Updated policy.yaml schema
- Enhanced control plane functionality

---

## [0.8.0] - 2026-07-20

### Added

- Gateway metering and enforcement
- Provider health monitoring
- Budget tracking and alerts
- Analytics and reporting

### Changed

- Enhanced dashboard functionality
- Improved error handling

---

## [0.7.0] - 2026-07-15

### Added

- Agent harness integration
- Task management system
- Prompt management
- Configuration management

### Changed

- Updated project structure
- Enhanced core functionality

---

## [0.6.0] - 2026-07-10

### Added

- Domain plugin system
- Provider abstraction
- Configuration management

### Changed

- Refactored core architecture
- Improved extensibility

---

## [0.5.0] - 2026-07-05

### Added

- Basic agent orchestration
- Task execution framework
- Prompt management

### Changed

- Updated core functionality
- Improved stability

---

## [0.4.0] - 2026-07-01

### Added

- Initial project structure
- Basic agent management
- Configuration system

### Changed

- Updated core functionality
- Improved stability

---

## [0.3.0] - 2026-06-25

### Added

- Basic agent management
- Configuration system
- Project structure

### Changed

- Updated core functionality
- Improved stability

---

## [0.2.0] - 2026-06-20

### Added

- Initial project structure
- Basic agent management
- Configuration system

### Changed

- Updated core functionality
- Improved stability

---

## [0.1.0] - 2026-06-15

### Added

- Initial project structure
- Basic agent management
- Configuration system

### Changed

- Updated core functionality
- Improved stability

---

## [Unreleased]

### Planned Features

- Telemetry and usage analytics (opt-in)
- Configuration hot-reload for non-critical settings
- Database backup and restore functionality
- Integration tests for edge cases
- Performance testing with 10+ concurrent projects
- Security audit and penetration testing

---

## Versioning

This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- **Major version** (X.0.0): Breaking changes
- **Minor version** (0.X.0): New features, backward compatible
- **Patch version** (0.0.X): Bug fixes, backward compatible

---

## Release Notes

### 1.0.0 - Enterprise Multi-Tenant Platform

The 1.0.0 release introduces the complete enterprise multi-tenant platform for MeridianOS. This release includes:

- Full multi-project management with isolation
- Enterprise-grade authentication and authorization
- Team collaboration features
- Stripe billing integration
- Compliance reporting
- Kubernetes deployment support
- Comprehensive monitoring and metrics
- Complete documentation

This is a major release that transforms MeridianOS from a single-user tool into a full-featured multi-tenant platform suitable for enterprise use.

---

**[Unreleased]:** Future enhancements and bug fixes

**[1.0.0]:** 2026-08-02 - Enterprise multi-tenant platform release

**[0.9.0]:** 2026-07-27 - Multi-tenant foundation

**[0.8.0]:** 2026-07-20 - Enhanced gateway and monitoring

**[0.7.0]:** 2026-07-15 - Agent harness integration

**[0.6.0]:** 2026-07-10 - Domain plugin system

**[0.5.0]:** 2026-07-05 - Basic agent orchestration

**[0.4.0]:** 2026-07-01 - Initial project structure

**[0.3.0]:** 2026-06-25 - Basic agent management

**[0.2.0]:** 2026-06-20 - Initial project structure

**[0.1.0]:** 2026-06-15 - Initial release
