# Quickstart Validation: UI Platform Foundation

1. Configure the platform flag as disabled. Confirm legacy dashboard routes and representative `/api/*` and `/api/v1/*` contract fixtures are unchanged.
2. Enable the flag for a test user. Directly open every registered `/app` route, refresh, and exercise browser Back/Forward.
3. Confirm unknown `/app/*` routes use the in-app recovery experience and legacy deep links retain legacy behavior.
4. In light and dark themes, use keyboard-only navigation and assistive technology on shell, navigation, action, input, feedback, overlay, and empty-state primitives.
5. Exercise pending, disabled, success, empty, recoverable error, and terminal error state fixtures. Capture browser evidence at narrow and wide viewports across the supported browser matrix.
6. Disable the flag. Confirm the same eligible user returns to legacy without migration, contract changes, or cleared browser state.
