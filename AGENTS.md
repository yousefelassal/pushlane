# Working on Pushlane

Use Node.js 24 and pnpm 10.32.1. The NestJS 12 API and worker are ESM. Relative TypeScript imports end in `.js`. Astro Starlight and the dashboard are separate pnpm workspaces.

Read `docs/architecture.md` before changing authentication, endpoint ownership, queue state, or allowance reservation. HTTP inputs and external provider responses are untrusted. Parse them at their boundaries. Keep shared shapes in `libs/contracts`.

Use the existing Oxlint and Prettier configuration copied from Pushpilot. Add JSDoc to public TypeScript APIs. Explain the contract or non-obvious behavior. Keep blank lines between logical operations. Avoid comment narration and unnecessary wrappers.

Notifications and delivery jobs must commit atomically. Every project lookup must include project scope. A registration token must never grant backend permissions. Logout and account switching must not resurrect old bindings. Endpoint invalidation must match the dispatched version and session.

Tests must exercise observable behavior. Integration tests use a dedicated PostgreSQL database. Keep credentials, `.env` files, provider tokens, and build outputs out of Git.

Run `pnpm check` and `pnpm test:integration` for backend changes. Run the relevant Swift or Kotlin checks for native client changes. A passing build does not establish physical-device delivery. Never label provider acceptance as confirmed receipt.
