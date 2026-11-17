# Pushlane documentation

This workspace builds the Astro Starlight site from `src/content/docs`. The site is static and does not need the API to run.

```sh
pnpm docs:dev
pnpm docs:build
```

The documentation separates quickstart instructions, platform integration guides, and API reference. Match HTTP response fields and plan defaults to `libs/contracts` and `libs/core` when behavior changes.

The repository has no published SDK packages or hosted billing integration yet. Keep those limits explicit until the release actually provides them.
