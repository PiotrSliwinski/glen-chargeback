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
docker run --rm -p 3000:3000 \
  -e AUTH_DEV_BYPASS=true -e AUTH_DEV_ROLE=publisher \
  chargeback-app
# → http://localhost:3000  (in-memory fixtures, sign-in bypassed)
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
production needs `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DBX_SCHEMA`, warehouse
credentials (below), `AUTH_SECRET`, `AUTH_URL`, and the Entra group IDs.

### Warehouse auth with a service principal

Pick the mode that matches where your secret came from:

- **Entra ID SPN — client id + secret from the Azure portal** (`DATABRICKS_AUTH=azure-spn`).
  The app exchanges the secret for an Entra token, so it also needs the tenant.
  The SP must be added to the Databricks workspace and granted access to the
  SQL warehouse.

  ```bash
  docker run --rm -p 3000:3000 \
    -e DATABRICKS_HOST=adb-xxxx.x.azuredatabricks.net \
    -e DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/xxxxxxxx \
    -e DBX_SCHEMA=main.cost_reporting \
    -e DATABRICKS_AUTH=azure-spn \
    -e ENTRA_TENANT_ID=<tenant-guid> \
    -e DATABRICKS_CLIENT_ID=<spn-client-id> \
    -e DATABRICKS_CLIENT_SECRET=<spn-password> \
    # ...plus AUTH_SECRET / AUTH_URL / ENTRA_* for user sign-in
    chargeback-app
  ```

- **Databricks-generated OAuth secret** (`DATABRICKS_AUTH=service-principal`, the
  default when `DATABRICKS_CLIENT_SECRET` is set) — same three `DATABRICKS_*`
  vars, no tenant needed.

In practice put these in `.env` and use `--env-file .env` / `docker compose`.
With `azure-spn`, the container fails fast at boot if `ENTRA_TENANT_ID`,
`DATABRICKS_CLIENT_ID`, or `DATABRICKS_CLIENT_SECRET` is missing.

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
- Health check hits the static `/login` page (no auth, no warehouse).
- The container listens on `PORT` (default `3000`) and binds `0.0.0.0`.
