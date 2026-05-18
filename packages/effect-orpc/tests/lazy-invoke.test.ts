import { call } from "@orpc/server";
import { unlazy } from "@orpc/server";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";

class Counter extends Context.Tag("Counter")<
  Counter,
  { readonly value: number }
>() {}

const runtime = ManagedRuntime.make(Layer.succeed(Counter, { value: 41 }));

describe("lazy router invocation", () => {
  it("invokes an effect procedure resolved from a lazy router and accesses the runtime layer", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      const counter = yield* Counter;
      return { value: counter.value + 1 };
    });

    const lazied = builder.lazy(async () => ({
      default: { tally: procedure },
    }));

    const { default: resolved } = await unlazy(lazied as never);
    const result = await call(
      (resolved as { tally: typeof procedure }).tally,
      undefined,
    );
    expect(result).toEqual({ value: 42 });
  });
});

void Effect;
