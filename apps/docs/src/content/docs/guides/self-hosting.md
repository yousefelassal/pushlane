---
title: Run your own deployment
description: Operate the Pushlane API and worker with PostgreSQL.
sidebar:
  order: 6
---

Run the API and worker as separate processes against the same PostgreSQL database. The initial queue lives in PostgreSQL and does not require Redis.

## Prepare configuration

Copy `.env.example` to `.env`. Set the database connection, deployment encryption key, and API port. Keep the same encryption key on every API and worker instance. Store it separately from database backups.

Use TLS between public clients and the API. Restrict database network access to your application processes. Configure allowed browser origins explicitly for your web app.

## Apply migrations

Install dependencies and run migrations before starting the applications.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
```

Back up the database before applying an upgrade. Keep the prior application release available until the upgrade checks pass.

## Start the API and worker

```sh
pnpm start
```

Run the worker in another process.

```sh
pnpm start:worker
```

Use a process supervisor or container orchestrator to restart failed processes. The worker reclaims expired delivery leases after a crash. Several workers can share the database because claims use row locks and lease tokens.

Deploy the dashboard separately to Cloudflare Workers static assets with `VITE_API_BASE_URL=https://your-api-origin pnpm dashboard:deploy`, and add its origin to `CORS_ORIGINS`. Connect with a project backend key. Limit dashboard access to trusted operators.

## Accept payments with Paymob

Billing is off unless `PAYMOB_SECRET_KEY` is set. Self-hosted deployments do not need it. To sell Pro months, set every value below. A partial configuration stops the API at startup.

| Variable                        | Value                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PAYMOB_BASE_URL`               | Regional origin. Defaults to `https://accept.paymob.com` for Egypt.                             |
| `PAYMOB_SECRET_KEY`             | Secret key from Paymob Settings, API Keys.                                                      |
| `PAYMOB_PUBLIC_KEY`             | Public key from the same page.                                                                  |
| `PAYMOB_HMAC_SECRET`            | HMAC secret from the same page.                                                                 |
| `PAYMOB_INTEGRATION_IDS`        | Comma-separated integration IDs, one per payment method.                                        |
| `PAYMOB_CURRENCY`               | Currency of those integrations, such as `EGP`.                                                  |
| `PAYMOB_PRO_MONTH_AMOUNT_CENTS` | Price of one Pro month in minor units. `50000` is 500.00.                                       |
| `PUBLIC_API_URL`                | Public HTTPS origin of this API. Paymob sends callbacks to `/v1/billing/paymob/callback` on it. |
| `BILLING_RETURN_URL`            | HTTPS page Paymob opens after checkout.                                                         |

Test keys and integration IDs must be in the same mode. Paymob cannot reach a loopback address, so test callbacks through a tunnel or a deployed test environment.

## Preserve delivery semantics

The API returns HTTP 202 after its database transaction commits. A stopped worker delays delivery without losing accepted jobs. Notifications expire according to their `ttlSeconds`.

A crash after provider acceptance but before recording the outcome can cause a duplicate submission. Use idempotency keys for backend retries. Idempotency does not promise exactly-once device display.

Monitor failed and retrying deliveries, worker liveness, database capacity, and available disk space. A healthy HTTP process alone does not establish that the worker is dispatching.

## Test the deployment

Run the repository checks and PostgreSQL integration tests before upgrading. Send a notification to a test installation on each supported platform. Inspect the provider response and verify the notification on the actual device.

Credentials and physical devices are required to prove live APNs and FCM delivery. Local integration tests cannot establish that an operating system displayed a notification.
