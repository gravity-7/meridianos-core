# Authentication API Contract

**Feature**: Multi-Tenant Platform  
**Date**: 2026-08-01  
**Version**: 1.0

## Overview

This document defines the HTTP API contract for authentication and authorization in the multi-tenant platform. All endpoints require authentication unless explicitly marked as public.

---

## Base URL

```
http://localhost:4317/api/auth
```

---

## Authentication Methods

### 1. Email/Password Login

**Endpoint**: `POST /login`

**Description**: Authenticate user with email and password, receive JWT token.

**Request**:
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure-password"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr-1234567890abcdef",
    "email": "user@example.com",
    "full_name": "John Doe",
    "roles": {
      "proj-abcdef123456": "admin",
      "proj-ghijkl789012": "operator"
    }
  },
  "expires_at": 1722547200
}
```

**Response** (401 Unauthorized):
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

**Response** (423 Locked):
```json
{
  "success": false,
  "error": "Account locked due to too many failed attempts"
}
```

---

### 2. API Key Authentication

**Endpoint**: N/A (header-based)

**Description**: Authenticate using API key in Authorization header.

**Request**:
```http
GET /api/projects
Authorization: Bearer mk-ABCD1234EFGH5678IJKL9012MNOP3456
```

**Response**: (varies by endpoint)

**Error Response** (401 Unauthorized):
```json
{
  "success": false,
  "error": "Invalid or expired API token"
}
```

**Error Response** (403 Forbidden):
```json
{
  "success": false,
  "error": "Insufficient permissions for this action"
}
```

---

### 3. OIDC SSO Login

**Endpoint**: `GET /oauth/{provider}/authorize`

**Description**: Initiate OAuth 2.0 authorization code flow with PKCE.

**Query Parameters**:
- `provider`: OAuth provider (`azure-ad`, `google-workspace`, `github`)
- `redirect_uri`: Callback URL after authorization
- `state`: CSRF protection token

**Response** (302 Redirect):
```
Location: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?client_id={client_id}&response_type=code&redirect_uri={redirect_uri}&scope=openid profile email&state={state}&code_challenge={code_challenge}&code_challenge_method=S256
```

---

### 4. OIDC Callback

**Endpoint**: `GET /oauth/{provider}/callback`

**Description**: Handle OAuth callback, exchange code for tokens, create/update user.

**Query Parameters**:
- `code`: Authorization code from provider
- `state`: CSRF protection token (must match original)

**Response** (200 OK):
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr-1234567890abcdef",
    "email": "user@example.com",
    "full_name": "John Doe",
    "provider": "azure-ad",
    "provider_id": "azure-oid-123456"
  },
  "expires_at": 1722547200
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Invalid state parameter or authorization code"
}
```

---

## User Management

### 5. Create User (Admin Only)

**Endpoint**: `POST /users`

**Description**: Create a new user account.

**Request**:
```http
POST /api/auth/users
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "email": "newuser@example.com",
  "password": "secure-password",
  "full_name": "Jane Doe",
  "role": "operator",
  "project_id": "proj-abcdef123456"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "user": {
    "id": "usr-0987654321fedcba",
    "email": "newuser@example.com",
    "full_name": "Jane Doe",
    "created_at": 1722460800,
    "is_active": true
  }
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Email already exists"
}
```

**Response** (403 Forbidden):
```json
{
  "success": false,
  "error": "Insufficient permissions to create users"
}
```

---

### 6. Get Current User

**Endpoint**: `GET /me`

**Description**: Get information about the currently authenticated user.

**Request**:
```http
GET /api/auth/me
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "user": {
    "id": "usr-1234567890abcdef",
    "email": "user@example.com",
    "full_name": "John Doe",
    "created_at": 1722000000,
    "last_login": 1722460800,
    "is_active": true,
    "roles": {
      "proj-abcdef123456": "admin",
      "proj-ghijkl789012": "operator"
    }
  }
}
```

---

### 7. Update User Profile

**Endpoint**: `PUT /me`

**Description**: Update current user's profile information.

**Request**:
```http
PUT /api/auth/me
Authorization: Bearer {token}
Content-Type: application/json

{
  "full_name": "John Smith"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "user": {
    "id": "usr-1234567890abcdef",
    "email": "user@example.com",
    "full_name": "John Smith",
    "updated_at": 1722460900
  }
}
```

---

### 8. Change Password

**Endpoint**: `POST /me/password`

**Description**: Change current user's password.

**Request**:
```http
POST /api/auth/me/password
Authorization: Bearer {token}
Content-Type: application/json

{
  "current_password": "old-password",
  "new_password": "new-secure-password"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Current password is incorrect"
}
```

---

## API Token Management

### 9. Create API Token

**Endpoint**: `POST /tokens`

**Description**: Generate a new API token for programmatic access.

