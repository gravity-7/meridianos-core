# MeridianOS API Reference

## Authentication API

### POST /api/auth/login
Authenticates a user and returns a JWT token.
**Body:** `{ "email": "user@example.com", "password": "password" }`
**Response:** `{ "success": true, "token": "jwt-token" }`

### GET /api/auth/oauth/{provider}/authorize
Initiates OAuth flow for a specific provider (github, google, azure).
Redirects to the provider's login page.

### GET /api/auth/oauth/{provider}/callback
Handles the callback from the OAuth provider and logs the user in.
**Query Params:** `code`, `state`
Redirects to the dashboard on success.

## Project Management API

### GET /api/projects
Lists all projects available to the user.
**Response:** `{ "success": true, "projects": [...] }`

### POST /api/projects
Creates a new project.
**Body:** `{ "name": "project-1", "template": "blank" }`
**Response:** `{ "success": true, "project": {...} }`

### GET /api/projects/templates
Lists available project templates.
**Response:** `{ "success": true, "templates": [...] }`

## Compliance API

### POST /api/compliance/reports/soc2
Generates a SOC2 Type 2 draft report.
**Body:** `{ "startDate": "...", "endDate": "...", "format": "json|csv" }`
**Response:** File download or JSON object.

### POST /api/compliance/reports/gdpr
Generates a GDPR Data Processing report.
**Body:** `{ "startDate": "...", "endDate": "...", "format": "json|csv" }`
**Response:** File download or JSON object.

## Billing API

### GET /api/billing/license
Retrieves current license details.
**Response:** `{ "success": true, "license": {...} }`
