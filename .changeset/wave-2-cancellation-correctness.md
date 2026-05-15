---
"effect-orpc": minor
---

Cancellation correctness and cause merging:

- Client-aborted requests now surface as `ORPCError("CLIENT_CLOSED_REQUEST")` (status 499) instead of `INTERNAL_SERVER_ERROR` (500). Genuine fiber-level interrupts (e.g. runtime disposal) still surface as 500.
- `Cause.Sequential` / `Cause.Parallel` no longer drop the right-hand failure. When both sides carry a cause, they are merged into an `AggregateError` on the surfaced `ORPCError.cause`, so a failed handler plus a failed finalizer remain visible in logs.
- Defects produced by `Effect.die(...)` or unhandled throws are wrapped in `Error` before being attached to `cause` when the original defect is not already an `Error` instance.

Added `tests/cancellation.test.ts` covering pre-aborted signals, mid-execution aborts, finalizer execution under abort, the non-abort interrupt path, abort-reason propagation, cause merging, and defect wrapping (13 new tests).
