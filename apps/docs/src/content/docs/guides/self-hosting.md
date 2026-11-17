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
pnpm dashboard:build
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

Open `/dashboard/` on the API origin and connect with a project backend key. Limit dashboard access to trusted operators.

## Preserve delivery semantics

The API returns HTTP 202 after its database transaction commits. A stopped worker delays delivery without losing accepted jobs. Notifications expire according to their `ttlSeconds`.

A crash after provider acceptance but before recording the outcome can cause a duplicate submission. Use idempotency keys for backend retries. Idempotency does not promise exactly-once device display.

Monitor failed and retrying deliveries, worker liveness, database capacity, and available disk space. A healthy HTTP process alone does not establish that the worker is dispatching.

## Test the deployment

Run the repository checks and PostgreSQL integration tests before upgrading. Send a notification to a test installation on each supported platform. Inspect the provider response and verify the notification on the actual device.

Credentials and physical devices are required to prove live APNs and FCM delivery. Local integration tests cannot establish that an operating system displayed a notification.
