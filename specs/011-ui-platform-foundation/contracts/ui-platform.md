# UI Platform Contract

## Route contract

- `/app` and registered descendant paths are platform-owned.
- Direct request, refresh, and history restoration return the same intended platform destination.
- Unknown `/app/*` paths return the platform recovery view; legacy routes keep their existing behavior.

## Feature-flag contract

- A policy-owned flag determines eligibility.
- Default is disabled (legacy experience).
- Enabling and disabling requires no API, data, or browser-client migration.

## Application-boundary contract

- Platform adapters may validate and map public responses into view models and normalized failures.
- Adapters must preserve existing `/api/*` and `/api/v1/*` endpoint URLs, authentication, request shapes, response shapes, and status codes.
- No platform module may expose raw internal exception details to users.

## Accessibility contract

- Shared primitives provide keyboard operation, focus visibility, semantic labels, non-color state indication, and status announcements where needed.
- Theme selection cannot reduce required contrast or focus visibility.
