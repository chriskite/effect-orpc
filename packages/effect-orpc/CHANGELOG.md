# effect-orpc

## 0.3.0

### Minor Changes

- 370a908: Packaging and CI hardening:

  - Emit real `.d.ts` files from `tsup`. Published types now point at `dist/*.d.ts` instead of `src/*.ts`, removing the dependency on `allowImportingTsExtensions` in consumer projects.
  - Stop shipping test sources in the npm tarball. The `tests/` directory is now a sibling of `src/` and is excluded from `files`. The `src/` directory is no longer shipped — only `dist/`, `LICENSE`, and `README.md`.
  - Tighten peer-dep ranges from `>=X.Y.Z` to `^X.Y.Z` for `@orpc/*` and `effect`. Each new major will be validated and bumped deliberately.
  - Add `description`, `homepage`, `bugs`, `engines` (`node: >=20`, `bun: >=1.2`), and `sideEffects` (with a carve-out for `./dist/node.js` which installs the fiber-context bridge at import time) to `package.json`.
  - Add a `ci.yml` workflow that runs `check`, `test`, and `build` on every pull request. Pin Bun to `1.3.9` in both workflows.
  - Sign npm publishes with `--provenance` via `NPM_CONFIG_PROVENANCE`.
  - Add `dependabot.yml` for monthly npm + github-actions updates, grouped by `@orpc/*`, `effect/@effect/*`, and dev tools.

- 370a908: Cancellation correctness and cause merging:

  - Client-aborted requests now surface as `ORPCError("CLIENT_CLOSED_REQUEST")` (status 499) instead of `INTERNAL_SERVER_ERROR` (500). Genuine fiber-level interrupts (e.g. runtime disposal) still surface as 500.
  - `Cause.Sequential` / `Cause.Parallel` no longer drop the right-hand failure. When both sides carry a cause, they are merged into an `AggregateError` on the surfaced `ORPCError.cause`, so a failed handler plus a failed finalizer remain visible in logs.
  - Defects produced by `Effect.die(...)` or unhandled throws are wrapped in `Error` before being attached to `cause` when the original defect is not already an `Error` instance.

  Added `tests/cancellation.test.ts` covering pre-aborted signals, mid-execution aborts, finalizer execution under abort, the non-abort interrupt path, abort-reason propagation, cause merging, and defect wrapping (13 new tests).

- 370a908: Tracing robustness:

  - `addSpanStackTrace` now walks the captured stack to find the first user frame outside `effect-orpc/src/` and `effect-orpc/dist/`, instead of reading a hardcoded `stack[3]` index. This fixes traces that previously pointed at library internals whenever the call depth from `.effect()` to user code was unusual (e.g. higher-order wrappers).
  - Stopped mutating `Error.stackTraceLimit`. V8's default of 10 is plenty for a single `new Error()`, and the prior set/restore created a race window in non-V8 runtimes.
  - The captured frame is now cached even when no user frame is found, so the split-and-walk cost is paid at most once per `.effect()` definition.

  Added `tests/tracing.test.ts` with a hand-rolled recording tracer asserting (a) the default span name is the procedure path, (b) `.traced(name)` overrides the span name, (c) the `code.stacktrace` attribute on failure spans points at user code (regression-guards the frame walker), and (d) the captured frame is cached across invocations.

- 370a908: Correctness and developer-ergonomics polish:

  - Replaced the manual three-step FiberRefs orchestration in the procedure handler with `Effect.inheritFiberRefs`. Functionally equivalent, one Effect node per request instead of three, and the local variable rename (`parentFiberRefs` → `capturedFiberRefs`) removes confusing parent/child terminology that didn't match the `joinAs` semantics.
  - `ORPCTaggedError`'s invalid-status guard now throws an `ORPCError("INTERNAL_SERVER_ERROR", …)` instead of a native `Error`, so the library's error system stays closed under construction failures.
  - Added a shape guard in `getEffectInternals`: builders/procedures that are missing the internal symbol now throw a clear `TypeError` instead of crashing with confusing downstream errors.
  - Documented the zero-argument, side-effect-free constructor contract for tagged-error subclasses passed to `.errors()` (consumed by `effectErrorMapToErrorMap`).
  - Added a top-of-module comment in `extension/state.ts` explaining the two parallel internal slots (`~orpc` for upstream identity, `~effect` for runtime/errorMap/spanConfig).

