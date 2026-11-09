# syntax=docker/dockerfile:1
# DevRelay production image: API, worker and the one-off commands
# (migrations, admin bootstrap) all run from the same image.
#
#   API:      node dist/server/index.js   (default CMD)
#   Worker:   node dist/server/worker/index.js
#   Migrate:  node dist/server/db/migrate.js
#   Admin:    node dist/server/scripts/bootstrap-admin.js
#
# The compiled server depends only on production dependencies (pg, drizzle-orm,
# express, …). Build tools (tsx, drizzle-kit, vite) exist only in the build stage.

# ---------- build: compile server + bundle web ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json ./
COPY server ./server
COPY web ./web
RUN npm run build

# ---------- runtime: production dependencies only ----------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Migrations are applied at deploy time (`node dist/server/db/migrate.js`,
# Fly release_command, Render preDeploy) and read from this folder:
COPY drizzle ./drizzle
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
