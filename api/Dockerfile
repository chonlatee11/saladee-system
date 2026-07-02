# Production image for the Saladee API (Bun/Elysia).
# The database is external (Neon), so this image only runs the API and the
# Drizzle migrator. `drizzle-kit` is a devDependency (used by `bun run db:migrate`),
# so we deliberately do NOT install with --production.
#
# Build context is the REPO ROOT (workspace install needs the root lockfile +
# every workspace manifest):  docker build -f api/Dockerfile .
FROM oven/bun:1.3.14-slim
WORKDIR /app
ENV NODE_ENV=production

# 1) Dependencies — copy only manifests first so this layer caches until a
#    package.json or the lockfile changes.
COPY package.json bun.lock ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN bun install --frozen-lockfile

# 2) API source (the web workspace is built + deployed separately to Pages).
COPY api ./api

WORKDIR /app/api
EXPOSE 3000
# import.meta.main is true here, so the app binds :3000 (0.0.0.0). The migrate
# service overrides this command with `bun run db:migrate`.
CMD ["bun", "run", "src/index.ts"]
