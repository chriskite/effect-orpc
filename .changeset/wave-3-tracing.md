---
"effect-orpc": minor
---

Tracing robustness:

- `addSpanStackTrace` now walks the captured stack to find the first user frame outside `effect-orpc/src/` and `effect-orpc/dist/`, instead of reading a hardcoded `stack[3]` index. This fixes traces that previously pointed at library internals whenever the call depth from `.effect()` to user code was unusual (e.g. higher-order wrappers).
- Stopped mutating `Error.stackTraceLimit`. V8's default of 10 is plenty for a single `new Error()`, and the prior set/restore created a race window in non-V8 runtimes.
- The captured frame is now cached even when no user frame is found, so the split-and-walk cost is paid at most once per `.effect()` definition.

Added `tests/tracing.test.ts` with a hand-rolled recording tracer asserting (a) the default span name is the procedure path, (b) `.traced(name)` overrides the span name, (c) the `code.stacktrace` attribute on failure spans points at user code (regression-guards the frame walker), and (d) the captured frame is cached across invocations.
