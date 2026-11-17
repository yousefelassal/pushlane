---
title: Register a native Android app
description: Associate an FCM token with an authenticated user.
sidebar:
  order: 3
---

Add Firebase Cloud Messaging to your Android app and configure [FCM credentials](/guides/providers/#fcm) for the Pushlane project.

Create your notification channel on Android 8 and later. Request the notification runtime permission on Android 13 and later before expecting notifications to appear.

## Register the FCM token

Keep a stable UUID for this app installation. Authenticate the user with your backend and obtain a Pushlane registration token bound to that UUID.

Read the current Firebase Messaging token. Register it with Pushlane.

```http
PUT /v1/installations/5d62f7f6-2749-4d1d-8f56-1f39c16c9df2
Authorization: Bearer <registration-token>
Content-Type: application/json

{
  "kind": "fcm",
  "token": "<fcm-registration-token>"
}
```

Send replacement tokens from `FirebaseMessagingService.onNewToken()` to the same installation ID. Refresh the registration token through your authenticated backend when it expires.

Add `sdks/android` as a composite Gradle build. There is no published Maven artifact yet. Persist a UUID in app-private preferences and pass it to the client.

```kotlin
val push = Pushlane("https://push.example.com", installationId)

withContext(Dispatchers.IO) {
    push.register(fcmToken, tokenFromYourBackend)
}
```

The client uses blocking HTTP calls, so call it on a background dispatcher. Call `push.unregister()` before clearing login state. The package does not request permission or configure Firebase. Keep the backend API key out of the app. Read the package's [integration instructions](https://github.com/yousefelassal/pushlane/tree/main/sdks/android) for Gradle configuration.

## Handle notifications

FCM handles notification messages differently when the app is in the foreground and background. Implement `onMessageReceived()` for the behavior your app needs. Validate the `url` field before navigating after a tap.

Pushlane sends an Android notification image when `image` is present. Retain the title and body as the fallback if the image cannot load.

Read [Firebase message handling](https://firebase.google.com/docs/cloud-messaging/android/receive).

## Log out

Call `DELETE /v1/installations/:installationId` with the registration token and wait for success. Obtain a new registration token before registering the installation for another account.
