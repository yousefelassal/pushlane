---
title: Register a native iOS app
description: Associate an APNs token with an authenticated user.
sidebar:
  order: 2
---

Enable the Push Notifications capability and configure [APNs credentials](/guides/providers/#apns) for the project. Request notification permission with `UNUserNotificationCenter`, then call `registerForRemoteNotifications()`.

## Register the APNs token

Keep a stable UUID for this app installation. Authenticate the user with your backend and obtain a Pushlane registration token bound to that UUID.

Convert the `Data` token from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` to lowercase hexadecimal. Send the endpoint using the registration token.

```http
PUT /v1/installations/5d62f7f6-2749-4d1d-8f56-1f39c16c9df2
Authorization: Bearer <registration-token>
Content-Type: application/json

{
  "kind": "apns",
  "token": "<hexadecimal-apns-device-token>",
  "sandbox": true
}
```

Use `sandbox: false` for production builds. Register again whenever APNs gives the app a token. Do not assume a previously stored token remains valid.

Add `sdks/swift` as a local Swift package in Xcode. There is no published package release yet. The SDK persists an installation UUID in app-local preferences.

```swift
import Pushlane

let push = try Pushlane(baseURL: URL(string: "https://push.example.com")!)

// Ask your authenticated backend for a token bound to push.installationId.
try await push.register(
    deviceToken: deviceToken,
    registrationToken: tokenFromYourBackend,
    sandbox: true
)
```

Keep `push` alive for the signed-in session. Call `try await push.unregister()` before clearing login state. After an app restart, obtain a new token and pass it to `unregister(registrationToken:)`. The package does not request permission or require your backend API key.

## Add notification images

Add a Notification Service Extension target to the app. The extension downloads the `image` URL in the notification payload, attaches the file with `UNNotificationAttachment`, and calls the content handler before its time limit.

Pushlane sets APNs `mutable-content` for image notifications. Keep a text fallback if the image cannot load. Images require app-side handling and are not guaranteed to appear.

Follow [Apple's notification content modification guide](https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications).

## Handle foreground notifications and taps

Set a `UNUserNotificationCenterDelegate`. Choose how your app presents a foreground notification. On a tap, read the `url` field and validate its destination before navigating.

## Log out

Call `DELETE /v1/installations/:installationId` with the registration token. Wait for the response, then clear the client identity. Request a new registration token from your backend when another user signs in.

APNs acceptance does not prove that iOS displayed the notification. See [delivery states](/reference/delivery/).
