FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build && pnpm dashboard:build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
RUN corepack enable
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3020
CMD ["pnpm", "start"]
