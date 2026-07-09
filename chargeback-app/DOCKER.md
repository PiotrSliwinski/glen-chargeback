# Running the chargeback app in Docker

A multi-stage [`Dockerfile`](./Dockerfile) produces a small production image from
Next's standalone output. Run it as **one** container (see the constraint below).

## Build

```bash
# from chargeback-app/
docker build -t chargeback-app .
```

The build runs with no `DATABRICKS_HOST`, so `DAL_MOCK` is on and the build (page
data + instant-nav validation) renders from in-memory fixtures — it never needs a
warehouse. Real config is supplied at run time.

## Run

**Mock mode (zero config, for a smoke test):**

```bash
docker run --rm -p 3000:3000 chargeback-app
# → http://localhost:3000  (in-memory fixtures; no sign-in, runs as APP_ROLE)
```

**Production (real Databricks + Entra ID):**

```bash
cp .env.example .env    # then fill it in — never commit .env
docker run --rm -p 3000:3000 --env-file .env chargeback-app
```

Or with Compose (reads `.env` automatically):

```bash
docker compose up --build
```

Configuration keys are documented in [`.env.example`](./.env.example). At minimum
production needs `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DBX_SCHEMA`, and
warehouse credentials (below). The app does no user sign-in — gate access at the
network/platform layer.

### Warehouse auth

`DATABRICKS_AUTH=azure` (the default) acquires an Entra ID token via
`DefaultAzureCredential`. The same setting resolves the right identity wherever
the container runs — you choose the identity by what you inject, not by changing
the mode:

- **Entra ID SPN — client id + secret.** `DefaultAzureCredential`'s
  EnvironmentCredential reads these env vars directly; the SP must be added to
  the Databricks workspace with SQL-warehouse access.

  ```bash
  docker run --rm -p 3000:3000 \
    -e DATABRICKS_HOST=adb-xxxx.x.azuredatabricks.net \
    -e DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/xxxxxxxx \
    -e DBX_SCHEMA=main.cost_reporting \
    -e AZURE_TENANT_ID=<tenant-guid> \
    -e AZURE_CLIENT_ID=<spn-client-id> \
    -e AZURE_CLIENT_SECRET=<spn-password> \
    chargeback-app
  ```

- **Workload / managed identity** (AKS, App Service, Container Apps). Inject
  **no secret at all** — the platform supplies the credential and
  `DefaultAzureCredential` picks it up. Preferred for production.

- **Databricks-generated OAuth secret** (`DATABRICKS_AUTH=databricks-oauth`, the
  default when `DATABRICKS_CLIENT_SECRET` is set) — a Databricks-native secret,
  not an Entra credential: set `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`.

In practice put these in `.env` and use `--env-file .env` / `docker compose`.
With `databricks-oauth`, the container fails fast at boot if
`DATABRICKS_CLIENT_ID` or `DATABRICKS_CLIENT_SECRET` is missing. If the
managed-identity probe adds startup latency where it can't apply, pin the chain
with `AZURE_TOKEN_CREDENTIALS=prod` (or `dev`).

## ⚠️ Run exactly one instance

This app's cache coherence relies on a single shared **in-memory** cache in a
single Node process (see [`AGENTS.md`](./AGENTS.md)): one user's `updateTag` /
"Refresh data" is visible to everyone only because everyone hits the same
process. **Do not** run multiple replicas, `docker compose up --scale`, a
multi-pod Deployment, or a serverless target without first switching to a shared
cache handler (`cacheHandlers` in `next.config.ts` or a remote cache) —
otherwise cross-user invalidation silently breaks and each instance re-queries
Databricks independently.

## Target architecture

The `@databricks/sql` native kernel is architecture-specific, so build for the
platform you deploy to. Building on an Apple-Silicon Mac produces an **arm64**
image; for an x86-64 server build explicitly:

```bash
docker build --platform linux/amd64 -t chargeback-app .
```

(Or `docker buildx build --platform linux/amd64,linux/arm64` for both.)

## Notes

- **Base image is Debian slim, not Alpine.** The `@databricks/sql` driver ships
  glibc-native kernels; on musl the real-warehouse path fails. `next.config.ts`
  also force-includes those native packages in the standalone trace via
  `outputFileTracingIncludes`.
- On boot, `instrumentation.ts` self-fetches `/api/warm` to pre-fill the cache;
  look for `[boot-warm] N queries cached` in the logs.
- Health check hits the static `/api/healthz` route (no auth, no warehouse).
- The container listens on `PORT` (default `3000`) and binds `0.0.0.0`.
