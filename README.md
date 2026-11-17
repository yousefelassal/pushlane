# Pushlane

Open source transactional push for native iOS, Android, and the web.

Register installations against your application's user IDs. Send one backend request to notify every active installation. Inspect provider responses and retries in the dashboard.

Pushlane is an initial implementation. The core, SDKs, dashboard, and self-hosting setup are Apache-2.0 licensed. Cloud plan allowances and retention are implemented. Hosted account provisioning, team sign-in, payment collection, and production deployment are not included.

## Run locally

Requirements are Node.js 24, pnpm 10.32.1, and Docker.

```sh
pnpm install
pnpm setup:local
docker compose up -d postgres
pnpm db:migrate
pnpm build
pnpm project:create --name demo
```

Save the returned backend API key. The database stores its hash. Keep this key on your backend. The project creation command accepts `--environment development|production`, `--plan self_hosted|free|pro`, and an optional `--credentials /path/to/credentials.json`.

Start the API and worker in separate terminals.

```sh
pnpm start
pnpm start:worker
```

Start the dashboard with `pnpm --filter @pushlane/dashboard dev`, open the printed URL, and connect with the project key. Start the documentation with `pnpm docs:dev`.

`pnpm dev` and `pnpm dev:worker` provide watch mode. They load your local `.env` file automatically.

## Register an installation

Your application's backend authenticates the user, then calls `POST /v1/registration-tokens` with its backend key and `{ "userId": "user_123", "installationId": "a-client-generated-uuid" }`. It returns the short-lived registration token to that authenticated client.

The client calls `PUT /v1/installations/:installationId` with the registration bearer token and its APNs token, FCM token, or Web Push subscription. Swift, Kotlin, and browser clients implement this request. Public clients never receive backend API keys.

Issuing a new registration token immediately revokes the installation's prior binding. Logout calls `DELETE /v1/installations/:installationId` using its registration token. An expired token can revoke its own binding, but cannot register again. An old session cannot revoke a newer session.

## Send a notification

```sh
curl http://localhost:3020/v1/notifications \
  -H "Authorization: Bearer $PUSHLANE_API_KEY" \
  -H 'Idempotency-Key: order-123-shipped' \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "user_123",
    "title": "Your order shipped",
    "body": "Your package arrives tomorrow.",
    "image": "https://example.com/package.jpg",
    "url": "https://example.com/orders/123"
  }'
```

The API returns HTTP 202 with the notification ID and target installation count after durable acceptance. Repeat the same payload and idempotency key to recover the original receipt. Reusing the key for another payload returns HTTP 409.

The optional `ttlSeconds` defaults to 86400 and accepts 1 through 2419200. Notification payloads have a 3000-byte UTF-8 limit. Images and click destinations require HTTPS. iOS images require a Notification Service Extension. Browser image display varies by platform.

## Configure providers

Pass a JSON file to `project:create --credentials` with whichever providers the project needs.

```json
{
  "apns": {
    "teamId": "APPLE_TEAM_ID",
    "keyId": "APPLE_KEY_ID",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    "bundleId": "com.example.app"
  },
  "fcm": {
    "projectId": "firebase-project-id",
    "clientEmail": "service-account@firebase-project-id.iam.gserviceaccount.com",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  },
  "webpush": {
    "subject": "mailto:notifications@example.com",
    "publicKey": "VAPID_PUBLIC_KEY",
    "privateKey": "VAPID_PRIVATE_KEY"
  }
}
```

Provider credentials and installation endpoints are encrypted with the deployment's `ENCRYPTION_KEY`. Back up that key separately from the database. Keep credential files outside the repository. Generate VAPID keys with `pnpm exec web-push generate-vapid-keys --json`.

A project represents one environment. Create separate development and production projects. Production deployments need TLS, private database access, database backups, and explicit browser `CORS_ORIGINS`. The default bind address is loopback. The container binds to all interfaces for a reverse proxy.

## Understand logs and allowances

The dashboard searches by user ID and shows each installation's attempts. Provider acceptance does not establish that a device displayed or opened the notification. Pushlane does not claim device receipts.

PostgreSQL stores notifications and delivery jobs in one transaction. Workers use expiring leases, bounded provider calls, and at most five provider attempts. A worker crash after provider acceptance can cause a duplicate. Logout suppresses jobs that have not passed dispatch authorization. It cannot recall provider requests already in flight.

Self-hosted projects have no software dispatch allowance or automatic log deletion. The `free` and `pro` configurations reserve one allowance unit per target installation on acceptance. Retries reserve no additional units. Their current limits are 10000 and 1000000 monthly dispatches, with 7 and 30 days of completed log retention. These are initial configuration defaults. They are not published prices or a payment integration. Idempotency records remain available while their notification log is retained.

## Develop and verify

```sh
pnpm check
```

This runs typechecking, Oxlint and Prettier, provider and SDK tests, Nest builds, dashboard build, and Starlight build.

Integration tests require a dedicated PostgreSQL database. They drop every table in that database, then apply the migrations. Never point `TEST_DATABASE_URL` at a database you want to keep.

```sh
docker compose exec postgres createdb -U pushlane pushlane_test
pnpm test:integration
```

Override `TEST_DATABASE_URL` when PostgreSQL runs elsewhere. These tests exercise the real API and database, including idempotency, isolation, logout, endpoint transfer, lease recovery, expiry, and retention.

```sh
swift test --package-path sdks/swift
docker run --rm -v "$PWD/sdks/android:/workspace" -w /workspace gradle:8.14-jdk17 gradle test --no-daemon
```

Native tests cover client HTTP behavior. Real APNs and FCM delivery, physical-device image presentation, and browser push permission flows require app credentials and compatible devices.

## Repository

- `apps/api` is the NestJS HTTP service. Each feature (`projects`, `installations`, `notifications`, `health`) is a module with its controller and service.
- `apps/worker` is the independent delivery worker. `delivery` owns the queue consumer.
- `apps/dashboard` is a static TypeScript dashboard deployed to Cloudflare Workers static assets.
- `apps/docs` is the Astro Starlight documentation site.
- `libs/contracts` holds shared schemas. `libs/database` holds TypeORM entities, migrations, and credential encryption. `libs/providers` holds the APNs, FCM, and Web Push transports.
- `packages/sdk` contains the TypeScript server, browser, and service worker clients.
- `sdks/swift` and `sdks/android` contain native registration clients.

Change the schema by editing an entity, then run `pnpm db:migration:generate libs/database/src/migrations/<name>` and register the class in `libs/database/src/migrations/index.ts`. `pnpm db:schema:check` fails when entities and migrations disagree. CI runs it.

Read [the architecture](docs/architecture.md) and [the implementation review](docs/review.md) before changing identity or queue behavior.
