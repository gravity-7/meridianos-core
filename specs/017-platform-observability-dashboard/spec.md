# Feature Specification: Platform Observability Dashboard & Legacy-Parity Polish

**Feature Branch**: `017-platform-observability-dashboard`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Bring the missing legacy dashboard capabilities into the new Dashboard and polish it as a Grafana-inspired, responsive, mobile-ready experience with System, Light, and Dark themes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the operational situation at a glance (Priority: P1)

An operator opens the new default dashboard and can immediately understand what needs attention, the health of the gateway and connected work, current spend against budget, and the recent request, latency, error, token, and cost trends without visiting the retained legacy dashboard.

**Why this priority**: The root dashboard is the product's primary operational entry point. It must be useful on its own before deeper investigation begins.

**Independent Test**: Open the new root dashboard with a deterministic, representative operational dataset and verify the summary widgets, trend visuals, stated time scope, urgent attention ordering, and labelled drill-downs all appear without using `/legacy`.

**Acceptance Scenarios**:

1. **Given** an authorized scope with healthy, warning, and critical conditions, **When** an operator opens the root dashboard, **Then** the highest-priority open condition, health summary, work summary, and budget context are visible without scrolling past unrelated administration controls.
2. **Given** scoped request, latency, error, token, and cost history exists, **When** the operator selects a supported time range, project, or provider, **Then** every compatible summary and trend visual updates to that same scope and clearly identifies any deliberately fixed budget period.
3. **Given** a dashboard widget identifies a problem or significant cost driver, **When** the operator selects its labelled drill-down, **Then** they reach the corresponding detailed evidence while retaining compatible scope and time context.
4. **Given** the selected scope contains no operational data, **When** the root dashboard opens, **Then** it shows truthful, actionable empty states and does not invent activity, costs, or health claims.

---

### User Story 2 - Investigate visual trends and evidence on any supported screen (Priority: P1)

An operator can use the new Gateway, Cost, Usage, Alerts, Tasks, and Runs areas to investigate a displayed trend or status through readable charts, tables, filters, and durable links on desktop and mobile-sized screens.

**Why this priority**: A visually appealing overview is valuable only if it leads to dependable evidence and action without losing context.

**Independent Test**: From a root-chart or summary-card drill-down, open the relevant detail view, switch its visual dimension where offered, access the equivalent data table, and use browser Back on desktop and narrow mobile viewports while retaining scope.

**Acceptance Scenarios**:

1. **Given** a chart has data, **When** an operator views it, **Then** the title, unit, time range, freshness, series meaning, and an equivalent keyboard-accessible data table are available.
2. **Given** a chart has no data, partial data, or temporarily unavailable data, **When** it is shown, **Then** the visual explains the state without misleading zeros, broken layout, or inaccessible controls.
3. **Given** an operator uses a narrow screen, touch input, keyboard-only navigation, zoom, reduced motion, or forced colors, **When** they navigate and filter the dashboard, **Then** controls remain usable and content remains understandable without horizontal page scrolling.
4. **Given** the supplied Grafana reference images are used as the visual acceptance reference, **When** the operator opens the desktop dashboard, **Then** the dense dark panel composition, compact metric tiles, chart/gauge/table treatments, and persistent left navigation rail match the reference hierarchy and interaction model without copying Grafana branding or assets.
5. **Given** an existing legacy widget has an agreed operational purpose, **When** its new-dashboard counterpart is delivered, **Then** the counterpart preserves or improves the relevant information, actions, safeguards, and empty/error states; otherwise it is recorded as intentionally retired with a reason.

---

### User Story 3 - Use a coherent personal visual theme (Priority: P2)

An operator can choose System, Light, or Dark appearance and retain that preference while all dashboard pages, charts, status states, tables, dialogs, and mobile navigation remain readable and consistent.

**Why this priority**: The dashboard will be viewed for long periods and across varied display conditions; an inconsistent theme undermines trust and legibility.

