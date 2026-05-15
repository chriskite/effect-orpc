---
"@chriskite/effect-orpc": minor
---

Documentation and governance:

- README's "Request-Scoped Fiber Context" section now includes:
  - **Runtime requirements** — explicit note that `withFiberContext` requires `node:async_hooks` (Node ≥ 18, Bun ≥ 1.2) and silently no-ops on edge runtimes lacking it; documents the interruption caveat of `Effect.promise`.
  - **Single-runtime expectation** — explains the module-scoped `AsyncLocalStorage` and the cross-runtime contamination risk for apps running multiple `ManagedRuntime` instances.
  - **Lifecycle** — clarifies that the runtime is application-scoped, per-request resources belong inside handlers, and `runtime.dispose()` is a graceful shutdown.
- Added matching JSDoc to `withFiberContext` in `src/node.ts`.
- Added `SECURITY.md` (private vulnerability reporting) and `CONTRIBUTING.md` (one-page setup + workflow).
- Synced the `EffectBuilder` API table with `EffectBuilderSurface` — added the missing `.middleware(fn)` row.
- Fixed naming inconsistency in `examples/README.md` — the folder is `hono/`, not `hono-request-context`.
