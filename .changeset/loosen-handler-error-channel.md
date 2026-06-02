---
"@chriskite/effect-orpc": minor
---

Loosen `EffectProcedureHandler` and `EffectMiddlewareHandler` failure channels to `any`.

Previously the yielded `Effect` had to fail with `EffectErrorMapToUnion<TEffectErrorMap> | ORPCError`, which forced callers to `Effect.mapError(...)` every untyped Effect failure (commonly a `SqlError` from `@effect/sql-drizzle` or `@effect/sql-pg`) into a declared tagged error just to satisfy the type system.

Handlers may now yield Effects with any failure type. Declared errors remain ergonomic through the `errors.XXX(...)` constructor map; undeclared failures are caught by `toORPCErrorFromCause` at the runtime boundary and surfaced to the wire as `INTERNAL_SERVER_ERROR` with `defined: false` (runtime behavior unchanged — only the type-level constraint is relaxed).

This is a non-breaking change for existing handlers: their stricter inferred failure channel is still assignable to `any`.
