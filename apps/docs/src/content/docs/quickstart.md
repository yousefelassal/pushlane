---
title: Send your first notification
description: Run Pushlane locally, register an installation, and inspect a send.
sidebar:
  order: 1
---

This guide runs the API and worker locally. You need Node.js 24, pnpm 10, Docker, and a real app or browser push subscription.

## Start the database

From the repository root, install dependencies and create your local configuration.

```sh
pnpm install
pnpm setup:local
docker compose up -d postgres
pnpm db:migrate
```

`pnpm setup:local` writes a new `.env` with a random encryption key, or preserves an existing file. Keep that key outside source control. Read `.env.example` for the configuration variables.

## Create a project

Create a separate project for each environment. Prepare `credentials.json` using [provider setup](/guides/providers/). Omit `--credentials` to create a project without providers for API testing.

```sh
pnpm project:create --name "My app" --environment development --plan self_hosted --credentials ./credentials.json
```

The command prints the project ID and its backend API key. Save the key in your application's backend secrets. Never include it in a mobile app or browser bundle.

Provider credentials are project-specific. See [provider setup](/guides/providers/) before you send to a device.

## Start the applications

Build the dashboard and API once.

```sh
pnpm dashboard:build
pnpm build
pnpm start
```

In another terminal, start the worker.

```sh
pnpm start:worker
```

Open `http://localhost:3020/dashboard/`. Enter the backend API key to connect. The dashboard holds the key in memory and clears it when you disconnect or reload.

## Authorize an installation

Generate a UUID for the app installation and keep it stable across launches. After your backend authenticates the user, request a registration token.

```sh
curl http://localhost:3020/v1/registration-tokens \
  -H "Authorization: Bearer $PUSHLANE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user_123","installationId":"5d62f7f6-2749-4d1d-8f56-1f39c16c9df2"}'
```

Send the returned `token` to that authenticated client. The token permits registration and logout for that installation. It does not permit sending notifications or reading project logs.

Register the endpoint through the [iOS](/guides/ios/), [Android](/guides/android/), or [web](/guides/web/) integration.

## Send to the user

Call Pushlane from your backend.

```sh
curl http://localhost:3020/v1/notifications \
  -H "Authorization: Bearer $PUSHLANE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-shipped' \
  -d '{
    "userId": "user_123",
    "title": "Your order shipped",
    "body": "Your package arrives tomorrow.",
    "image": "https://example.com/package.jpg",
    "url": "https://example.com/orders/123"
  }'
```

HTTP 202 means PostgreSQL durably accepted the request. The response contains `id`, `status`, and `deliveryCount`. If the user has no active installations, the status is `no_registered_devices`.

Find the notification in the dashboard. Open its details to inspect each installation's attempts. Reusing the idempotency key with the same payload returns the original receipt. Reusing it with a different payload returns HTTP 409.
