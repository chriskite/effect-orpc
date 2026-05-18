---
"@chriskite/effect-orpc": minor
---

Correctness and developer-ergonomics polish:

- Replaced the manual three-step FiberRefs orchestration in the procedure handler with `Effect.inheritFiberRefs`. Functionally equivalent, one Effect node per request instead of three, and the local variable rename (`parentFiberRefs` → `capturedFiberRefs`) removes confusing parent/child terminology that didn't match the `joinAs` semantics.
- `ORPCTaggedError`'s invalid-status guard now throws an `ORPCError("INTERNAL_SERVER_ERROR", …)` instead of a native `Error`, so the library's error system stays closed under construction failures.
- Added a shape guard in `getEffectInternals`: builders/procedures that are missing the internal symbol now throw a clear `TypeError` instead of crashing with confusing downstream errors.
- Documented the zero-argument, side-effect-free constructor contract for tagged-error subclasses passed to `.errors()` (consumed by `effectErrorMapToErrorMap`).
- Added a top-of-module comment in `extension/state.ts` explaining the two parallel internal slots (`~orpc` for upstream identity, `~effect` for runtime/errorMap/spanConfig).
