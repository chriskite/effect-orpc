import { Effect, FiberRef, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { makeEffectORPC } from "../src/effect-builder";
import { withFiberContext } from "../src/node";

const requestIdRef = FiberRef.unsafeMake("missing");

describe("concurrent request isolation", () => {
  it("does not cross-contaminate FiberRefs between concurrent requests", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      // Force an async tick so requests interleave inside the runtime fiber.
      yield* Effect.sleep("1 millis");
      return yield* FiberRef.get(requestIdRef);
    });

    const total = 50;
    const results = await Promise.all(
      Array.from({ length: total }, (_, i) => {
        const requestId = `req-${i}`;
        return Effect.runPromise(
          Effect.gen(function* () {
            yield* FiberRef.set(requestIdRef, requestId);
            return yield* withFiberContext(() =>
              procedure["~effect"].handler({
                context: {},
                input: undefined,
                path: ["concurrent", "test"],
                procedure: procedure as never,
                signal: undefined,
                lastEventId: undefined,
                errors: {},
              }),
            );
          }),
        );
      }),
    );

    for (let i = 0; i < total; i++) {
      expect(results[i]).toBe(`req-${i}`);
    }
  });

  it("handles concurrent requests that throw without leaking errors across", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const builder = makeEffectORPC(runtime);
    const procedure = builder.input(z.number()).effect(function* ({ input }) {
      yield* Effect.sleep("1 millis");
      if (input % 2 === 0) {
        return yield* Effect.die(`even-${input}`);
      }
      return `ok-${input}`;
    });

    const total = 20;
    const settled = await Promise.allSettled(
      Array.from({ length: total }, (_, i) =>
        procedure["~effect"].handler({
          context: {},
          input: i,
          path: ["concurrent"],
          procedure: procedure as never,
          signal: undefined,
          lastEventId: undefined,
          errors: {},
        }),
      ),
    );

    for (let i = 0; i < total; i++) {
      const r = settled[i]!;
      if (i % 2 === 0) {
        expect(r.status).toBe("rejected");
        expect((r as PromiseRejectedResult).reason).toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
        });
        expect(
          ((r as PromiseRejectedResult).reason as Error).cause,
        ).toBeInstanceOf(Error);
      } else {
        expect(r.status).toBe("fulfilled");
        expect((r as PromiseFulfilledResult<unknown>).value).toBe(`ok-${i}`);
      }
    }
  });
});
