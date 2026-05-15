import { Cause, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";
import { toORPCErrorFromCause } from "../src/effect-runtime";
import { ORPCTaggedError } from "../src/tagged-error";

const runtime = ManagedRuntime.make(Layer.empty);

describe("cancellation", () => {
  it("returns CLIENT_CLOSED_REQUEST when the signal is pre-aborted", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.sleep("10 seconds");
      return "should not reach";
    });

    const controller = new AbortController();
    controller.abort();

    const start = Date.now();
    await expect(
      procedure["~effect"].handler({
        context: {},
        input: undefined,
        path: ["test"],
        procedure: procedure as any,
        signal: controller.signal,
        lastEventId: undefined,
        errors: {},
      }),
    ).rejects.toMatchObject({
      code: "CLIENT_CLOSED_REQUEST",
      status: 499,
    });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("returns CLIENT_CLOSED_REQUEST when aborted mid-execution", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.sleep("10 seconds");
      return "should not reach";
    });

    const controller = new AbortController();
    const promise = procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["test"],
      procedure: procedure as any,
      signal: controller.signal,
      lastEventId: undefined,
      errors: {},
    });

    setTimeout(() => controller.abort(new Error("user cancelled")), 20);

    await expect(promise).rejects.toMatchObject({
      code: "CLIENT_CLOSED_REQUEST",
      status: 499,
    });
  });

  it("runs finalizers when a request is aborted", async () => {
    const released: string[] = [];
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.sleep("10 seconds").pipe(
        Effect.ensuring(
          Effect.sync(() => {
            released.push("released");
          }),
        ),
      );
      return "should not reach";
    });

    const controller = new AbortController();
    const promise = procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["test"],
      procedure: procedure as any,
      signal: controller.signal,
      lastEventId: undefined,
      errors: {},
    });

    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toMatchObject({
      code: "CLIENT_CLOSED_REQUEST",
    });

    // Allow the fiber to settle its finalizers
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(released).toEqual(["released"]);
  });

  it("still reports INTERNAL_SERVER_ERROR for non-abort interrupts", async () => {
    // Synthesize an Interrupt cause without an aborted signal — the cause maps to 500.
    const cause = Cause.interrupt(123 as never as never);
    const error = toORPCErrorFromCause(cause);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.status).toBe(500);
  });

  it("uses the DOM-default abort reason when no explicit reason is provided", async () => {
    const controller = new AbortController();
    controller.abort();
    const cause = Cause.interrupt(1 as never as never);
    const error = toORPCErrorFromCause(cause, controller.signal);
    expect(error.code).toBe("CLIENT_CLOSED_REQUEST");
    expect(error.status).toBe(499);
    // The runtime's default signal.reason is a DOMException; we surface it verbatim.
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("falls back to 'Client aborted request' when signal.reason is undefined", () => {
    const fakeSignal = {
      aborted: true,
      reason: undefined,
    } as unknown as AbortSignal;
    const cause = Cause.interrupt(1 as never as never);
    const error = toORPCErrorFromCause(cause, fakeSignal);
    expect(error.code).toBe("CLIENT_CLOSED_REQUEST");
    expect(error.status).toBe(499);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe("Client aborted request");
  });

  it("preserves abort reason when provided", async () => {
    const controller = new AbortController();
    const reason = new Error("user-cancelled");
    controller.abort(reason);
    const cause = Cause.interrupt(1 as never as never);
    const error = toORPCErrorFromCause(cause, controller.signal);
    expect(error.code).toBe("CLIENT_CLOSED_REQUEST");
    expect(error.cause).toBe(reason);
  });
});

describe("combineCauses (Cause Sequential/Parallel)", () => {
  it("attaches right-hand cause to ORPCError via AggregateError when both have causes", () => {
    const leftError = new Error("primary");
    const rightError = new Error("finalizer");
    const cause = Cause.sequential(
      Cause.fail(leftError),
      Cause.fail(rightError),
    );
    const result = toORPCErrorFromCause(cause);

    expect(result.code).toBe("INTERNAL_SERVER_ERROR");
    expect(result.cause).toBeInstanceOf(AggregateError);
    const agg = result.cause as AggregateError;
    expect(agg.errors).toEqual([leftError, rightError]);
  });

  it("preserves a single tagged-error left when right has no cause", () => {
    class CustomError extends ORPCTaggedError("CustomError", {
      status: 400,
    }) {}
    const tagged = new CustomError();
    // Build a Sequential cause where right is an interrupt (no cause attached after mapping)
    const cause = Cause.sequential(
      Cause.fail(tagged),
      Cause.interrupt(1 as never),
    );
    const result = toORPCErrorFromCause(cause);
    expect(result.code).toBe("CUSTOM_ERROR");
    expect(result.status).toBe(400);
  });

  it("handles Parallel causes the same way as Sequential", () => {
    const leftError = new Error("a");
    const rightError = new Error("b");
    const cause = Cause.parallel(Cause.fail(leftError), Cause.fail(rightError));
    const result = toORPCErrorFromCause(cause);
    expect(result.cause).toBeInstanceOf(AggregateError);
    const agg = result.cause as AggregateError;
    expect(agg.errors).toEqual([leftError, rightError]);
  });
});

describe("die defect wrapping", () => {
  it("wraps non-Error defects in Error", () => {
    const cause = Cause.die("string defect");
    const result = toORPCErrorFromCause(cause);
    expect(result.code).toBe("INTERNAL_SERVER_ERROR");
    expect(result.cause).toBeInstanceOf(Error);
    expect((result.cause as Error).message).toBe("string defect");
  });

  it("preserves Error defects as-is", () => {
    const defect = new TypeError("real error");
    const cause = Cause.die(defect);
    const result = toORPCErrorFromCause(cause);
    expect(result.cause).toBe(defect);
  });

  it("wraps plain object defects via String()", () => {
    const cause = Cause.die({ kind: "weird" });
    const result = toORPCErrorFromCause(cause);
    expect(result.cause).toBeInstanceOf(Error);
    expect((result.cause as Error).message).toBe("[object Object]");
  });
});
