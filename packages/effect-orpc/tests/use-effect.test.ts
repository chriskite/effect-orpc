import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import {
  Effect,
  FiberRef,
  HashMap,
  Layer,
  Logger,
  ManagedRuntime,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import z from "zod";

import { makeEffectORPC } from "../src/effect-builder";
import { withFiberContext } from "../src/node";
import { ORPCTaggedError } from "../src/tagged-error";

class UnauthorizedError extends ORPCTaggedError("UnauthorizedError", {
  code: "UNAUTHORIZED",
  schema: z.object({ reason: z.string() }),
}) {}

describe(".useEffect", () => {
  it("injects context for the downstream handler", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const procedure = makeEffectORPC(runtime)
      .$context<{ requestId?: string }>()
      .useEffect(function* ({ next, context }) {
        return yield* next({
          context: { ...context, user: { id: "u-1" } as const },
        });
      })
      .effect(function* ({ context }) {
        return { userId: context.user.id };
      });

    const result = await call(procedure, undefined);
    expect(result).toEqual({ userId: "u-1" });
  });

  it("supplies services from the ManagedRuntime to the middleware Effect", async () => {
    class AuthService extends Effect.Tag("AuthService")<
      AuthService,
      { authenticate: (token: string) => Effect.Effect<string> }
    >() {}

    const AuthLive = Layer.succeed(AuthService, {
      authenticate: (token) => Effect.succeed(`user-of-${token}`),
    });
    const runtime = ManagedRuntime.make(AuthLive);

    const procedure = makeEffectORPC(runtime)
      .$context<{ token: string }>()
      .useEffect(function* ({ next, context }) {
        const userId = yield* AuthService.authenticate(context.token);
        return yield* next({ context: { ...context, userId } });
      })
      .effect(function* ({ context }) {
        return { resolved: context.userId };
      });

    const result = await call(procedure, undefined, {
      context: { token: "abc" },
    });

    expect(result).toEqual({ resolved: "user-of-abc" });

    await runtime.dispose();
  });

  it("short-circuits with a tagged error before next() is called", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const downstream = vi.fn();

    const procedure = makeEffectORPC(runtime)
      .errors({ UNAUTHORIZED: UnauthorizedError })
      .useEffect(function* ({ errors }) {
        return yield* Effect.fail(
          errors.UNAUTHORIZED({ data: { reason: "no token" } }),
        );
      })
      .effect(function* () {
        downstream();
        return "should not reach";
      });

    await expect(call(procedure, undefined)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      data: { reason: "no token" },
    });
    expect(downstream).not.toHaveBeenCalled();

    await runtime.dispose();
  });

  it("surfaces a downstream ORPCError as an Effect failure inside next()", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const captured: Array<unknown> = [];

    const procedure = makeEffectORPC(runtime)
      .useEffect(function* ({ next }) {
        return yield* next().pipe(
          Effect.tapError((e) =>
            Effect.sync(() => {
              captured.push(e);
            }),
          ),
        );
      })
      .effect(function* () {
        return yield* Effect.fail(
          new ORPCError("BAD_REQUEST", { message: "downstream" }),
        );
      });

    await expect(call(procedure, undefined)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "downstream",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBeInstanceOf(ORPCError);

    await runtime.dispose();
  });

  it("propagates FiberRefs set in the middleware Effect into the downstream procedure", async () => {
    const requestIdRef = FiberRef.unsafeMake("missing");
    const runtime = ManagedRuntime.make(Layer.empty);

    const procedure = makeEffectORPC(runtime)
      .useEffect(function* ({ next }) {
        yield* FiberRef.set(requestIdRef, "req-99");
        return yield* next();
      })
      .effect(function* () {
        return yield* FiberRef.get(requestIdRef);
      });

    const result = await Effect.runPromise(
      withFiberContext(() => call(procedure, undefined)),
    );

    expect(result).toBe("req-99");

    await runtime.dispose();
  });

  it("composes multiple useEffect middlewares left-to-right", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const trace: string[] = [];

    const procedure = makeEffectORPC(runtime)
      .$context<{}>()
      .useEffect(function* ({ next, context }) {
        trace.push("a:before");
        const result = yield* next({
          context: { ...context, layer: ["a"] as readonly string[] },
        });
        trace.push("a:after");
        return result;
      })
      .useEffect(function* ({ next, context }) {
        trace.push("b:before");
        const result = yield* next({
          context: { ...context, layer: [...context.layer, "b"] },
        });
        trace.push("b:after");
        return result;
      })
      .effect(function* ({ context }) {
        trace.push("handler");
        return [...context.layer, "h"];
      });

    const result = await call(procedure, undefined);
    expect(result).toEqual(["a", "b", "h"]);
    expect(trace).toEqual([
      "a:before",
      "b:before",
      "handler",
      "b:after",
      "a:after",
    ]);

    await runtime.dispose();
  });

  it("interrupts the middleware Effect when the request signal aborts", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    let middlewareInterrupted = false;

    const procedure = makeEffectORPC(runtime)
      .useEffect(function* ({ next }) {
        yield* Effect.sleep("10 seconds").pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              middlewareInterrupted = true;
            }),
          ),
        );
        return yield* next();
      })
      .effect(function* () {
        return "unreachable";
      });

    const controller = new AbortController();
    const promise = call(procedure, undefined, { signal: controller.signal });

    setTimeout(() => controller.abort(new Error("user-cancelled")), 20);

    await expect(promise).rejects.toMatchObject({
      code: "CLIENT_CLOSED_REQUEST",
      status: 499,
    });

    // give the fiber a tick to run its onInterrupt finalizer
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(middlewareInterrupted).toBe(true);

    await runtime.dispose();
  });

  it("propagates log annotations set by the middleware into handler log entries", async () => {
    type CapturedLog = {
      message: unknown;
      annotations: Record<string, unknown>;
    };
    const captured: CapturedLog[] = [];

    const captureLogger = Logger.make(({ message, annotations }) => {
      const entries: Record<string, unknown> = {};
      for (const [key, value] of HashMap.entries(annotations)) {
        entries[key] = value;
      }
      captured.push({ message, annotations: entries });
    });

    const TestLogger = Logger.replace(Logger.defaultLogger, captureLogger);
    const runtime = ManagedRuntime.make(TestLogger);

    const procedure = makeEffectORPC(runtime)
      .$context<{ token: string }>()
      .useEffect(function* ({ next, context }) {
        return yield* next({ context }).pipe(
          Effect.annotateLogs({
            requestId: "req-42",
            userToken: context.token,
          }),
        );
      })
      .effect(function* () {
        yield* Effect.logInfo("handler-ran");
        return "ok";
      });

    const result = await call(procedure, undefined, {
      context: { token: "tkn-7" },
    });

    expect(result).toBe("ok");

    const handlerLog = captured.find((entry) =>
      Array.isArray(entry.message)
        ? entry.message.includes("handler-ran")
        : entry.message === "handler-ran",
    );
    expect(handlerLog, "expected handler log to be captured").toBeDefined();
    expect(handlerLog?.annotations).toMatchObject({
      requestId: "req-42",
      userToken: "tkn-7",
    });

    await runtime.dispose();
  });

  it("narrows next() failures by code on declared errors", async () => {
    // Verifies that `EffectMiddlewareNextFn` exposes a discriminated-union
    // failure channel keyed by `code`. The compile-time assertion is the
    // `observed.push(e.data.reason)` line: `e.data.reason` only typechecks
    // if narrowing on `e.code === "BAD_REQUEST"` produces
    // `ORPCError<"BAD_REQUEST", { reason: string }>`. If the failure channel
    // collapsed back to the original wide `ORPCError<ORPCErrorCode, unknown>`,
    // `e.data` would be `unknown` and `bun run check` (tsc -b) would fail.
    const runtime = ManagedRuntime.make(Layer.empty);
    const observed: string[] = [];

    const procedure = makeEffectORPC(runtime)
      .errors({
        BAD_REQUEST: {
          status: 400,
          data: z.object({ reason: z.string() }),
        },
      })
      .useEffect(function* ({ next }) {
        return yield* next().pipe(
          Effect.tapError((e) =>
            Effect.sync(() => {
              if (e.code === "BAD_REQUEST") {
                observed.push(e.data.reason);
              }
            }),
          ),
        );
      })
      .effect(function* ({ errors }) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({ data: { reason: "downstream" } }),
        );
      });

    await expect(call(procedure, undefined)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "downstream" },
    });
    expect(observed).toEqual(["downstream"]);

    await runtime.dispose();
  });

  it("threads through input/output builder variants", async () => {
    // The `useEffect` virtual method is declared on every builder variant
    // (`EffectProcedureBuilderWithInput`, `EffectProcedureBuilderWithOutput`,
    // `EffectProcedureBuilderWithInputOutput`) in `types/variants.ts`, but the
    // proxy wiring lives in `effect-builder.ts` and is shared via
    // `wrapBuilderLike`. A smoke test that calls `.useEffect` *after* `.input`
    // and `.output` catches any future regression in the proxy's variant
    // bridging without enumerating each surface by name.
    const runtime = ManagedRuntime.make(Layer.empty);
    const stages: string[] = [];

    const procedure = makeEffectORPC(runtime)
      .input(z.object({ name: z.string() }))
      // WithInput → useEffect → WithInput
      .useEffect(function* ({ next, context }) {
        stages.push("after-input");
        return yield* next({ context });
      })
      .output(z.object({ greeting: z.string() }))
      // WithInputOutput → useEffect → WithInputOutput
      .useEffect(function* ({ next, context }) {
        stages.push("after-input-output");
        return yield* next({ context });
      })
      .effect(function* ({ input }) {
        return { greeting: `hello ${input.name}` };
      });

    const result = await call(procedure, { name: "world" });
    expect(result).toEqual({ greeting: "hello world" });
    expect(stages).toEqual(["after-input", "after-input-output"]);

    await runtime.dispose();
  });

  it("threads through the output-only builder variant", async () => {
    // Covers `EffectProcedureBuilderWithOutput.useEffect` separately from the
    // WithInput/WithInputOutput pair above, since that variant's proxy is
    // reached via a different entry point (`.output` directly off the base
    // builder, without an `.input` in between).
    const runtime = ManagedRuntime.make(Layer.empty);
    let middlewareRan = false;

    const procedure = makeEffectORPC(runtime)
      .output(z.object({ ok: z.literal(true) }))
      .useEffect(function* ({ next, context }) {
        middlewareRan = true;
        return yield* next({ context });
      })
      .effect(function* () {
        return { ok: true as const };
      });

    const result = await call(procedure, undefined);
    expect(result).toEqual({ ok: true });
    expect(middlewareRan).toBe(true);

    await runtime.dispose();
  });

  it("normalizes a non-Error, non-ORPCError downstream rejection", async () => {
    // Exercises the `cause instanceof Error ? cause : new Error(String(cause))`
    // branch of `tryPromise.catch` in `effect-middleware-runtime.ts`. A plain
    // `.use()` middleware that throws a string produces a Promise rejection
    // whose reason is not an `Error` instance and not an `ORPCError`, so the
    // bridge must wrap it as `ORPCError("INTERNAL_SERVER_ERROR", { cause:
    // new Error("...") })`. Without that normalization, `ORPCError`'s `cause`
    // option (typed as `Error | undefined`) would receive a string.
    const runtime = ManagedRuntime.make(Layer.empty);
    let captured: unknown = null;

    const procedure = makeEffectORPC(runtime)
      .useEffect(function* ({ next }) {
        return yield* next().pipe(
          Effect.tapError((e) =>
            Effect.sync(() => {
              captured = e;
            }),
          ),
        );
      })
      .use(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "plain-string-defect";
      })
      .handler(() => "unreachable");

    await expect(call(procedure, undefined)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });

    expect(captured).toBeInstanceOf(ORPCError);
    const orpcErr = captured as ORPCError<string, unknown>;
    expect(orpcErr.code).toBe("INTERNAL_SERVER_ERROR");
    expect(orpcErr.cause).toBeInstanceOf(Error);
    expect((orpcErr.cause as Error).message).toBe("plain-string-defect");

    await runtime.dispose();
  });

  it("is exposed on decorated procedures and adds to their middleware chain", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const base = makeEffectORPC(runtime)
      .$context<{}>()
      .effect(function* ({ context }) {
        return { greeted: (context as { name?: string }).name ?? "stranger" };
      });

    const decorated = base.useEffect(function* ({ next, context }) {
      return yield* next({ context: { ...context, name: "world" } });
    });

    const result = await call(decorated, undefined);
    expect(result).toEqual({ greeted: "world" });

    await runtime.dispose();
  });
});
