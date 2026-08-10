# Quickstart Validation: UI Platform Foundation

1. Configure the platform flag as disabled. Confirm legacy dashboard routes and representative `/api/*` and `/api/v1/*` contract fixtures are unchanged.
2. Enable the flag for a test user. Directly open every registered `/app` route, refresh, and exercise browser Back/Forward.
3. Confirm unknown `/app/*` routes use the in-app recovery experience and legacy deep links retain legacy behavior.
4. In light and dark themes, use keyboard-only navigation and assistive technology on shell, navigation, action, input, feedback, overlay, and empty-state primitives.
5. Exercise idle, pending, disabled, success, loading, empty, and error state fixtures. `npm run test:browser` retains wide/light and narrow/dark screenshots for Chrome, Edge, and Firefox under `artifacts/playwright-results`; macOS CI retains the Safari screenshot as the `ui-platform-safari-evidence` artifact.
6. Disable the flag. Confirm the same eligible user returns to legacy without migration, contract changes, or cleared browser state.
