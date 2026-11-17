---
title: HTTP API
description: Authentication, installation registration, notification sending, and log queries.
sidebar:
  order: 1
---

All API routes use the `/v1` prefix. JSON request bodies use `Content-Type: application/json`. Backend routes require `Authorization: Bearer <project-api-key>`. Installation routes require an installation registration token instead.

## Issue a registration token

`POST /v1/registration-tokens` requires the backend key.

```json
{
  "userId": "user_123",
  "installationId": "5d62f7f6-2749-4d1d-8f56-1f39c16c9df2"
}
```

The response includes `token` and `expiresAt`. The token expires after one hour and is bound to this user and installation. Issuing another token for the installation revokes its previous session.

## Register an installation

`PUT /v1/installations/:installationId` requires a registration token. The body is exactly one endpoint variant.

APNs accepts `kind: "apns"`, a hexadecimal `token`, and a boolean `sandbox` that defaults to `false`.

FCM accepts `kind: "fcm"` and its string `token`.

Web Push accepts `kind: "webpush"` and `subscription`. The subscription contains an HTTPS `endpoint` and `keys` with `p256dh` and `auth` base64url strings.

## Revoke an installation

`DELETE /v1/installations/:installationId` requires the registration token and returns HTTP 204. Repeated revocation is successful. An expired token can still revoke its own session. Revocation prevents that token from registering again. Pending deliveries for the old session are suppressed before dispatch authorization.

## Send a notification

`POST /v1/notifications` requires the backend key and an `Idempotency-Key` header.

```json
{
  "userId": "user_123",
  "title": "Your order shipped",
  "body": "Your package arrives tomorrow.",
  "image": "https://example.com/package.jpg",
  "url": "https://example.com/orders/123",
  "ttlSeconds": 86400
}
```

`userId`, `title`, and `body` are required. `image` and `url` are optional HTTPS URLs. `ttlSeconds` defaults to 86,400 and accepts integers from 1 through 2,419,200.

User IDs accept 1 through 200 characters. Titles accept 1 through 200 characters. Bodies accept 1 through 2,000 characters. The normalized payload must fit within 3,000 UTF-8 bytes. Unknown fields are rejected.

HTTP 202 returns the durable receipt.

```json
{
  "id": "notification-uuid",
  "status": "queued",
  "deliveryCount": 2
}
```

The status is `no_registered_devices` when there are no eligible installations. Repeating an idempotency key with the same normalized request returns the original receipt. A different request with the same key returns HTTP 409.

## Read logs

`GET /v1/notifications` requires the backend key. Use `userId` to filter by exact user ID and `limit` to control page size. Pass the returned cursor as `before` to read older notifications.

`GET /v1/notifications/:id` returns the notification and its installation deliveries and attempts. Only records in the authenticated project are visible.

## Read project configuration

`GET /v1/project` requires the backend key. The response includes nonsecret project configuration, configured provider names, and usage. It never returns private provider credentials.

## Buy a month of Pro

`POST /v1/billing/checkout` requires the backend key and returns HTTP 201 with a Paymob hosted checkout URL. Paymob requires a contact for every payment.

```json
{
  "customer": {
    "firstName": "Mona",
    "lastName": "Adel",
    "email": "mona@example.com",
    "phone": "+201234567890"
  }
}
```

```json
{
  "paymentId": "payment-uuid",
  "checkoutUrl": "https://accept.paymob.com/unifiedcheckout/?publicKey=...&clientSecret=..."
}
```

Open `checkoutUrl` in a browser. Paymob returns the payer to the server's configured return URL. That redirect does not confirm payment. The plan changes only after Paymob calls `POST /v1/billing/paymob/callback` with a valid HMAC signature. Read `GET /v1/project` to see the result.

A server without Paymob configuration returns HTTP 404. A project that cannot buy Pro returns HTTP 409. A Paymob failure returns HTTP 502.

## Errors

Malformed payloads return HTTP 400. Missing or invalid credentials return HTTP 401. Expired or revoked tokens cannot register an installation. A known installation token can still revoke its own session after expiry. Unknown resources return HTTP 404. Idempotency conflicts return HTTP 409. Usage limits reject additional accepted work rather than silently dropping it.
