---
"@chriskite/effect-orpc": patch
---

Emit a one-time `console.warn` when a `.useEffect()` middleware runs while no
fiber-context bridge is installed. The previous behavior was a silent no-op —
middleware FiberRefs (e.g. `Effect.annotateLogs` applied to `next()`) failed
to reach downstream `.effect()` handlers with no diagnostic. The warning
points to the `@chriskite/effect-orpc/node` import that installs the
AsyncLocalStorage-backed bridge.
