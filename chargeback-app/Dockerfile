# syntax=docker/dockerfile:1

# Debian slim (glibc), NOT Alpine: the @databricks/sql driver ships
# platform-specific native kernels built for linux-*-gnu (glibc). On Alpine
# (musl) the real-warehouse path breaks. Node 22 matches local development.

# ---- deps: install all dependencies (build tools present for native builds) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# python3/make/g++ let any dependency with a native build step (e.g. lz4)
# compile; they live only in this throwaway stage, not in the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `npm install`, not `npm ci`: the committed lock is generated on macOS and is
# missing Linux-only optional deps (@emnapi/*, the linux @databricks native
# kernels), so `npm ci`'s strict sync check fails in this glibc image. install
# reconciles those against the lock while keeping pinned versions.
RUN npm install --no-audit --no-fund

# ---- builder: produce the standalone production build ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No DATABRICKS_HOST at build time => DAL_MOCK is on => the build (incl. the
# instant-nav page validation) renders from in-memory fixtures and never
# contacts a warehouse. Real Databricks/Entra config is supplied at run time.
RUN npm run build

# ---- runner: minimal production image ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Next standalone server + its traced node_modules, plus static and public assets.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# Liveness: the static /api/healthz route — no auth, no warehouse. Uses Node's
# global fetch so the slim image needs no curl/wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# On boot, instrumentation.ts self-fetches /api/warm to fill the in-memory cache.
CMD ["node", "server.js"]
