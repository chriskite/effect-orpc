---
"@chriskite/effect-orpc": minor
---

Add Effect `Stream` support to `.effect()` for event iterators / SSE.

A `.effect()` handler may now return an Effect `Stream` instead of a unary `Effect`. The stream is converted to an `AsyncIteratorObject` at the runtime boundary, which oRPC serves as an [event iterator](https://orpc.dev/docs/event-iterator) over Server-Sent Events. Pair it with `.output(eventIterator(schema))` to validate each yielded event. Both direct (`() => Stream`) and generator (`function* () { ...; return Stream }`) handler shapes are supported.

- **Error mapping** — typed stream failures, `ORPCTaggedError`s, and defects (`Stream.die`, thrown exceptions) are mapped to `ORPCError` and surfaced mid-stream. Errors are carried in-band so any value emitted immediately before a failure is delivered before the error, rather than being dropped by the `ReadableStream` queue reset.
- **Cancellation** — a client disconnect / aborted request signal closes the iterator and interrupts the source fiber; an already-aborted request rejects with `CLIENT_CLOSED_REQUEST`.
- **Resumption** — `opts.lastEventId` is forwarded to the handler so resumable streams can skip already-delivered events on reconnect.

Also refines the base builder's non-stream `.effect()` input type to use `InferSchemaOutput<TInputSchema>` (matching the other builder variants), so handler `input` is the parsed value rather than the raw schema type. This keeps the stream and non-stream `effect` overloads consistent and lets a no-input stream handler read `opts` (e.g. `opts.lastEventId`) without specifying an empty input schema.
