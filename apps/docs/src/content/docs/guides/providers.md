---
title: Configure push providers
description: Connect APNs, FCM, and browser Web Push credentials.
sidebar:
  order: 1
---

Provider credentials belong to a project. Prepare a JSON file outside the repository and pass it to the project creation command. Keep private keys out of Git.

Create the project with your credentials file.

```sh
pnpm project:create --name "My app" --credentials ./credentials.json
```

The credentials object accepts `apns`, `fcm`, and `webpush`. Include the providers that your app uses.

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
    "clientEmail": "firebase-adminsdk@example.iam.gserviceaccount.com",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  },
  "webpush": {
    "subject": "mailto:push@example.com",
    "publicKey": "YOUR_VAPID_PUBLIC_KEY",
    "privateKey": "YOUR_VAPID_PRIVATE_KEY"
  }
}
```

## APNs

Enable Push Notifications for your app in Xcode and in its Apple developer identifier. Create an APNs authentication key in your Apple developer account. Provide the team ID, key ID, private key, and app bundle ID.

Register development device tokens with `sandbox: true`. Register production tokens with `sandbox: false`. A token must match its app and APNs environment.

Follow [Apple's APNs setup guide](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns).

## FCM

Add Firebase to your Android app and enable the Firebase Cloud Messaging API. Create a service account with permission to send FCM messages in that project. Supply its project ID, client email, and private key.

Follow the [Firebase Android client setup](https://firebase.google.com/docs/cloud-messaging/android/client).

## Web Push

Generate a VAPID key pair and keep the private key on the server. Give the public key to your website so that it can create subscriptions. Use a contact email or HTTPS URL as the VAPID subject.

The sending adapter accepts known browser push service destinations. Arbitrary HTTPS endpoints are rejected to prevent server-side requests to untrusted destinations.

A browser subscription contains an endpoint and encryption keys. Treat the entire subscription as a credential. See [the Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
