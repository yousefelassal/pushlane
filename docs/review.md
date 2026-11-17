# Implementation review

An independent read-only review ran on `gpt-6.2-astra`, task `/root/correctness_review`, during the initial implementation session on 2026-11-17. It did not write the implementation. The review found the following defects before the first push.

- A single Node BlockList mixed IPv4 and mapped IPv6 ranges and rejected public IPv4 destinations. The fix separates address-family lists and adds positive public IPv4, IPv6, and dual-stack provider tests.
- Moving an endpoint to another installation left the displaced session authorized. The fix revokes displaced sessions atomically and canonicalizes APNs token case.
- Endpoint versions did not advance for Web Push key changes or APNs sandbox changes. A separate full-endpoint fingerprint now controls versions and protects replacements from stale invalid-token responses.
- Swift and browser lifecycle operations could finish out of order and retain an old session token. The SDK follow-up serializes lifecycle operations.
- Browser logout unsubscribed the shared subscription after a stale session's no-op revocation. The SDK follow-up makes logout revoke only the server binding.
- APNs opened a new connection on every dispatch. The provider follow-up reuses bounded credential-scoped connections and authentication tokens.
- FCM could send expired work after authentication. The provider follow-up checks expiry before sending and caches OAuth tokens.
- The worker shortened long provider retry delays. Retry scheduling now respects the provider delay and wakes at notification expiry if that happens first.
- An integration test named an API restart but only replaced database connections. The corrected test closes and recreates the real API server before dispatching persisted work.

The initial review was a failure gate. Follow-up verification and review results belong in the decision log. Passing this review does not establish real-device delivery, notification image presentation, a deployed cloud service, or payment collection.
