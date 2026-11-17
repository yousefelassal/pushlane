# Pushlane dashboard

The dashboard is a React single-page app built with Vite and the TanStack libraries. It is deployed to Cloudflare Workers as static assets. No Worker script runs. The API does not serve it. It connects to one project using its backend API key. The key stays in React state and is cleared on reload or disconnect. The current release has no team sign-in or operator roles.

## Develop

Run the API on port 3020, then start Vite from the repository root.

```sh
pnpm --filter @pushlane/dashboard dev
```

Open the printed URL. Vite proxies `/v1` requests to `http://127.0.0.1:3020`.

To connect to another API origin, set `VITE_API_BASE_URL` before running Vite or building the dashboard. The value must be an HTTPS origin, or an HTTP origin on localhost. Configure that origin's CORS allowlist for the dashboard origin. Never put an API key in a Vite environment variable.

## Deploy to Cloudflare Workers

`wrangler.jsonc` deploys `dist` as Workers static assets with single-page fallback. The build also writes a `_headers` file whose Content Security Policy allows requests only to the configured API origin.

```sh
VITE_API_BASE_URL=https://api.example.com pnpm dashboard:deploy
```

The deploy build fails when `VITE_API_BASE_URL` is unset, because the static host cannot answer `/v1` requests. Add the dashboard origin to the API's `CORS_ORIGINS`. Run `pnpm --filter @pushlane/dashboard preview` to serve the current build locally with `wrangler dev`.

## Build and verify

```sh
pnpm dashboard:build
node apps/dashboard/scripts/smoke.mjs
```

The smoke script drives the built page in Chromium against controlled HTTP API responses. It checks connection, safe rendering of notification content, delivery details, filtering, idempotent send retries, disconnect, and mobile overflow. It does not verify the live API or real provider delivery. Install Chromium with `pnpm exec playwright install chromium` if it is unavailable.

## Ownership

- `src/lib/api.ts` validates API responses with zod and sends authenticated requests.
- `src/lib/session.tsx` owns the connection. Each connection has its own query key scope and abort signal, so disconnecting cancels requests and drops cached data.
- `src/lib/queries.ts` defines the TanStack Query options for the project, the paged logs, notification details, and sends.
- `src/router.tsx` defines the TanStack Router routes. The user filter, open notification, and send dialog live in validated search params.
- `src/components` holds the page. Shared primitives come from `@pushlane/ui`.

Add a shadcn component to the shared package from this directory with `pnpm dlx shadcn@4.23.0 add <name>`. The CLI writes it to `packages/ui`.

React renders notification payloads and provider errors as text. Do not use `dangerouslySetInnerHTML`. The Content Security Policy forbids inline styles and runtime code evaluation, and `pnpm smoke` fails on any violation. A successful send reports durable acceptance. The page does not label provider acceptance as device receipt.
