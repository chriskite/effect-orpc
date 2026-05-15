---
"effect-orpc": minor
---

Test coverage additions (+30 new test cases):

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
