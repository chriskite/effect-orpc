import { Data, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";

// Mirrors what `SqlError` from @effect/sql looks like to the type system: a
// tagged Data.TaggedError that's neither in the procedure's declared error
// map nor an ORPCError.
class FakeSqlError extends Data.TaggedError("FakeSqlError")<{
  readonly query: string;
}> {}

describe("untyped Effect failure passthrough", () => {
  it("surfaces an undeclared tagged failure as a 500", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const builder = makeEffectORPC(runtime);
    // No `.errors(...)` declared — handler still allowed to fail with anything.
    const procedure = builder.effect(function* () {
      yield* Effect.fail(new FakeSqlError({ query: "select 1" }));
      return "unreachable";
    });

    await expect(
      procedure["~effect"].handler({
        context: {},
        input: undefined,
        path: ["untyped-failure"],
        procedure: procedure as never,
        signal: undefined,
        lastEventId: undefined,
        errors: {},
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      defined: false,
    });
  });

  it("preserves the original failure as the thrown ORPCError's cause", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.fail(new FakeSqlError({ query: "select 1" }));
      return "unreachable";
    });

    try {
      await procedure["~effect"].handler({
        context: {},
        input: undefined,
        path: ["untyped-failure"],
        procedure: procedure as never,
        signal: undefined,
        lastEventId: undefined,
        errors: {},
      });
      throw new Error("should have thrown");
    } catch (err) {
      const cause = (err as { cause: unknown }).cause;
      expect(cause).toBeInstanceOf(FakeSqlError);
      expect((cause as FakeSqlError).query).toBe("select 1");
    }
  });
});