**Independent Test**: Change from System to Light and Dark, navigate between the root dashboard and every primary operational area, reload the browser, and verify the selected appearance, readable contrast, and chart/table distinction remain intact.

**Acceptance Scenarios**:

1. **Given** System appearance is selected, **When** the device appearance changes, **Then** the dashboard follows it without a conflicting fixed theme.
2. **Given** Light or Dark is selected, **When** the operator reloads or navigates to another dashboard page, **Then** the selected appearance remains active until changed.
3. **Given** any supported appearance is active, **When** status, warning, critical, disabled, focus, loading, empty, and selected states are displayed, **Then** they are distinguishable without relying on color alone.

---

### User Story 4 - Demonstrate the product with truthful synthetic telemetry (Priority: P2)

A Founder can run the existing local-only demonstrations and show a coherent, populated operational dashboard using deterministic disposable data, while a normal installation still reflects only its actual data.

**Why this priority**: Empty charts make local demonstrations unconvincing, but fabricated data in normal use would be misleading.

**Independent Test**: Start a disposable local fixture, complete onboarding or sign in to the supported client demo, observe labelled synthetic dashboard data and trends, stop the session, and verify fixture data and local runtime evidence are removed.

**Acceptance Scenarios**:

1. **Given** a designated disposable demo fixture is active, **When** the dashboard opens, **Then** representative operational data is visibly identified as synthetic and uses only deterministic fictional values.
2. **Given** a normal local installation is active, **When** the dashboard opens, **Then** no synthetic telemetry, customer data, provider secret, or external request is introduced by this feature.
3. **Given** a demo is interrupted or stopped, **When** cleanup completes, **Then** the generated fixture data, temporary database, and browser-session residue are removed or explicitly reported as failed cleanup.

### Edge Cases

