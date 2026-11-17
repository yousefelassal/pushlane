---
title: Plans and usage
description: Initial plan allowances and the boundary between open source and managed hosting.
sidebar:
  order: 3
---

The complete sending core is open source. Self-hosted projects do not have a software dispatch allowance or a plan-based log expiry.

## Cloud plan defaults

The initial `free` plan allows 10,000 monthly dispatches and seven days of logs. The initial `pro` plan allows 1,000,000 monthly dispatches and 30 days of logs. These are implementation defaults, not published prices or a hosted service offer.

A dispatch allowance counts target installations. One notification targeting three installations reserves three dispatches. Provider retries do not reserve additional dispatches. Usage reservation and notification acceptance happen in the same database transaction.

Logs expire according to their project's plan. Retention affects diagnostic history, so export or retain operational records separately when your own requirements demand it.

## Buy Pro with Paymob

A server with Paymob configured sells Pro one month at a time. Each settled payment moves a `free` project to `pro` and extends its paid period by one month from the later of now and the current expiry. `GET /v1/project` reports the end of that period as `planExpiresAt`. The worker returns a lapsed project to `free` within an hour of expiry. Its existing monthly usage then counts against the free allowance.

Payments do not renew automatically. Self-hosted projects and `pro` projects without an expiry cannot buy a period. The price and currency come from server configuration, never from the request.

## What needs a later integration

This repository does not renew subscriptions automatically, issue refunds, provision hosted accounts, or provide team sign-in. The plan model provides a boundary for those integrations without changing the registration or sending API.

Managed hosting can charge for operation, usage, longer retention, team controls, and support. Self-hosted users keep the same API and provider adapters.
