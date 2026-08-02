# Feature Specification: Multi-Tenant Platform

**Feature Branch**: `[P6-multi-tenant-platform]`

**Created**: 2026-08-01

**Status**: Draft

**Input**: User description: "specs/006-multi-tenant-platform"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Multi-Project Management (Priority: P1)

As a platform operator, I want to manage multiple MeridianOS projects from a single control plane so that I can oversee all AI development work across my organization without running separate instances.

**Why this priority**: This is the foundational capability that enables all other multi-tenant features. Without it, users must run separate MeridianOS instances manually, which is operationally expensive and error-prone.

**Independent Test**: Can be fully tested by creating multiple projects, verifying they run concurrently with isolated state, and confirming the control plane can start/stop/restart them independently.

**Acceptance Scenarios**:

1. **Given** a control plane is running, **When** I create three projects with different configurations, **Then** all three projects start successfully and run concurrently with independent boards, agents, and budgets
2. **Given** multiple projects are running, **When** one project crashes, **Then** the control plane automatically restarts it within 10 seconds while other projects continue unaffected
3. **Given** the control plane dashboard is open, **When** I view the projects list, **Then** I see all projects with their health status, agent count, task count, and current spend
4. **Given** a project is consuming excessive resources, **When** I stop that project via the control plane, **Then** only that project stops while others continue running

---

### User Story 2 - Remote Dashboard Access with Authentication (Priority: P1)

As a team member working remotely, I want to securely access the MeridianOS dashboard from any location with proper authentication so that I can monitor AI spend, manage tasks, and collaborate with my team regardless of my physical location.

**Why this priority**: Remote access is essential for distributed teams and cloud deployments. Without authentication, the dashboard cannot be safely exposed outside localhost.

**Independent Test**: Can be fully tested by configuring HTTPS, creating users with different roles, and verifying that authentication and authorization work correctly from remote machines.

**Acceptance Scenarios**:

1. **Given** the dashboard is configured with HTTPS, **When** I access it from a remote machine, **Then** I am presented with a login page and can authenticate with valid credentials
2. **Given** I have a viewer role, **When** I attempt to modify configuration settings, **Then** the request is denied with a 403 error
3. **Given** I have an admin role, **When** I generate an API key with operator scope, **Then** the key can perform task management operations but cannot modify user accounts
4. **Given** I am logged in, **When** my session is inactive for 30 minutes, **Then** I am automatically logged out and must re-authenticate

---

### User Story 3 - Team Collaboration (Priority: P2)

As a team lead, I want to invite team members to projects, assign them appropriate roles, and track all activity so that I can maintain oversight of AI development work while enabling collaborative task management.

**Why this priority**: Collaboration features transform MeridianOS from a single-user tool to a team platform, which is critical for enterprise adoption.

**Independent Test**: Can be fully tested by inviting users, assigning roles, creating tasks, and verifying that activity feeds and notifications work correctly across multiple users.

**Acceptance Scenarios**:

1. **Given** I am an admin, **When** I invite a team member by email with operator role, **Then** they receive an invitation link and can set their password to access the project
2. **Given** multiple users are working on the same project, **When** any user performs an action (creates task, completes task, modifies config), **Then** the action appears in the activity feed with user attribution and timestamp
3. **Given** a task is assigned to me, **When** another user adds a comment to that task, **Then** I receive a notification and can view the comment in the task detail panel
4. **Given** an agent creates a pull request, **When** the PR is ready for review, **Then** a reviewer is automatically assigned from the team roster and receives a notification

---

### User Story 4 - Project Templates (Priority: P2)

As a new user, I want to start with pre-configured project templates so that I can begin AI development work immediately without manually configuring agents, prompts, and task categories.

**Why this priority**: Templates dramatically reduce onboarding time and ensure best practices are followed from the start.

**Independent Test**: Can be fully tested by creating projects from each template and verifying they boot with correct configurations and can complete test tasks.

**Acceptance Scenarios**:

1. **Given** I am creating a new project, **When** I select the "SaaS Web App" template, **Then** the project boots with 3 pre-configured agents (builder, reviewer, designer) and appropriate task categories
2. **Given** I select the "Blank" template, **When** the project boots, **Then** it has minimal configuration (1 agent, basic categories) and I can customize everything from scratch
3. **Given** I use the "Mobile App" template, **When** I run a test task, **Then** the builder agent uses React Native-specific prompts and the designer agent focuses on mobile UI/UX
4. **Given** I have a custom template URL, **When** I import it during project creation, **Then** the project boots with the custom configuration

