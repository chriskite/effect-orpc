---
"@chriskite/effect-orpc": minor
---

Add `.useEffect(fn)` for Effect-native middleware.

Previously, middleware authored against `EffectBuilder.use(...)` had to use plain
oRPC middleware signatures, meaning any code that needed a service from the
`ManagedRuntime` (auth, rate limiting, audit logging) had to manually call
`Effect.runPromise(...)` inside the middleware body — the exact wart that
`effect-orpc` cleans up for procedure handlers.

`useEffect` accepts a generator-style handler (the same shape as `.effect()`)
and returns a builder that has registered an Effect-native middleware:

```ts
const authed = effectOs.useEffect(function* ({ next, context }) {
  const user = yield* AuthService.authenticate(context.token)
  return yield* next({ context: { ...context, user } })
})
```

The bridge:

- Provides an Effect-shaped `next` that wraps the downstream `Promise` in
  `Effect.tryPromise`, surfacing downstream `ORPCError` rejections as typed
  Effect failures so middlewares may `Effect.catchAll` / `Effect.catchTag` over
  them.
- Captures the middleware fiber's `FiberRefs` immediately before each `next()`
  call and installs them in the fiber-context bridge for the duration of the
  downstream call, preserving the documented guarantee that request-scoped
  state set inside a middleware Effect propagates to downstream `.effect()`
  procedures.
- Inherits FiberRefs captured by an outer `withFiberContext(...)` scope so
  HTTP-adapter-level request context still reaches the middleware Effect.
- Maps failures through `toORPCErrorFromCause`, so middleware errors flow
  through oRPC's error pipeline the same way `.effect()` failures do
  (including the abort → `CLIENT_CLOSED_REQUEST` translation).

`useEffect` is exposed on `EffectBuilder`, all builder variants, and
`EffectDecoratedProcedure`. New exports: `EffectMiddlewareHandler`,
`EffectMiddlewareNextFn`, `EffectMiddlewareOptions`, and
`createEffectMiddlewareHandler` (for advanced/integration use).
