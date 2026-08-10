# Data Model: UI Platform Foundation

| Entity | Fields / rules | Relationships |
|---|---|---|
| PlatformRoute | path, label, purpose, eligibility, recovery destination; path is unique under `/app` | Rendered by the shell; selected by feature flag. |
| PlatformFlag | enabled, eligibility rule, audit metadata; disabled is safe default | Controls access to platform routes. |
| ThemePreference | system, light, dark; explicit user choice overrides system | Applied through semantic design tokens. |
| DesignToken | semantic name, light value, dark value, category | Consumed by shell and primitives only. |
| ActionState | idle, pending, disabled, success, empty, recoverable error, terminal error; includes message and next action | Rendered by primitives and route views. |
| ApplicationBoundary | view model, loading state, normalized failure, source contract reference | Produced by an adapter from existing API responses. |
| BrowserEvidence | route, viewport, theme, state, browser, result, artifact location | Demonstrates each acceptance scenario. |