---

### User Story 5 - Stripe Billing Integration (Priority: P1)

As a platform operator, I want to integrate Stripe billing so that users can purchase subscriptions, manage their plans, and have their license tier enforced automatically.

**Why this priority**: Billing integration is essential for commercial viability and enables the freemium business model.

**Independent Test**: Can be fully tested by purchasing subscriptions in Stripe test mode, verifying license key generation and validation, and confirming tier enforcement works correctly.

**Acceptance Scenarios**:

1. **Given** I am a Free tier user, **When** I attempt to create a second agent, **Then** the operation is denied with a message explaining the Pro tier requirement
2. **Given** I purchase a Pro subscription via Stripe, **When** the checkout completes, **Then** I receive a license key and the gateway immediately operates in Pro mode with all features unlocked
3. **Given** my Pro subscription expires, **When** the license validation fails, **Then** the system degrades to Free tier after a 72-hour grace period
4. **Given** I am an Enterprise customer, **When** I access the billing portal, **Then** I can manage my subscription, view invoices, and upgrade/downgrade plans

---

### User Story 6 - Kubernetes Deployment (Priority: P2)

As a DevOps engineer, I want to deploy MeridianOS to Kubernetes using Helm charts so that I can run it in production with autoscaling, persistent storage, and TLS termination.

**Why this priority**: Kubernetes deployment is essential for enterprise customers who require cloud-native infrastructure and high availability.

**Independent Test**: Can be fully tested by deploying the Helm chart to a Kubernetes cluster, verifying all pods start correctly, and confirming autoscaling and persistence work.

**Acceptance Scenarios**:

1. **Given** I have a Kubernetes cluster, **When** I install the MeridianOS Helm chart, **Then** all pods (gateway, daemon, dashboard) start successfully and the dashboard is accessible via ingress
2. **Given** the gateway is under heavy load, **When** request rate exceeds the HPA threshold, **Then** additional gateway pods are automatically scaled up
3. **Given** a pod restarts, **When** it comes back online, **Then** it reconnects to the persistent volume and resumes operation with all data intact
4. **Given** I configure TLS certificates, **When** I access the dashboard via ingress, **Then** the connection is secured with HTTPS and the certificate is valid

---

### User Story 7 - Compliance Reporting (Priority: P2)

As a compliance officer, I want to generate audit and compliance reports so that I can demonstrate adherence to SOC2, GDPR, and AI governance requirements.

**Why this priority**: Compliance reporting is mandatory for enterprise customers in regulated industries and enables sales to enterprise accounts.

**Independent Test**: Can be fully tested by generating each report type and verifying the output contains correct data and meets format requirements.

**Acceptance Scenarios**:

1. **Given** I am an admin, **When** I generate a SOC2 audit trail report for the last 30 days, **Then** the report includes access logs, change logs, and authentication logs with user attribution and timestamps
2. **Given** I generate a GDPR data flow report, **When** I view the output, **Then** it shows which providers received user data, which regions data was processed in, and data retention periods
3. **Given** I generate a cost allocation report, **When** I filter by department, **Then** the report shows accurate spend totals per department that sum to the overall spend
4. **Given** I generate a model usage report, **When** I view the output, **Then** it shows which models were used for which task categories, success rates, and cost efficiency metrics

---

### Edge Cases

