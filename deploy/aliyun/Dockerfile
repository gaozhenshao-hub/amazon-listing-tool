# This Dockerfile is intentionally outside the repository root so Manus WebDev
# continues to use its managed deployment image. It is only for independent ECS deployment.
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ARG VITE_AUTH_MODE=local
ARG VITE_ENABLE_MERGED_LISTING_WORKFLOW=1
ARG VITE_ENABLE_MERGED_READONLY_FEATURES=1
ARG VITE_ENABLE_NORTH_AMERICA_BOARD=1
RUN pnpm run build && pnpm run release:check && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV AMAZON_BROWSER_ENABLED=true

RUN groupadd --system app && useradd --system --gid app --create-home app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts ./scripts

USER app
EXPOSE 3000

CMD ["node", "dist/index.js"]