- 370a908: Test coverage additions (+30 new test cases):

  - **Concurrent isolation** (`tests/concurrent.test.ts`): N=50 concurrent requests through a shared builder verify that per-request `FiberRef`s set via `withFiberContext` don't cross-contaminate, plus a 20-request mix of pass/fail that asserts errors don't bleed across.
  - **Cancellation** (`tests/cancellation.test.ts`): pre-aborted signal, mid-execution abort, finalizer execution under abort, non-abort interrupt, abort-reason propagation, cause merging via `AggregateError`, and defect wrapping.
  - **Tracing** (`tests/tracing.test.ts`): hand-rolled recording tracer asserts span name, `.traced()` override, and `code.stacktrace` attribute points at user code (regression-guards the frame walker).
  - **Standard Schema** (`tests/standard-schema.test.ts`): non-Zod Standard Schema fixture verifies input/output validation works through `call()`.
  - **Lazy router** (`tests/lazy-invoke.test.ts`): invoke a procedure resolved from `unlazy(builder.lazy(...))` and assert it accesses a service from the runtime layer.
  - **Multi-layer error map** (`tests/middleware-errors.test.ts`): chained `.errors()` calls with mixed tagged + plain errors, plus duplicate-code shadowing.
  - **Runtime disposal** (`tests/dispose.test.ts`): graceful shutdown (in-flight requests complete) and post-disposal request rejection.
  - **Layer-init failure** (`tests/layer-failure.test.ts`): `ManagedRuntime.make(Layer.fail(...))` invocation surfaces as a 500 instead of hanging.
  - **`.callable()` / `.actionable()` round-trip** (`tests/callable-actionable.test.ts`): both produce working clients that round-trip through the Effect handler.
  - **Tagged-error wire round-trip** (`examples/hono/rpc-client.test.ts`): a new HTTP test asserts that a tagged error with a `data: { orderId }` payload survives serialization through the RPC client.

- 370a908: Type-system tightening:

  - Replaced `as any` casts at proxy/factory boundaries with the narrowest viable `as unknown as <T>` (or equivalent) casts and added one-line comments explaining what each one is asserting. Affected sites: `effect-builder.ts:178, 218, 226`, `effect-runtime.ts:153`, `contract.ts:420`, `tagged-error.ts:261`.
  - Added `tests/enhance-router-types.test.ts` with `expectTypeOf` assertions that pin the structural shape `enhanceEffectRouter` produces from a known fixture, so future refactors of `EnhancedEffectRouter` can't silently regress.
  - Evaluated `exactOptionalPropertyTypes: true` and deferred: the flag generates ~10+ errors in existing tests that explicitly pass `signal: undefined` for documentation clarity. The cost of fixing every call site outweighs the benefit on a codebase where `undefined` and key-absent are treated identically.

- 370a908: API surface audit (breaking — public surface narrowed):

  - Removed three implementation-detail helpers from the public surface (they remain available via deep imports for tests/advanced usage but are no longer documented or covered by semver):
    - `addSpanStackTrace`
    - `effectErrorMapToErrorMap`
    - `createEffectErrorConstructorMap`
  - Confirmed `effectContractSymbol` is and remains an internal symbol — not re-exported from `index.ts`. `eoc`-branded contracts are not externally extensible by design.

  If you were importing these helpers, you have two options:

  1. Switch to the public surface (most users only need `makeEffectORPC`, `implementEffect`, `eoc`, `ORPCTaggedError`).
  2. Pin a deep import (e.g. `@chriskite/effect-orpc/dist/tagged-error.js`) — but this is unsupported and may break at any time.

