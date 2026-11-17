---
title: Authenticate installations
description: Keep backend keys private and revoke installation sessions on logout.
sidebar:
  order: 5
---

Pushlane trusts your backend to establish who a user is. A browser or mobile client cannot register under an arbitrary user ID using a public project identifier.

## Issue registration tokens from your backend

Authenticate the current user in your application. Generate or read the client's stable installation UUID. Call `POST /v1/registration-tokens` with that UUID and the authenticated user's ID. Return the short-lived registration token to the client.

Do not accept a request body user ID as proof of identity. Derive the ID from your own authenticated session.

Registration permission expires after one hour. An expired token can still revoke its own session so that expiry does not prevent logout. The database stores only its hash. The token is bound to the project, user ID, and installation UUID. It cannot send notifications, issue another token, or read logs.

Issuing a new token for the same installation revokes its previous session. Use this behavior when an installation changes accounts. Pending work for the replaced session is suppressed. Register the new session promptly. Refresh the registration token through your authenticated backend before it expires.

## Register and refresh the endpoint

Call `PUT /v1/installations/:installationId` with the registration bearer token and the current endpoint. Register again when APNs, FCM, or the browser issues a replacement endpoint.

Pushlane updates endpoint versions so that a late failure response cannot retire a newer endpoint.

## Revoke on logout

Call `DELETE /v1/installations/:installationId` with the registration bearer token before discarding it. Wait for a successful response before treating server-side push logout as complete. Retry a network failure.

A revoked token cannot register the installation again. A new login needs a new token from your authenticated backend.

Pending deliveries retain the user and installation session they were created for. A worker checks the current binding before authorizing a provider dispatch. Logout cannot recall a request that was already authorized or accepted by a provider.

## Protect project secrets

Keep the backend API key on trusted servers. The dashboard needs that key and should be available only to trusted operators. The current dashboard does not provide team accounts or role-based access.

Use TLS outside local development. Encrypt database backups and preserve the deployment encryption key separately. Losing that key makes stored provider credentials and endpoints unreadable.

Use separate projects and credentials for development and production. Redact tokens, private keys, authorization headers, and notification content from application logs.
