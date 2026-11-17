# Architecture

Pushlane registers authenticated installations and sends a notification to the active installations for a project-scoped user ID. The API returns after committing the notification and its deliveries to PostgreSQL. The worker claims deliveries with expiring leases and records provider acceptance or failure.

## Boundaries

- `apps/api` validates HTTP inputs, and authenticates backend keys or installation sessions.
- `apps/worker` claims durable deliveries and dispatches them through providers.
- `libs/contracts` owns endpoint variants, notification schemas, provider results, and plan allowances.
- `libs/core` owns identity, installation lifecycle, notification acceptance, and queue processing.
- `libs/database` owns PostgreSQL connections and credential encryption. `migrations` owns the schema.
- `libs/providers` owns APNs, FCM, and Web Push transports.
- `packages/sdk` owns the server and browser TypeScript clients. `sdks` contains Swift and Kotlin clients.
- `apps/dashboard` owns the static dashboard, deployed separately to Cloudflare Workers static assets. `apps/docs` owns Astro Starlight documentation.

## Authentication contract

Each project represents one environment and has a hashed secret backend key. `POST /v1/registration-tokens` accepts that key and `{ userId, installationId }`, revokes prior sessions for the installation, and returns `{ token, expiresAt }`. The random opaque session token is stored only as a hash and expires after one hour. The customer's backend must authenticate the user before minting it.

`PUT /v1/installations/:installationId` accepts the session bearer token and an endpoint from `endpointSchema`. `DELETE /v1/installations/:installationId` revokes that session and installation. An expired or revoked token cannot register again. A refreshed token must come from the customer's authenticated backend.

`POST /v1/notifications` accepts the project backend key, an `Idempotency-Key`, and `notificationSchema`. It returns `{ id, status, deliveryCount }` with HTTP 202. Identical replays return that receipt. A different payload with the same key returns HTTP 409. `GET /v1/notifications?userId=&limit=&before=` and `GET /v1/notifications/:id` require the same backend key and expose project-scoped logs. `GET /v1/project` returns nonsecret project configuration, usage, and configured provider names.

## Durable state

Projects own encrypted provider credentials and a single environment. Installation sessions are bound to a project, user, and installation ID. A notification snapshots installation session IDs and endpoint versions. Workers check those snapshots immediately before authorizing a dispatch. Logout or account switching suppresses pending deliveries. Logout cannot recall a request already authorized or accepted by a provider.

API acceptance, quota reservation, notifications, and delivery jobs commit together. Workers use `FOR UPDATE SKIP LOCKED` and lease tokens. Expired leases can be reclaimed after a crash. Completion updates must still own the lease. Retries are bounded by expiry and attempt count. Network uncertainty means at-least-once provider submission and possible duplicates, never exactly-once device delivery.

## Synthesis decision

Two candidates compared PostgreSQL-only leases against PostgreSQL outbox plus Redis and BullMQ. Both candidate authors and an independent judge preferred PostgreSQL-only for initial operational simplicity. The outbox candidate contributed the explicit recovery requirement. Shared schemas keep provider and SDK contracts stable if scheduling changes later. Exploration used the available parent model, so model diversity was reduced.

## Initial paid boundary

Self-hosting uses the complete sending core without a usage allowance. Cloud plan records reserve monthly dispatch allowances transactionally and expire logs according to plan retention. These are product configuration defaults, not published prices. This repository does not collect payments or provision a hosted SaaS account. Payment processing, team sign-in, and cloud deployment require a later integration.