- 370a908: Documentation and governance:

  - README's "Request-Scoped Fiber Context" section now includes:
    - **Runtime requirements** — explicit note that `withFiberContext` requires `node:async_hooks` (Node ≥ 18, Bun ≥ 1.2) and silently no-ops on edge runtimes lacking it; documents the interruption caveat of `Effect.promise`.
    - **Single-runtime expectation** — explains the module-scoped `AsyncLocalStorage` and the cross-runtime contamination risk for apps running multiple `ManagedRuntime` instances.
    - **Lifecycle** — clarifies that the runtime is application-scoped, per-request resources belong inside handlers, and `runtime.dispose()` is a graceful shutdown.
  - Added matching JSDoc to `withFiberContext` in `src/node.ts`.
  - Added `SECURITY.md` (private vulnerability reporting) and `CONTRIBUTING.md` (one-page setup + workflow).
  - Synced the `EffectBuilder` API table with `EffectBuilderSurface` — added the missing `.middleware(fn)` row.
  - Fixed naming inconsistency in `examples/README.md` — the folder is `hono/`, not `hono-request-context`.

## 0.2.2

### Patch Changes

- 1e2d2c7: Add JSDocs back

## 0.2.1

### Patch Changes

- 21b9c8a: Improve Effect builder and procedure compatibility with upstream oRPC by proxying the upstream builder/procedure surfaces while preserving Effect runtime, error map, and tracing metadata.

## 0.2.0

### Minor Changes

- ce9f590: Add `eoc`, an Effect-aware wrapper around `@orpc/contract`'s `oc`, so contract definitions can reuse tagged error classes directly in `.errors(...)`.

  Example:

  ```ts
  class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
    code: "NOT_FOUND",
    schema: z.object({ userId: z.string() }),
  }) {}

  const contract = {
    users: {
      find: eoc
        .errors({
          NOT_FOUND: UserNotFoundError,
        })
        .input(z.object({ userId: z.string() }))
        .output(z.object({ userId: z.string() })),
    },
  };
  ```

- 5e42e78: Add `implementEffect(contract, runtime)` for contract-first oRPC handlers backed by Effect, including contract leaf `.effect(...)` support and root router enhancement.

  Example:

  ```ts
  const oe = implementEffect(contract, runtime);

  export const router = oe.router({
    users: {
      list: oe.users.list.effect(function* ({ input }) {
        return yield* UsersRepo.list(input.amount);
      }),
    },
  });
  ```

### Patch Changes

- 926dbf4: Document the new contract-first APIs with examples for `eoc` and `implementEffect`.
- 6937a19: Restore wrapped oRPC builder and implementer parity by aligning `.middleware(...)`, `.handler(...)`, and related variant typings with upstream behavior.
- 92ca0eb: Add parity regression coverage for wrapped oRPC contract builders, Effect builders, and contract implementers.

## 0.1.4

### Patch Changes

- b1d95d7: Add README

## 0.1.3

### Patch Changes

- ed5bc70: Sync readme from root to package so that it gets published on NPM

## 0.1.2

### Patch Changes

- 4dcdec0: Symlinked README.md to root's README
- e802e5e: fix: Preserve runtime services when inheriting request fiber refs with `withFiberContext`.

## 0.1.1

### Patch Changes

- 16a7fe8: Add documentation on new `withFiberContext`

## 0.1.0

### Minor Changes

- d213c5b: Add `withFiberContext` helper at `effect-orpc/node` to
  propagate Effect `FiberRef` state across framework async boundaries, and add a
  workspace Hono example showing request-scoped log and trace propagation.

### Patch Changes

- 0c81aec: Fix `.output()` typing enforcement in the Effect builder.
