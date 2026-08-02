# Billing API Contract

**Feature**: Multi-Tenant Platform  
**Date**: 2026-08-01  
**Version**: 1.0

## Overview

This document defines the HTTP API contract for Stripe billing integration and license management. All endpoints require authentication with admin role unless explicitly marked as public.

---

## Base URL

```
http://localhost:4317/api/billing
```

---

## License Management

### 1. Get License Status

**Endpoint**: `GET /license`

**Description**: Get current license status and tier information.

**Request**:
```http
GET /api/billing/license
Authorization: Bearer {admin_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "license": {
    "id": "lic-1234567890abcdef",
    "license_key": "mer-ABCD-1234-EFGH-5678",
    "tier": "pro",
    "status": "active",
    "features": [
      "unlimited_agents",
      "all_providers",
      "budget_enforcement",
      "remote_dashboard",
      "team_collaboration"
    ],
    "expires_at": 1725148800,
    "last_validated": 1722460800,
    "customer_id": "cus_abc123def456",
    "subscription_id": "sub_ghi789jkl012"
  },
  "usage": {
    "seats_used": 3,
    "seats_limit": 5,
    "projects_count": 2
  }
}
```

**Response** (404 Not Found):
```json
{
  "success": false,
  "error": "No license found. Using free tier."
}
```

---

### 2. Validate License Key

**Endpoint**: `POST /license/validate`

**Description**: Validate a license key and activate it for the current installation.

**Request**:
```http
POST /api/billing/license/validate
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "license_key": "mer-ABCD-1234-EFGH-5678"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "license": {
    "id": "lic-1234567890abcdef",
    "license_key": "mer-ABCD-1234-EFGH-5678",
    "tier": "pro",
    "status": "active",
    "features": [...],
    "expires_at": 1725148800
  },
  "message": "License validated successfully"
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Invalid license key format"
}
```

**Response** (403 Forbidden):
```json
{
  "success": false,
  "error": "License key has been revoked"
}
```

---

### 3. Refresh License Validation

**Endpoint**: `POST /license/refresh`

**Description**: Force refresh license validation from the license server.

**Request**:
```http
POST /api/billing/license/refresh
Authorization: Bearer {admin_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "license": {
    "id": "lic-1234567890abcdef",
    "license_key": "mer-ABCD-1234-EFGH-5678",
    "tier": "pro",
    "status": "active",
    "last_validated": 1722460900
  },
  "message": "License refreshed successfully"
}
```

**Response** (503 Service Unavailable):
```json
{
  "success": false,
  "error": "License server unreachable. Using cached validation (valid for 24h)."
}
```

---

## Subscription Management

### 4. Create Checkout Session

**Endpoint**: `POST /checkout`

**Description**: Create a Stripe checkout session for subscription purchase.

**Request**:
```http
POST /api/billing/checkout
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "tier": "pro",
  "success_url": "http://localhost:4317/billing/success",
  "cancel_url": "http://localhost:4317/billing/cancel"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_abc123",
  "session_id": "cs_test_abc123def456"
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Invalid tier. Must be 'pro' or 'enterprise'."
}
```

---

### 5. Get Customer Portal URL

**Endpoint**: `GET /portal`

**Description**: Get the Stripe customer portal URL for subscription management.

**Request**:
```http
GET /api/billing/portal
Authorization: Bearer {admin_token}
```

**Query Parameters**:
- `return_url`: URL to redirect to after portal session

**Response** (200 OK):
```json
{
  "success": true,
  "portal_url": "https://billing.stripe.com/session/portal_abc123"
}
```

**Response** (404 Not Found):
```json
{
  "success": false,
  "error": "No active subscription found"
}
```

---

### 6. Get Subscription Details

**Endpoint**: `GET /subscription`

**Description**: Get detailed subscription information from Stripe.

**Request**:
```http
GET /api/billing/subscription
Authorization: Bearer {admin_token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "subscription": {
    "id": "sub_ghi789jkl012",
    "status": "active",
    "tier": "pro",
    "current_period_start": 1722000000,
    "current_period_end": 1724678400,
    "cancel_at_period_end": false,
    "amount": 2900,
    "currency": "usd",
    "interval": "month"
  },
  "customer": {
    "id": "cus_abc123def456",
    "email": "admin@example.com",
    "name": "John Doe"
  },
  "invoice_history": [
    {
      "id": "in_1234567890",
      "amount": 2900,
      "status": "paid",
      "created": 1722000000,
      "pdf_url": "https://pay.stripe.com/invoices/inv_123/pdf"
    }
  ]
}
```

---

## Webhook Handling

### 7. Stripe Webhook Endpoint

**Endpoint**: `POST /webhook/stripe`

**Description**: Handle Stripe webhook events for subscription lifecycle management.

**Request**:
```http
POST /api/billing/webhook/stripe
Content-Type: application/json
Stripe-Signature: t=1722460800,v1=abc123...

{
  "id": "evt_1234567890",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_abc123",
      "customer": "cus_abc123def456",
      "subscription": "sub_ghi789jkl012",
      "metadata": {
        "tier": "pro"
      }
    }
  }
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

**Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Invalid webhook signature"
}
```

**Response** (202 Accepted):
```json
{
  "success": true,
  "message": "Webhook acknowledged for async processing"
}
```

**Supported Event Types**:
- `checkout.session.completed`: Subscription purchased, generate license key
- `customer.subscription.updated`: Subscription modified, update license
- `customer.subscription.deleted`: Subscription cancelled, revoke license
- `invoice.payment_succeeded`: Payment successful, extend license
- `invoice.payment_failed`: Payment failed, enter grace period

---

## Tier Enforcement

### 8. Check Feature Access

**Endpoint**: `POST /check-feature`

**Description**: Check if a feature is available for the current license tier.