- The selected time interval contains no records, only partial records, a single extreme value, or more points than can be rendered safely at once.
- A scope changes while a refresh or visual update is in progress; a late response must not replace the newly selected scope.
- A retained legacy capability cannot be mapped to the new dashboard because it is duplicate, unsafe, obsolete, or outside the current product direction; the parity record must state the decision and retained fallback.
- A browser lacks chart enhancement, JavaScript chart rendering is unavailable, or the user uses reduced motion, high zoom, forced colors, keyboard-only navigation, or a narrow touch screen.
- System appearance changes while the dashboard is open, or a stored appearance preference is missing, invalid, or no longer supported.
- The dashboard receives an error, authentication failure, or unavailable response from an existing local data source; it must preserve usable content where possible and expose a specific recovery state.
- A deterministic demo fixture is launched twice, interrupted, or asked to use an occupied port; it must remain loopback-only, avoid external requests, and clean up safely.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-017-001**: The new root dashboard MUST provide a single operational overview containing: open attention; gateway/service health; active and queued work; failed and blocked work; selected-scope spend and budget context; and compact trend visuals for request volume, error rate or failures, latency, token usage, and cost when data exists.
- **FR-017-002**: The dashboard MUST apply one visible, URL-owned authorized time, project, and provider scope to every compatible root widget, visual, table, export, drill-down, refresh action, and navigation path. Any fixed business-period exception MUST be named.
- **FR-017-003**: Every summary widget, visual series, notable point, table row, alert, task, run, and cost driver that has a supported destination MUST provide a labelled drill-down preserving compatible scope and time context.
- **FR-017-004**: The dashboard MUST provide truthful loading, empty, partial, stale, and unavailable states for every root widget and detailed visual, including an understandable recovery action where one is available.
- **FR-017-005**: The new dashboard MUST achieve documented legacy capability parity: maintain a version-controlled parity inventory of every in-scope legacy operational/analytics widget, its new destination, its status, and any intentional retirement rationale. `/legacy` MUST remain an immediately usable fallback throughout this feature.
- **FR-017-006**: Every operational trend visual MUST expose a meaningful title, units, freshness, time scope, series definition, accessible summary, and equivalent keyboard-accessible table or textual representation with the same available drill-down evidence.
- **FR-017-007**: The dashboard MUST visually match the supplied Grafana reference images as the Founder-approved acceptance reference: dark dense panel surfaces, compact KPI/stat tiles, chart and gauge panels, bordered grid spacing, muted secondary text, vivid semantic visualization colors, and a persistent dark left navigation rail with icon-first navigation and expandable dashboard sections. The implementation MUST use MeridianOS-owned markup, labels, icons, colors, and code; it MUST NOT reproduce Grafana branding, logos, proprietary assets, or source designs.
- **FR-017-008**: The dashboard MUST be mobile-first and responsive. At a 320 CSS-pixel viewport, a user can navigate primary areas, change time scope, understand every root widget, open a drill-down, and use a visible alternative to any desktop-only interaction without horizontal page scrolling.
- **FR-017-009**: The dashboard MUST offer System, Light, and Dark appearance modes through an accessible user control. System follows the device preference; explicit Light or Dark remains selected across dashboard navigation and browser reloads until changed.
- **FR-017-010**: Each appearance mode MUST maintain readable status, chart, focus, selected, disabled, loading, empty, error, and alert states without using color as the only indicator.
- **FR-017-011**: Existing Gateway, Cost, Usage, Alerts, Tasks, Runs, Administration, Governance, Integrations, `/setup`, and API authorization boundaries MUST remain functional. The feature MUST not broaden access or alter existing mutation authority.
- **FR-017-012**: The existing local-only onboarding and client-demo launchers MUST be able to exercise populated deterministic operational visuals through explicitly synthetic, disposable fixture data; normal installations MUST never receive seeded telemetry from this feature.
- **FR-017-013**: Fixture data, browser-visible labels, logs, exports, and retained evidence produced for this feature MUST contain only fictional deterministic information; the feature MUST never request, read, log, store, print, or use real provider keys or make external-provider, payment, or email requests.
- **FR-017-014**: The feature MUST add automated coverage for visual data states, scope propagation, drill-downs, theme selection, mobile behavior, accessibility alternatives, synthetic-data isolation, external-request rejection, and interrupted-fixture cleanup.
- **FR-017-015**: The platform shell MUST provide a persistent left navigation rail on desktop with an icon-first menu, active-route indicator, accessible labels/tooltips, and expandable dashboard/observability sections. On mobile it MUST collapse to a touch- and keyboard-operable drawer or rail without hiding the current route or trapping focus.
- **FR-017-016**: The root board MUST support the reference visual families needed for the migrated capabilities: stat/KPI, time-series graph, gauge, bar gauge, table, heatmap, alert list, dashboard/list, log/activity, and plugin/integration status panels. A family may render a truthful empty/error state when its source data is unavailable.
- **FR-017-017**: Cost, token usage, budget consumption, and other percentage/threshold metrics selected for the root board MUST use the supplied circled meter/gauge treatment: a rounded semicircular or circular arc, threshold-colored segments (green/amber/red where applicable), a prominent central value, unit, metric label, threshold/status text, and an accessible numeric/table equivalent. The gauge MUST not communicate meaning by color alone and MUST show `Unknown`/`No data` when its source is unavailable.

### Key Entities

