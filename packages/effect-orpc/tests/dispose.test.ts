import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";

describe("ManagedRuntime disposal", () => {
  it("waits for in-flight requests to complete before disposing (graceful shutdown)", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.sleep("100 millis");
      return "completed";
    });

    const start = Date.now();
    const promise = procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["dispose"],
      procedure: procedure as never,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    setTimeout(() => {
      void runtime.dispose();
    }, 10);

    const result = await promise;
    const elapsed = Date.now() - start;
    expect(result).toBe("completed");
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it("rejects requests fired after disposal with an INTERNAL_SERVER_ERROR", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      return "ok";
    });

    await runtime.dispose();

    await expect(
      procedure["~effect"].handler({
        context: {},
        input: undefined,
        path: ["dispose"],
        procedure: procedure as never,
        signal: undefined,
        lastEventId: undefined,
        errors: {},
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