**Request**:
```http
POST /api/billing/check-feature
Authorization: Bearer {token}
Content-Type: application/json

{
  "feature": "unlimited_agents"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "allowed": true,
  "tier": "pro",
  "feature": "unlimited_agents"
}
```

**Response** (403 Forbidden):
```json
{
  "success": false,
  "allowed": false,
  "tier": "free",
  "feature": "unlimited_agents",
  "message": "This feature requires Pro tier. Upgrade at /billing/upgrade"
}
```

**Available Features**:
- `unlimited_agents`: Create unlimited agents (Free: 1 agent max)
- `all_providers`: Use all LLM providers (Free: DeepSeek only)
- `budget_enforcement`: Budget enforcement and alerts (Free: metering only)
- `remote_dashboard`: Remote dashboard access (Free: localhost only)
- `team_collaboration`: Multi-user team features (Free: single user)
- `sso`: OIDC SSO integration (Enterprise only)
- `compliance_reports`: SOC2/GDPR reports (Enterprise only)
- `custom_models`: Custom model routing (Enterprise only)

---

### 9. Get Tier Limits

**Endpoint**: `GET /limits`

**Description**: Get current usage and limits for the license tier.

**Request**:
```http
GET /api/billing/limits
Authorization: Bearer {token}
```

**Response** (200 OK):
```json
{
  "success": true,
  "tier": "pro",
  "limits": {
    "agents": {
      "current": 3,
      "max": null,
      "unlimited": true
    },
    "users": {
      "current": 3,
      "max": 5,
      "unlimited": false
    },
    "projects": {
      "current": 2,
      "max": null,
      "unlimited": true
    }
  },
  "features": {
    "all_providers": true,
    "budget_enforcement": true,
    "remote_dashboard": true,
    "team_collaboration": true,
    "sso": false,
    "compliance_reports": false
  }
}
```

---

## Pricing Information

### 10. Get Pricing Plans

**Endpoint**: `GET /pricing`

**Description**: Get available pricing plans and their features.

**Request**:
```http
GET /api/billing/pricing
```

**Response** (200 OK):
```json
{
  "success": true,
  "plans": [
    {
      "id": "free",
      "name": "Free",
      "price": 0,
      "interval": "forever",
      "features": [
        "1 agent",
        "DeepSeek provider only",
        "Metering and spend tracking",
        "Local dashboard only"
      ],
      "limits": {
        "agents": 1,
        "users": 1,
        "projects": 1
      }
    },
    {
      "id": "pro",
      "name": "Pro",
      "price": 29,
      "interval": "month",
      "features": [
        "Unlimited agents",
        "All LLM providers",
        "Budget enforcement and alerts",
        "Remote dashboard access",
        "Team collaboration (5 users)"
      ],
      "limits": {
        "agents": null,
        "users": 5,
        "projects": null
      }
    },
    {
      "id": "enterprise",
      "name": "Enterprise",
      "price": 99,
      "interval": "month",
      "features": [
        "Everything in Pro",
        "Unlimited team members",
        "OIDC SSO integration",
        "Priority support",
        "Custom model routing",
        "Compliance reports (SOC2, GDPR)"
      ],
      "limits": {
        "agents": null,
        "users": null,
        "projects": null
      }
    }
  ]
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `BILLING_LICENSE_INVALID` | License key format invalid or signature verification failed |
| `BILLING_LICENSE_REVOKED` | License key has been revoked |
| `BILLING_LICENSE_EXPIRED` | License key has expired |
| `BILLING_SUBSCRIPTION_NOT_FOUND` | No active subscription for customer |
| `BILLING_WEBHOOK_INVALID` | Webhook signature verification failed |
| `BILLING_FEATURE_NOT_AVAILABLE` | Feature not available for current tier |
| `BILLING_TIER_INVALID` | Invalid tier specified |
| `BILLING_CHECKOUT_FAILED` | Stripe checkout session creation failed |
| `BILLING_PORTAL_UNAVAILABLE` | Customer portal not available |

---

## Rate Limiting

- License validation: 10 requests per hour per installation
- Checkout creation: 5 requests per hour per user
- Portal access: 10 requests per hour per user
- Feature checks: 100 requests per minute per user

---

## Security Considerations

1. **Webhook Signature**: Verify Stripe webhook signatures using `stripe.webhooks.constructEvent()`
2. **License Key Storage**: Store license keys encrypted in database
3. **Customer Data**: Never store full payment details, only Stripe customer/subscription IDs
4. **Idempotency**: Use Stripe idempotency keys for all API calls
5. **Grace Period**: 72-hour grace period after subscription expiration before feature downgrade
6. **Offline Cache**: License validation cached for 24 hours to handle license server outages

---

## License Key Format

**Format**: `mer-XXXX-XXXX-XXXX-XXXX`

**Structure**:
- Prefix: `mer-` (MeridianOS identifier)
- Payload: 12 characters (base32-encoded)
- Signature: 12 characters (RSA signature)

**Validation**:
1. Verify format matches regex `^mer-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$`
2. Decode payload from base32
3. Verify RSA signature using public key
4. Check expiration timestamp in payload
5. Check revocation status against license server

**Payload Structure** (JSON, base32-encoded):
```json
{
  "tier": "pro",
  "customer_id": "cus_abc123def456",
  "subscription_id": "sub_ghi789jkl012",
  "expires_at": 1725148800,
  "features": ["unlimited_agents", "all_providers"]
}
```

---

## Summary

The billing API provides comprehensive Stripe integration for subscription management, license validation, and tier enforcement. All endpoints require authentication with admin role for management operations. The API follows REST conventions and returns consistent JSON responses. Webhook handling ensures subscription lifecycle events are processed automatically, and offline caching ensures system availability during license server outages.