---
title: Delivery states
description: What each queue and provider state establishes.
sidebar:
  order: 2
---

A notification is one backend request. A delivery is its work for one installation. An attempt records one dispatch outcome.

## Queued

The database committed the notification and delivery. A worker has not claimed the delivery yet.

## Processing

A worker holds a time-limited lease. The worker checks the installation binding before authorizing a provider request. If the worker crashes, another worker can reclaim the delivery after the lease expires.

## Provider accepted

APNs, FCM, or the browser push service accepted the request. This is not proof that the device received, displayed, or opened the notification.

## Retrying

The provider returned a transient failure or the connection outcome is uncertain. The worker schedules another bounded attempt. An uncertain result can mean that the provider accepted a request before the connection failed, so retries can produce duplicates.

## Failed

The provider rejected the request permanently, credentials were unavailable, or the retry limit was reached. A confirmed invalid endpoint can also retire that installation's endpoint version.

## Expired

The notification's lifetime elapsed before the worker could complete dispatch. Expired work is not submitted again.

## Suppressed

The installation's authenticated user, session, or endpoint binding changed before dispatch authorization. A user who logs out does not leave pending work eligible for a later account on the same installation.

## No registered devices

The user had no active installations when the API accepted the notification. The notification remains visible in logs, with zero deliveries.

## Read logs without overstating delivery

The dashboard shows provider acceptance and failure codes. It does not invent receipt or opening events. Verifying visible delivery requires the actual platform and device. A successful HTTP 202 from Pushlane establishes durable acceptance by Pushlane only.
