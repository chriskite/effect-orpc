# @chriskite/effect-orpc

A type-safe integration between [oRPC](https://orpc.dev/) and [Effect](https://effect.website/), enabling Effect-native procedures with full service injection support, OpenTelemetry tracing support and typesafe Effect errors support.

Inspired by [effect-trpc](https://github.com/mikearnaldi/effect-trpc).

## Features

- **Effect-native procedures** - Write oRPC procedures using generators with `yield*` syntax
- **Type-safe service injection** - Use `ManagedRuntime<R>` to provide services to procedures with compile-time safety
- **Tagged errors** - Create Effect-native error classes with `ORPCTaggedError` that integrate with oRPC's error handling
- **Full oRPC compatibility** - Mix Effect procedures with standard oRPC procedures in the same router
- **Telemetry support with automatic tracing** - Procedures are automatically traced with OpenTelemetry-compatible spans. Customize span names with `.traced()`.
- **Builder pattern preserved** - oRPC builder methods (`.errors()`, `.meta()`, `.route()`, `.input()`, `.output()`, `.use()`) work seamlessly
- **Effect-native middleware** - Author auth, rate limiting, and other cross-cutting concerns as generators with `.useEffect()`; services from your `ManagedRuntime` are available the same way they are inside `.effect()`

## Installation

```bash
npm install @chriskite/effect-orpc
# or
pnpm add @chriskite/effect-orpc
# or
bun add @chriskite/effect-orpc
```

Runnable demos live in the repository's `examples/` directory.

## Demo

```ts
import { os } from "@orpc/server";
import { Effect, ManagedRuntime } from "effect";
import { makeEffectORPC, ORPCTaggedError } from "@chriskite/effect-orpc";

interface User {
  id: number;
  name: string;
}

let users: User[] = [
  { id: 1, name: "John Doe" },
  { id: 2, name: "Jane Doe" },
  { id: 3, name: "James Dane" },
];

// Authenticated os with initial context & errors set
const authedOs = os
  .errors({ UNAUTHORIZED: { status: 401 } })
  .$context<{ userId?: number }>()
  .use(({ context, errors, next }) => {
    if (context.userId === undefined) throw errors.UNAUTHORIZED();
    return next({ context: { ...context, userId: context.userId } });
  });

// Define your services
class UsersRepo extends Effect.Service<UsersRepo>()("UsersRepo", {
  accessors: true,
  sync: () => ({
    get: (id: number) => users.find((u) => u.id === id),
  }),
}) {}

// Special yieldable oRPC error class
class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
  status: 404,
}) {}

// Create runtime with your services
const runtime = ManagedRuntime.make(UsersRepo.Default);
// Create Effect-aware oRPC builder from an other (optional) base oRPC builder and provide tagged errors
const effectOs = makeEffectORPC(runtime, authedOs).errors({
  UserNotFoundError,
});

// Create the router with mixed procedures
export const router = {
  health: os.handler(() => "ok"),
  users: {
    me: effectOs.effect(function* ({ context: { userId } }) {
      const user = yield* UsersRepo.get(userId);
      if (!user) {
        return yield* new UserNotFoundError();
      }
      return user;
    }),
  },
};

export type Router = typeof router;
```

## Type Safety

The wrapper enforces that Effect procedures only use services provided by the `ManagedRuntime`. If you try to use a service that isn't in the runtime, you'll get a compile-time error:

```ts
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { makeEffectORPC } from "@chriskite/effect-orpc";

class ProvidedService extends Context.Tag("ProvidedService")<
  ProvidedService,
  { doSomething: () => Effect.Effect<string> }
>() {}

class MissingService extends Context.Tag("MissingService")<
  MissingService,
  { doSomething: () => Effect.Effect<string> }
>() {}

const runtime = ManagedRuntime.make(
  Layer.succeed(ProvidedService, {
    doSomething: () => Effect.succeed("ok"),
  }),
);

const effectOs = makeEffectORPC(runtime);

// ✅ This compiles - ProvidedService is in the runtime
const works = effectOs.effect(function* () {
  const service = yield* ProvidedService;
  return yield* service.doSomething();
});

// ❌ This fails to compile - MissingService is not in the runtime
const fails = effectOs.effect(function* () {
  const service = yield* MissingService; // Type error!
  return yield* service.doSomething();
});
```

## Error Handling

`ORPCTaggedError` lets you create Effect-native error classes that integrate seamlessly with oRPC. These errors:

- Can be yielded in Effect generators (`yield* new MyError()` or `yield* Effect.fail(errors.MyError)`)
- Can be used in Effect builder's `.errors()` maps for type-safe error handling alongside regular oRPC errors
- Automatically convert to ORPCError when thrown

Make sure the tagged error class is passed to the effect `.errors()` to be able to yield the error class directly and make the client recognize it as defined.

```ts
const getUser = effectOs
  // Mixed error maps
  .errors({
    // Regular oRPC error
    NOT_FOUND: {
      message: "User not found",
      data: z.object({ id: z.string() }),
    },
    // Effect oRPC tagged error
    UserNotFoundError,
    // Note: The key of an oRPC error is not used as the error code
    // So the following will only change the key of the error when accessing it
    // from the errors object passed to the handler, but not the actual error code itself.
    // To change the error's code, please see the next section on creating tagged errors.
    USER_NOT_FOUND: UserNotFoundError,
    // ^^^ same code as the `UserNotFoundError` error key, defined at the class level
  })
  .effect(function* ({ input, errors }) {
    const user = yield* UsersRepo.findById(input.id);
    if (!user) {
      return yield* new UserNotFoundError();
      // or return `yield* Effect.fail(errors.USER_NOT_FOUND())`
    }
    return user;
  });
```

### Creating Tagged Errors

```ts
import { ORPCTaggedError } from "@chriskite/effect-orpc";

// Basic tagged error - code defaults to 'USER_NOT_FOUND' (CONSTANT_CASE of tag)
class UserNotFound extends ORPCTaggedError("UserNotFound") {}

// With explicit code
class NotFound extends ORPCTaggedError("NotFound", { code: "NOT_FOUND" }) {}

// With default options (code defaults to 'VALIDATION_ERROR') (CONSTANT_CASE of tag)
class ValidationError extends ORPCTaggedError("ValidationError", {
  status: 400,
  message: "Validation failed",
}) {}

// With all options
class ForbiddenError extends ORPCTaggedError("ForbiddenError", {
  code: "FORBIDDEN",
  status: 403,
  message: "Access denied",
  schema: z.object({
    reason: z.string(),
  }),
}) {}

// With typed data using Standard Schema
class UserNotFoundWithData extends ORPCTaggedError("UserNotFoundWithData", {
  schema: z.object({ userId: z.string() }),
}) {}
```

## Effect-Native Middleware

`.useEffect(handler)` registers a middleware authored as an Effect generator —
the same shape as `.effect()` handlers. Services from the `ManagedRuntime` are
available via `yield*`, tagged errors from the surrounding `.errors(...)` map
are exposed on `errors`, and the downstream pipeline is invoked through an
Effect-shaped `next`.

```ts
import { Effect, ManagedRuntime } from "effect";
import { makeEffectORPC, ORPCTaggedError } from "@chriskite/effect-orpc";

class AuthService extends Effect.Service<AuthService>()("AuthService", {
  accessors: true,
  sync: () => ({
    authenticate: (token: string) =>
      token === "secret"
        ? Effect.succeed({ id: "u-1" })
        : Effect.fail(new Error("bad token")),
  }),
}) {}

class UnauthorizedError extends ORPCTaggedError("UnauthorizedError", {
  status: 401,
}) {}

const runtime = ManagedRuntime.make(AuthService.Default);

const authedOs = makeEffectORPC(runtime)
  .$context<{ token: string }>()
  .errors({ UnauthorizedError })
  .useEffect(function* ({ next, context, errors }) {
    const user = yield* AuthService.authenticate(context.token).pipe(
      Effect.catchAll(() => Effect.fail(errors.UnauthorizedError())),
    );
    return yield* next({ context: { ...context, user } });
  });

const me = authedOs.effect(function* ({ context }) {
  return { userId: context.user.id };
});
```

A few things worth knowing:

- **Downstream errors are typed Effect failures.** When the downstream
  procedure throws an `ORPCError`, the `Effect` returned by `next()` fails
  with that error. Use `Effect.catchAll`, `Effect.catchTag`, or
  `Effect.tapError` to observe or transform it before re-failing. The
  failure channel is a discriminated union derived from the builder's
  declared error map — narrowing on `code` gives precise `data` typing:

  ```ts
  yield *
    next().pipe(
      Effect.catchAll((e) => {
        if (e.code === "BAD_REQUEST") {
          // e.data is { reason: string }, not unknown
          return Effect.logWarning(`bad request: ${e.data.reason}`);
        }
        return Effect.fail(e);
      }),
    );
  ```

  Tagged-error class identity is not preserved — by the time a downstream
  failure surfaces in middleware it has been converted to a plain
  `ORPCError` — so narrow on `code`, not on `_tag`.

- **Short-circuit by failing the Effect.** Returning early from the middleware
  without calling `next()` skips the downstream pipeline; surface the result
  as `yield* Effect.fail(errors.SomeError(...))` to drive oRPC's normal error
  flow.
- **Log annotations / FiberRefs propagate into the procedure.** Anything you
  set on the middleware fiber's `FiberRefs` (for example
  `Effect.annotateLogs({ requestId })` applied to `next()`) is visible to the
  downstream `.effect()` handler. This piggybacks on the same fiber-context
  bridge that `withFiberContext` uses; see _Request-Scoped Fiber Context_
  below for runtime requirements.
- **Cancellation flows through.** If the request `AbortSignal` fires while
  the middleware is running, the middleware Effect is interrupted (so its
  `Effect.onInterrupt` / `Effect.ensuring` finalizers fire), and the request
  surfaces as `CLIENT_CLOSED_REQUEST` — identical to the cancellation story
  for `.effect()` handlers.
- **Composes with `.use()`.** `.useEffect()` and `.use()` may be mixed in any
  order. Internally, `.useEffect()` compiles the Effect handler down to a
  standard oRPC middleware and forwards to upstream `.use()`, so middleware
  composition and ordering follow oRPC's normal rules.

`.useEffect()` is also available on the result of `.effect()` — useful for
applying a middleware to a single procedure rather than the builder.

### Reusable middleware

The handler passed to `.useEffect()` is just a value of type
`EffectMiddlewareHandler<...>`, so you can move it out of the router and into
its own module. A factory function is the most flexible shape — generic over
the consuming builder's context, parameterised on whatever the middleware
needs from the call site:

```ts
// src/middlewares/log-annotations.ts
import type { Context } from "@orpc/server";
import { Effect } from "effect";
import type { EffectMiddlewareHandler } from "@chriskite/effect-orpc";

/**
 * Annotates every downstream log entry with key/value pairs derived from
 * the current request context. Generic over `TContext` so it composes with
 * any builder, doesn't change the context, requires no services from the
 * `ManagedRuntime`, and contributes no tagged errors.
 */
export function annotateLogsMiddleware<TContext extends Context>(
  getAnnotations: (context: TContext) => Record<string, unknown>,
): EffectMiddlewareHandler<
  TContext, // TInContext
  Record<never, never>, // TOutContext — no context changes
  unknown, // TInput
  unknown, // TOutput
  Record<never, never>, // TEffectErrorMap — no tagged errors
  Record<never, never>, // TMeta
  never // TRequirementsProvided — no services needed
> {
  return function* ({ next, context }) {
    return yield* next({ context }).pipe(
      Effect.annotateLogs(getAnnotations(context)),
    );
  };
}
```

Plug it into any builder:

```ts
// src/server.ts
import { makeEffectORPC } from "@chriskite/effect-orpc";
// Importing the `/node` entrypoint installs the fiber-context bridge that
// carries FiberRefs (log annotations, etc.) from the middleware Effect into
// downstream .effect() handlers. See "Request-Scoped Fiber Context" below.
import "@chriskite/effect-orpc/node";
import { Effect, ManagedRuntime } from "effect";

import { annotateLogsMiddleware } from "./middlewares/log-annotations";

const runtime = ManagedRuntime.make(AppLive);

const effectOs = makeEffectORPC(runtime)
  .$context<{ requestId: string; userId?: string }>()
  .useEffect(
    annotateLogsMiddleware((ctx) => ({
      requestId: ctx.requestId,
      userId: ctx.userId ?? "anonymous",
    })),
  );

export const router = {
  // every Effect.log* call inside this handler is automatically tagged
  // with requestId and userId
  me: effectOs.effect(function* ({ context }) {
    yield* Effect.logInfo("resolving me");
    return { userId: context.userId };
  }),
};
```

A few notes on the pattern:

- The factory is generic over `TContext` so it adapts to whatever
  `.$context<...>()` shape the consuming builder is built around. TypeScript
  infers `TContext` from the function passed at the call site.
- Set `TRequirementsProvided` to `never` (rather than `MyService`) when the
  middleware doesn't pull anything out of the runtime. `never` is assignable
  to any runtime's requirements, so the middleware composes with builders
  backed by any runtime. If you _do_ need a service, narrow the requirement
  there and the call site will refuse to compose unless the runtime provides
  it.
- `TOutContext = Record<never, never>` says "this middleware adds nothing to
  the context." Returning `next({ context: { ...context, user } })` instead
  would widen `TOutContext` so downstream handlers see the merged shape.
- To attach the same factory output to a single procedure rather than the
  builder, call `.useEffect(...)` on the `EffectDecoratedProcedure` returned
  by `.effect()`.

## Traceable Spans

All Effect procedures are automatically traced with `Effect.withSpan`. By default, the span name is the procedure path (e.g., `users.getUser`):

```ts
// Router structure determines span names automatically
const router = {
  users: {
    // Span name: "users.get"
    get: effectOs.input(z.object({ id: z.string() })).effect(function* ({
      input,
    }) {
      const userService = yield* UserService;
      return yield* userService.findById(input.id);
    }),
    // Span name: "users.create"
    create: effectOs.input(z.object({ name: z.string() })).effect(function* ({
      input,
    }) {
      const userService = yield* UserService;
      return yield* userService.create(input.name);
    }),
  },
};
```

Use `.traced()` to override the default span name:

```ts
const getUser = effectOs
  .input(z.object({ id: z.string() }))
  .traced("custom.span.name") // Override the default path-based name
  .effect(function* ({ input }) {
    const userService = yield* UserService;
    return yield* userService.findById(input.id);
  });
```

### Enabling OpenTelemetry

To enable tracing, include the OpenTelemetry layer in your runtime:

```ts
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

const TracingLive = NodeSdk.layer(
  Effect.sync(() => ({
    resource: { serviceName: "my-service" },
    spanProcessor: [new SimpleSpanProcessor(new OTLPTraceExporter())],
  })),
);

const AppLive = Layer.mergeAll(UserServiceLive, TracingLive);

const runtime = ManagedRuntime.make(AppLive);
const effectOs = makeEffectORPC(runtime);
```

### Error Stack Traces

When an Effect procedure fails, the span includes a properly formatted stack trace pointing to the definition site:

```
MyCustomError: Something went wrong
    at <anonymous> (/app/src/procedures.ts:42:28)
    at users.getById (/app/src/procedures.ts:41:35)
```

## Request-Scoped Fiber Context

If you run `@chriskite/effect-orpc` inside a framework such as Hono, the handler executes
through the runtime boundary and will not automatically inherit request-local
`FiberRef` state from outer middleware.

To preserve request-scoped logs, tracing annotations, and
other fiber-local state, wrap the framework continuation with `withFiberContext` from
`@chriskite/effect-orpc/node`.

```ts
import { Hono } from "hono";
import { Effect, ManagedRuntime } from "effect";
import { makeEffectORPC } from "@chriskite/effect-orpc";
import { withFiberContext } from "@chriskite/effect-orpc/node";

const runtime = ManagedRuntime.make(AppLive);
const effectOs = makeEffectORPC(runtime);
const app = new Hono();

app.use("*", async (c, next) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({
        requestId: c.get("requestId"),
      });

      yield* withFiberContext(() => next());
    }),
  );
});
```

When a captured fiber context and the `ManagedRuntime` both provide the same
service, `@chriskite/effect-orpc` prioritizes the captured context. The runtime is treated
as the application-wide base layer, while `withFiberContext` preserves the
more specific request-scoped values from outer middleware. This prevents
request-local references such as request IDs, logging annotations, tracing
context, or scoped overrides from being replaced by runtime defaults when the
handler crosses the runtime boundary.

The reason for the separate `/node` entrypoint is that `withFiberContext` relies
on Node/Bun's `AsyncLocalStorage` from `node:async_hooks` to carry Effect
`FiberRef` state across framework async boundaries. The main package stays
runtime-agnostic.

If you do not need framework-to-handler fiber propagation, you do not need the
`/node` entrypoint at all.

### Runtime requirements

`withFiberContext` requires `node:async_hooks`. It is supported on Node.js
≥ 18 and Bun ≥ 1.2.

On runtimes without `node:async_hooks` (Cloudflare Workers, browser, some Deno
configurations), the `@chriskite/effect-orpc/node` entrypoint is unimportable. If you
import it indirectly through bundled code, the bridge is never installed and
`withFiberContext` silently no-ops — handlers will not see captured FiberRefs.
There is no error; the only symptom is that request-scoped log annotations,
trace context, etc. won't appear in handler output. If you target an edge
runtime today, omit `withFiberContext` and pass per-request context through
your `ManagedRuntime` layer or explicit handler arguments.

Note: `Effect.promise` does not propagate Effect interruption to the underlying
Promise. This is safe in `withFiberContext` today because the wrapped function
is the framework continuation (e.g. `next()` from Hono) which completes when
the response is sent. If you wrap longer-running async work, interruption from
an outer Effect will not cancel it; use `Effect.async` with an explicit abort
callback instead.

### Single-runtime expectation

The `AsyncLocalStorage` used by `withFiberContext` is module-scoped. If your
application instantiates two `ManagedRuntime` instances (e.g. one for HTTP
requests, one for a background worker) and both use `withFiberContext`, they
share the same storage and a worker can read an HTTP handler's request-scoped
FiberRefs. For applications with multiple runtimes, isolate request-scoped
FiberRefs per runtime (e.g. by namespacing the keys you store) or restrict
`withFiberContext` to a single runtime.

### Lifecycle: runtime is application-scoped, requests aren't

The `ManagedRuntime` you pass to `makeEffectORPC` or `implementEffect` lives
for the lifetime of the process and is shared across every request handler the
builder produces. This means:

- Layers that compose into the runtime (e.g. database connection pool, config
  service) live as long as the runtime.
- Resources that should be per-request belong **inside the handler** as
  `Effect.acquireRelease` / `Effect.ensuring` — they are scoped to the request
  fiber and are released when the fiber completes or is interrupted.
- Calling `runtime.dispose()` is a graceful shutdown: in-flight requests run
  to completion. Subsequent requests reject with `INTERNAL_SERVER_ERROR`.

## Contract-First Usage

Use `implementEffect(contract, runtime)` when you already have an oRPC contract
and want to keep contract-first enforcement while adding Effect-native handlers.
Use `makeEffectORPC(runtime, builder?)` when you want to build procedures
directly from an oRPC builder.

```ts
import { Effect, ManagedRuntime } from "effect";
import { eoc, implementEffect } from "@chriskite/effect-orpc";
import z from "zod";

class UsersRepo extends Effect.Service<UsersRepo>()("UsersRepo", {
  accessors: true,
  sync: () => ({
    list: (amount: number) =>
      Array.from({ length: amount }, (_, index) => `user-${index + 1}`),
  }),
}) {}

const contract = {
  users: {
    list: eoc
      .input(z.object({ amount: z.number().int().positive() }))
      .output(z.array(z.string())),
  },
};

const runtime = ManagedRuntime.make(UsersRepo.Default);
const oe = implementEffect(contract, runtime);

export const router = oe.router({
  users: {
    list: oe.users.list.effect(function* ({ input }) {
      return yield* UsersRepo.list(input.amount);
    }),
  },
});
```

Contract leaves keep the contract-defined input, output, and error surface.
They add `.effect(...)` alongside existing implementer methods such as
`.handler(...)` and `.use(...)`, but do not expose contract-changing builder
methods like `.input(...)` or `.output(...)`.

If your contract declares tagged Effect error classes, prefer `eoc.errors(...)`
instead of raw `oc.errors(...)` so the error schema and metadata are derived
directly from the `ORPCTaggedError` class.

## API Reference

### `makeEffectORPC(runtime, builder?)`

Creates an Effect-aware procedure builder.

- `runtime` - A `ManagedRuntime<R, E>` instance that provides services for Effect procedures
- `builder` (optional) - An oRPC Builder instance to wrap. Defaults to `os` from `@orpc/server`

Returns an `EffectBuilder` instance.

```ts
// With default builder
const effectOs = makeEffectORPC(runtime);

// With customized builder
const effectAuthedOs = makeEffectORPC(runtime, authedBuilder);
```

### `implementEffect(contract, runtime)`

Creates an Effect-aware contract implementer.

- `contract` - An oRPC contract router built with `oc`
- `runtime` - A `ManagedRuntime<R, E>` instance that provides services for Effect procedures

Returns a contract-shaped implementer tree whose leaves support `.effect(...)`.

```ts
const oe = implementEffect(contract, runtime);

const router = oe.router({
  users: {
    list: oe.users.list.effect(function* ({ input }) {
      return yield* UsersRepo.list(input.amount);
    }),
  },
});
```

### `eoc`

An Effect-aware wrapper around oRPC's `oc` contract builder.

Use it when you want contract definitions to accept `ORPCTaggedError` classes
directly in `.errors(...)` without duplicating the error schema.

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

### `EffectBuilder`

Wraps an oRPC Builder with Effect support. Available methods:

| Method                | Description                                                                        |
| --------------------- | ---------------------------------------------------------------------------------- |
| `.$config(config)`    | Set or override the builder config                                                 |
| `.$context<U>()`      | Set or override the initial context type                                           |
| `.$meta(meta)`        | Set or override the initial metadata                                               |
| `.$route(route)`      | Set or override the initial route configuration                                    |
| `.$input(schema)`     | Set or override the initial input schema                                           |
| `.middleware(fn)`     | Create a reusable middleware bound to this builder's context/meta/error map        |
| `.errors(map)`        | Add type-safe custom errors                                                        |
| `.meta(meta)`         | Set procedure metadata (merged with existing)                                      |
| `.route(route)`       | Configure OpenAPI route (merged with existing)                                     |
| `.input(schema)`      | Define input validation schema                                                     |
| `.output(schema)`     | Define output validation schema                                                    |
| `.use(middleware)`    | Add middleware                                                                     |
| `.useEffect(handler)` | Add an Effect-native middleware (generator-shaped, has access to runtime services) |
| `.traced(name)`       | Add a traceable span for telemetry (optional, defaults to the procedure's path)    |
| `.handler(handler)`   | Define a non-Effect handler (standard oRPC handler)                                |
| `.effect(handler)`    | Define the Effect handler                                                          |
| `.prefix(prefix)`     | Prefix all procedures in the router (for OpenAPI)                                  |
| `.tag(...tags)`       | Add tags to all procedures in the router (for OpenAPI)                             |
| `.router(router)`     | Apply all options to a router                                                      |
| `.lazy(loader)`       | Create and apply options to a lazy-loaded router                                   |

### `EffectDecoratedProcedure`

The result of calling `.effect()`. Extends standard oRPC `DecoratedProcedure` with Effect type preservation.

| Method                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `.errors(map)`          | Add more custom errors                        |
| `.meta(meta)`           | Update metadata (merged with existing)        |
| `.route(route)`         | Update route configuration (merged)           |
| `.use(middleware)`      | Add middleware                                |
| `.useEffect(handler)`   | Add an Effect-native middleware               |
| `.callable(options?)`   | Make procedure directly invocable             |
| `.actionable(options?)` | Make procedure compatible with server actions |

### `ORPCTaggedError(tag, options?)`

Factory function to create Effect-native tagged error classes.

The options is an optional object containing:

- `schema?` - Optional Standard Schema for the error's data payload (e.g., `z.object({ userId: z.string() })`)
- `code?` - Optional ORPCErrorCode, defaults to CONSTANT_CASE of the tag (e.g., `UserNotFoundError` → `USER_NOT_FOUND_ERROR`).
- `status?` - Sets the default status of the error
- `message` - Sets the default message of the error

## License

MIT