- What happens when the control plane itself crashes while managing multiple projects?
- How does the system handle concurrent configuration changes from multiple users?
- What happens when a license validation server is unreachable during offline operation?
- How does the system handle project deletion when there are active tasks running?
- What happens when Kubernetes persistent storage becomes full?
- How does the system handle invitation links that have expired or been already used?
- What happens when Stripe webhooks are delayed or arrive out of order?
- How does the system handle users with multiple roles across different projects?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support managing multiple MeridianOS projects from a single control plane process
- **FR-002**: Each project MUST have isolated state databases, independent policy configurations, and separate agent rosters
- **FR-003**: System MUST provide a unified dashboard showing all projects with health status, resource usage, and quick action buttons
- **FR-004**: Control plane MUST automatically restart crashed projects within 10 seconds (max 3 restarts per hour)
- **FR-005**: System MUST support remote dashboard access with API key authentication and user/password login
- **FR-006**: Passwords MUST be hashed using bcrypt (or Node.js crypto.scrypt) before storage
- **FR-007**: System MUST support JWT session tokens with configurable expiration
- **FR-008**: System MUST implement role-based access control with three roles: admin, operator, viewer
- **FR-009**: System MUST support optional OIDC SSO integration for enterprise customers
- **FR-010**: Dashboard MUST support HTTPS/TLS with configurable certificates
- **FR-011**: System MUST support team member invitations via email with token-based links
- **FR-012**: System MUST provide an activity feed tracking all changes with user attribution and timestamps
- **FR-013**: System MUST support task comments visible to all team members
- **FR-014**: System MUST automatically assign PR reviewers from the team roster
- **FR-015**: System MUST ship 7 pre-built project templates for common project types
- **FR-016**: System MUST support custom template import from URL
- **FR-017**: System MUST integrate with Stripe for subscription billing
- **FR-018**: System MUST generate and validate RSA-signed license keys
- **FR-019**: System MUST enforce feature gating based on license tier (Free, Pro, Enterprise)
- **FR-020**: System MUST support 24-hour offline license validation caching
- **FR-021**: System MUST provide Helm charts for Kubernetes deployment
- **FR-022**: Kubernetes deployment MUST support horizontal pod autoscaling
- **FR-023**: System MUST support persistent volume claims for data persistence
- **FR-024**: System MUST support Kubernetes ingress with TLS termination
- **FR-025**: System MUST generate SOC2 audit trail reports
- **FR-026**: System MUST generate GDPR data flow mapping reports
- **FR-027**: System MUST generate cost allocation reports by department and project
- **FR-028**: System MUST generate model usage reports for AI governance

### Key Entities

- **Project**: Represents a MeridianOS instance with isolated state, configuration, agents, and budget. Attributes: id, name, status, agentCount, taskCount, currentSpend, healthStatus
- **User**: Represents a team member with authentication credentials and roles. Attributes: id, email, passwordHash, roles (per-project), createdAt
- **License**: Represents a subscription license with tier and feature entitlements. Attributes: key, tier, expiryDate, features, status
- **ActivityEvent**: Represents an auditable action in the system. Attributes: id, timestamp, userId, projectId, action, targetType, targetId, detail
- **Template**: Represents a pre-configured project setup. Attributes: id, name, description, agentRoster, taskCategories, modelRouting
- **Invitation**: Represents a pending team member invitation. Attributes: id, token, email, projectId, role, expiresAt, acceptedAt

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Platform operators can manage 10+ concurrent projects from a single control plane without performance degradation
- **SC-002**: Remote dashboard authentication completes in under 2 seconds for valid credentials
- **SC-003**: Project auto-restart occurs within 10 seconds of crash detection in 95% of cases
- **SC-004**: Team members can collaborate on projects with real-time activity feed updates appearing within 5 seconds
- **SC-005**: New users can create a project from a template and complete their first task in under 10 minutes
- **SC-006**: License validation completes in under 500ms with 24-hour offline cache
- **SC-007**: Kubernetes deployment scales from 1 to 10 gateway pods within 2 minutes under load
- **SC-008**: Compliance reports generate in under 30 seconds for 30-day date ranges with 10,000+ events
- **SC-009**: Stripe webhook processing completes in under 1 second per event
- **SC-010**: 99.9% of control plane uptime during normal operation

## Assumptions

- Users have Node.js 24+ available for running MeridianOS
- Enterprise customers have existing OIDC providers (Azure AD, Google Workspace, GitHub OAuth)
- Stripe test mode will be used for development and testing
- Kubernetes clusters have ingress controller and persistent storage provisioner available
- Compliance reports will be generated on-demand rather than pre-computed
- License validation server will have 99.9% uptime
- Team members have valid email addresses for invitations
- Project templates will be maintained and updated with best practices
- HTTPS certificates will be managed by platform operators (not auto-renewed by MeridianOS)
- Activity feed data will be retained for 90 days by default

## Dependencies

- Phase 5 (Observability & Intelligence) must be complete for spend analytics and budget intelligence
- Phase 4 (IDE & Platform Traffic Integration) must be complete for unified traffic monitoring
- Phase 3 (End-User Configurability) must be complete for dashboard settings management
- Phase 2 (Provider & Model Agnosticism) must be complete for provider registry integration
- Phase 1 (Universal Gateway) must be complete for shared gateway architecture
- Phase 0 (Foundation Hardening) must be complete for stable base system