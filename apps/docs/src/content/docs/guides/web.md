---
title: Register a web app
description: Register a browser PushSubscription under an authenticated user.
sidebar:
  order: 4
---

Web Push needs HTTPS outside localhost, a service worker, notification permission, and your project's VAPID public key.

On iOS, web push is available to supported Home Screen web apps. Guide the user through installation before requesting permission. Browser support for notification images varies.

## Create a subscription

Request permission from a user action, such as a button press. Register your service worker and subscribe with your VAPID public key.

The browser returns a `PushSubscription` with an HTTPS endpoint and `p256dh` and `auth` encryption keys. Keep a stable installation UUID in this browser profile. Obtain a registration token for that UUID from your authenticated backend.

Register the subscription with Pushlane.

```http
PUT /v1/installations/5d62f7f6-2749-4d1d-8f56-1f39c16c9df2
Authorization: Bearer <registration-token>
Content-Type: application/json

{
  "kind": "webpush",
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "<subscription-public-key>",
      "auth": "<subscription-auth-key>"
    }
  }
}
```

The TypeScript client lives in `packages/sdk`. It is available as a workspace dependency and is not published to npm yet. Import `BrowserPush` from `@pushlane/sdk/browser`.

Configure `baseUrl`, `applicationServerKey`, and `getRegistrationToken`. The callback receives the browser's installation UUID and must obtain a token from your authenticated backend. Call `register()` from a user gesture. The SDK creates or reuses a subscription, then registers it with Pushlane.

The browser entrypoint accepts installation registration credentials, never the project backend key. Read the [SDK examples](https://github.com/yousefelassal/pushlane/tree/main/packages/sdk) for the browser callback and service worker setup.

## Display a notification

Handle the service worker's `push` event. Pass the payload's title, body, and optional image to `showNotification()`. Store the optional `url` in notification data for the click handler.

Validate a click destination before opening it. A notification must remain useful when an image is unsupported or fails to load.

Read [service worker push events](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event).

## Refresh and revoke

Register a replacement browser subscription under the same installation ID. On logout, revoke the Pushlane installation with `DELETE /v1/installations/:installationId` before discarding the registration token.

Unsubscribing from the browser alone does not replace server-side logout. Pushlane also retires endpoints when a push provider confirms that they are invalid.

Browser SDK lifecycle operations are serialized within a client. Logout revokes only the server binding and keeps the browser subscription, which another tab may use. After a reload, explicitly supply a registration token obtained after resolving the currently authenticated user to `push.unregister(token)`. Logout never mints a token implicitly. Await lifecycle operations before switching accounts.
