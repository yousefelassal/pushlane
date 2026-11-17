# Pushlane JavaScript SDK

The package provides separate server, browser, and service worker entry points. Build it with `pnpm sdk:build` from the repository root. It has not been published to npm yet. In this monorepo, depend on `@pushlane/sdk` with `workspace:*`.

## Backend

```ts
import { Pushlane } from '@pushlane/sdk/server';

const push = new Pushlane({
  baseUrl: 'https://push.example.com',
  apiKey: process.env.PUSHLANE_API_KEY!,
});

const notification = await push.send(
  {
    userId: 'user_123',
    title: 'Your order shipped',
    body: 'Your package arrives tomorrow.',
    image: 'https://example.com/package.jpg',
    url: 'https://example.com/orders/123',
  },
  { idempotencyKey: 'order-123-shipped' },
);
```

The receipt confirms durable acceptance. It does not confirm a device received the notification. Reuse an idempotency key only when retrying the same logical send. The SDK does not retry requests implicitly.

Use `listNotifications({ userId, limit, before })` to read logs. Pass the returned `nextCursor` as `before` for another page. `getNotification(id)` returns the notification and device attempts.

## Registration tokens

After authenticating the current user in your backend, issue a token for the installation ID supplied by the app.

```ts
const registration = await push.createRegistrationToken({
  userId: authenticatedUser.id,
  installationId: validatedInstallationId,
});
```

Return `registration.token` to the authenticated app. The session expires after one hour and grants access only to that installation. Issuing another token replaces the previous session. Never accept an unauthenticated user ID from the client or expose the project API key.

## Browser

```ts
import { BrowserPush } from '@pushlane/sdk/browser';

const push = new BrowserPush({
  baseUrl: 'https://push.example.com',
  applicationServerKey: 'your-project-vapid-public-key',
  serviceWorkerUrl: '/pushlane-sw.js',
  getRegistrationToken: async (installationId) => {
    const response = await fetch('/api/push-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId }),
    });

    if (!response.ok) throw new Error('Could not obtain a registration token.');

    const registration = await response.json();

    return registration.token;
  },
});

enableNotificationsButton.addEventListener('click', () => {
  void push.register().catch(showRegistrationError);
});
```

The SDK persists only the installation UUID in local storage. It keeps registration credentials in memory. Call `register()` after sign-in or token changes to refresh the binding. The method requests permission only when called, so invoke it from a user gesture. Native browser requirements still apply, including Home Screen installation for Web Push on iOS.

Your `/api/push-registration` endpoint must authenticate the user and protect the request against CSRF. If the Pushlane API uses another origin, configure its CORS allowlist for your app origin.

Before clearing the app's authenticated login state, call and await `push.unregister()`. It revokes this session's server binding and keeps the browser subscription, which another tab may use for a newer account. It never obtains a fresh token implicitly during logout. After a reload, pass an explicit registration token obtained after resolving the current authenticated user to `push.unregister(token)`. If revocation fails, report the failure and retry before completing logout. Already authorized provider requests cannot be recalled.

Each client serializes registration and logout. Keep one client per app session and await lifecycle operations before changing the authenticated account. Across tabs, the server rejects revoked registration sessions. A stale tab can revoke only its own server session and cannot unsubscribe another tab's browser subscription.

## Service worker

Create a worker source in your app.

```ts
/// <reference lib="webworker" />
import { installPushHandlers } from '@pushlane/sdk/service-worker';

declare const self: ServiceWorkerGlobalScope;

installPushHandlers(self);
```

Bundle that source with your app's build tool into a classic worker at `/pushlane-sw.js`. Do not serve the package file directly because it imports dependencies. For example, esbuild can bundle the source with `--bundle --format=iife --outfile=public/pushlane-sw.js`. The worker displays title, body, and supported images. It opens only HTTPS click destinations, with the app origin as a fallback. It does not collect delivery or opening telemetry.