- **Operational Dashboard Board**: The root collection of scoped attention, health, work, budget, and trend widgets with a common time/filter context.
- **Dashboard Widget**: A visible operational summary or trend with a defined data meaning, state, drill-down destination, and accessible alternative.
- **Parity Inventory**: A version-controlled record mapping legacy capabilities to their new-dashboard counterparts, retained fallback, or intentionally retired rationale.
- **Appearance Preference**: The user's System, Light, or Dark presentation choice and its effective display mode.
- **Synthetic Telemetry Fixture**: A disposable, labelled fictional data set that populates dashboard views only during an explicit local demonstration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-017-001**: In a representative populated scope, an operator identifies the highest-priority condition, gateway health, active/blocked work, and selected-scope spend within 10 seconds of opening the root dashboard.
- **SC-017-002**: All in-scope legacy operational and analytics capabilities have a parity-inventory disposition: delivered in the new dashboard, retained intentionally as fallback, or retired with a documented reason; no capability is left unclassified.
- **SC-017-003**: At desktop and 320 CSS-pixel mobile widths, automated browser journeys complete primary navigation, scope changes, theme selection, root-widget drill-down, and return navigation with no horizontal page scroll and no uncaught browser error.
- **SC-017-004**: With a representative 2,000-point trend dataset, the dashboard displays an interactive visual and its equivalent evidence representation within 500 ms at the 95th percentile on the supported local reference browser, without a main-thread task longer than 200 ms.
- **SC-017-005**: Automated accessibility checks and manual Founder self-review confirm that all primary dashboard flows are keyboard-operable and that chart information remains available without interpreting color or the visual alone.
- **SC-017-006**: System, Light, and Dark modes persist or follow device preference as selected across all primary dashboard areas; automated checks find no unresolved text, focus, state, or chart-token contrast regression in the supported local browser.
- **SC-017-007**: Every dashboard demonstration run uses only deterministic synthetic values, records zero attempted non-loopback/external provider/payment/email requests, and removes its temporary fixture root and database on successful cleanup.
- **SC-017-008**: Founder visual review against the supplied references confirms the desktop root has the required left navigation rail, dense dark panel grid, metric/chart/gauge treatments, spacing hierarchy, and active navigation states; each discrepancy is either corrected or recorded as an explicit accepted deviation before convergence.
- **SC-017-009**: Browser journeys at desktop and mobile widths can open, collapse, expand, and keyboard-navigate the left navigation without losing route scope, focus, or access to the root board.
- **SC-017-010**: Founder visual review confirms the cost, token, and budget widgets use the supplied circled meter treatment with correct value, unit, threshold/status, responsive sizing, and accessible numeric equivalent in all supported themes.

## Assumptions

- The supplied Grafana screenshots are the normative visual reference for composition, density, panel families, dark navigation, and interaction hierarchy. “Match” means the Founder accepts the implemented MeridianOS-owned equivalent; it does not authorize copying Grafana branding, logos, proprietary assets, plugins, or source code.
- "Bootstrapped for mobile" means mobile-first responsive behavior and touch-friendly controls, not adding the Bootstrap runtime dependency.
- Existing dashboard APIs, canonical gateway-ledger data, operational routes, chart capability, and retained `/legacy` fallback are the starting point; the feature does not replace authorization, metering, or provider configuration.
- The Founder is the sole current product, UX/design, testing, security/privacy, demo, and release decision owner. Founder self-review is not independent accessibility, browser-platform, performance, production, customer, canary, or release approval.
- The supported local reference browser is Chrome. Safari/macOS, NVDA/VoiceOver, Electron, production performance, visual approval, canary approval, and release approval remain unavailable unless separately evidenced.
- No new runtime dependency is assumed; any exception requires explicit justification under the project constitution.

## Dependencies

- Spec 005 provides spend analytics and time-series intent.
- Spec 009 provides legacy dashboard modernization and observability-panel behavior.
- Spec 013 provides the platform operational routes, shared scope, chart/table parity, alerts, realtime behavior, and root overview foundation.
- Spec 014 provides the disposable headed onboarding fixture.
- Spec 016 provides the local-only client-demo fixture, presenter safety boundaries, current root default, and retained `/legacy` fallback.

## Out of Scope

- Replacing the gateway ledger, authorization model, provider/model registry, onboarding semantics, or existing safe mutation workflows.
- Making external provider, payment, email, customer-data, production, or hosted-service calls.
- Removing `/legacy`, `/index.html`, or `/setup` during this feature.
- Copying Grafana branding, screenshots, plugins, proprietary visual assets, or source code.
- Claiming Safari/macOS, NVDA/VoiceOver, Electron, production/client readiness, canary, visual-baseline, independent accessibility, or release approval without explicit evidence.
