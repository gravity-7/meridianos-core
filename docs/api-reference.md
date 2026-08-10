# API Reference

This file used to duplicate a subset of the real API reference and had drifted out of sync with
it (and with the actual route handlers). The full, current reference — authentication, project
management, team collaboration, billing, compliance reporting, OAuth SSO, error format, rate
limiting, and RBAC — now lives in one place:

**→ [multi-tenant-api.md](multi-tenant-api.md)**

For the separate public REST API (`/api/v1/*`, scoped `mk-`-prefixed API keys, for third-party
integrations rather than the dashboard itself), see
[phase-7-ecosystem-distribution.md](phase-7-ecosystem-distribution.md#using-the-rest-api) and the
live OpenAPI/Swagger UI at `http://localhost:4317/api/v1/docs` on a running instance.