**Request**:
```http
POST /api/auth/tokens
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "CI/CD Pipeline",
  "scope": "operator",
  "expires_in": 2592000
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "token": "mk-ABCD1234EFGH5678IJKL9012MNOP3456",
  "token_info": {
    "id": "tok-1234567890abcdef",
    "name": "CI/CD Pipeline",
    "scope": "operator",
    "created_at": 1722460800,
    "expires_at": 1725052800
  }
}
```

**Note**: The token value is only returned once. Store it securely.

---

### 10. List API Tokens

**Endpoint**: `GET /tokens`

**Description**: List all API tokens for the current user.

**Request**:
```http
GET /api/auth/tokens
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "tokens": [
    {
      "id": "tok-1234567890abcdef",
      "name": "CI/CD Pipeline",
      "scope": "operator",
      "created_at": 1722460800,
      "last_used": 1722547200,
      "expires_at": 1725052800,
      "is_revoked": false
    }
  ]
}
```

---

### 11. Revoke API Token

**Endpoint**: `DELETE /tokens/{token_id}`

**Description**: Revoke an API token.

**Request**:
```http
DELETE /api/auth/tokens/tok-1234567890abcdef
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Token revoked successfully"
}
```

---

## Invitation Management

### 12. Create Invitation

**Endpoint**: `POST /invitations`

**Description**: Invite a user to join a project.

**Request**:
```http
POST /api/auth/invitations
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "email": "invitee@example.com",
  "project_id": "proj-abcdef123456",
  "role": "operator"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "invitation": {
    "id": "inv-1234567890abcdef",
    "email": "invitee@example.com",
    "project_id": "proj-abcdef123456",
    "role": "operator",
    "invite_link": "http://localhost:4317/invite/abc123def456",
    "expires_at": 1725052800
  }
}
```

---

### 13. Accept Invitation

**Endpoint**: `POST /invitations/{token}/accept`

**Description**: Accept a project invitation and set password.

**Request**:
```http
POST /api/auth/invitations/abc123def456/accept
Content-Type: application/json

{
  "password": "secure-password",
  "full_name": "Jane Doe"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr-0987654321fedcba",
    "email": "invitee@example.com",
    "full_name": "Jane Doe"
  },
  "project": {
    "id": "proj-abcdef123456",
    "name": "My Project",
    "role": "operator"
  }
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Invitation expired or already accepted"
}
```

---

## Session Management

### 14. Logout

**Endpoint**: `POST /logout`

**Description**: Invalidate current session (JWT).

**Request**:
```http
POST /api/auth/logout
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Note**: JWTs are stateless, so this adds the token to a blacklist cache.

---

### 15. Refresh Token

**Endpoint**: `POST /refresh`

**Description**: Refresh an expiring JWT token.

**Request**:
```http
POST /api/auth/refresh
Authorization: Bearer {expiring_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1722633600
}
```

**Response** (401 Unauthorized):
```json
{
  "success": false,
  "error": "Token expired or invalid"
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `AUTH_INVALID_CREDENTIALS` | Email or password incorrect |
| `AUTH_ACCOUNT_LOCKED` | Account locked due to failed attempts |
| `AUTH_TOKEN_EXPIRED` | JWT token has expired |
| `AUTH_TOKEN_INVALID` | JWT token signature invalid |
| `AUTH_INSUFFICIENT_PERMISSIONS` | User lacks required role/permissions |
| `AUTH_EMAIL_EXISTS` | Email address already registered |
| `AUTH_INVITATION_EXPIRED` | Invitation link has expired |
| `AUTH_INVITATION_ACCEPTED` | Invitation already accepted |
| `AUTH_INVALID_STATE` | OAuth state parameter mismatch |

---

## Rate Limiting

- Login endpoint: 5 attempts per 15 minutes per IP
- Password reset: 3 attempts per hour per email
- API token creation: 10 tokens per user per day
- Invitation creation: 20 invitations per admin per day

---

## Security Considerations

1. **JWT Secret**: Auto-generated on first run, stored in `.ai/auth/jwt-secret` (0600 permissions)
2. **Password Hashing**: scrypt with N=16384, r=8, p=1, 64-byte output
3. **Token Storage**: Tokens hashed with SHA-256 before storage
4. **HTTPS**: Required for production deployments
5. **CSRF Protection**: OAuth flow uses state parameter
6. **Session Expiration**: JWT tokens expire after 24 hours (configurable)
7. **Token Blacklist**: Logout adds tokens to in-memory blacklist with TTL

---

## Summary

The authentication API provides comprehensive user management, API token handling, and OAuth SSO integration. All endpoints follow REST conventions and return consistent JSON responses. The implementation uses Node.js built-in crypto for password hashing and JWT generation, maintaining the zero-dependency philosophy.