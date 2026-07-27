---
name: "meridianos-dashboard"
description: "MeridianOS Dashboard — single-page application architecture, API endpoints, real-time updates"
---

# MeridianOS Dashboard Skill

## Architecture Overview

The dashboard is a browser-based SPA served by `dashboard/server.mjs` on port 4317.
The frontend is an 87KB single-file `index.html` with vanilla JavaScript — no framework.
The backend provides REST API endpoints for budget, gateway, license, and agent management.

## Key Files

| File | Purpose |
|------|---------|
| `dashboard/server.mjs` | HTTP API server — all REST endpoints |
| `dashboard/index.html` | Single-file SPA — HTML + CSS + vanilla JS |
| `dashboard/actions.mjs` | Action handlers for dashboard operations |
| `dashboard/spec-file.mjs` | API specification / OpenAPI generation |

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/budget` | Current budget status |
| GET | `/api/gateway/status` | Gateway health check |
| GET | `/api/gateway/events` | Token event history |
| GET | `/api/providers` | Provider health status |
| GET | `/api/license` | License information |
| GET | `/api/agents` | Agent roster |
| POST | `/api/restart` | Restart daemon |

## Frontend Architecture

- Vanilla JS — no React, Vue, or other framework
- CSS variables for theming
- Fetch API for backend communication
- Polling for real-time updates

## Common Modifications

- **Adding a new dashboard panel**: Add HTML section in `index.html` → add JS handler → add API endpoint in `server.mjs`
- **Changing the port**: Update `dashboard/server.mjs` PORT constant + agent MCP configs
- **Adding real-time updates**: Use Server-Sent Events or WebSocket (currently polling)
