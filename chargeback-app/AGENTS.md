<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Caching model assumes ONE long-lived Node process

The whole cache-coherence design (`"use cache"` + `cacheTag` in `src/dal/`, `updateTag` in `src/actions/`, the global "Refresh data" button) relies on Next's default **in-memory** cache handler: one user's `updateTag` is visible to everyone because everyone shares the same process. Do not deploy this app serverless or as multiple replicas without switching to a shared cache (`'use cache: remote'` or a custom `cacheHandlers` in `next.config.ts`) — otherwise cross-user invalidation silently breaks and each instance re-fires warehouse queries independently.
