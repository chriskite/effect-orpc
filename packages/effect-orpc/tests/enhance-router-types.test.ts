import { isLazy, isProcedure } from "@orpc/server";
import { Layer, ManagedRuntime } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import z from "zod";

import { makeEffectORPC } from "../src/effect-builder";

const runtime = ManagedRuntime.make(Layer.empty);

describe("enhanceEffectRouter type-level shape", () => {
  it("preserves a nested router fixture's structural shape", () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .input(z.object({ n: z.number() }))
      .output(z.object({ doubled: z.number() }))
      .effect(function* ({ input }) {
        return { doubled: input.n * 2 };
      });

    const enhanced = builder.router({
      a: procedure,
      group: {
        b: procedure,
      },
    });

    // Structural type assertion: enhanced exposes the same leaves under the
    // same keys, each leaf still resolves to an effect-decorated procedure.
    expectTypeOf(enhanced).toHaveProperty("a");
    expectTypeOf(enhanced).toHaveProperty("group");
    expectTypeOf(enhanced.a).not.toBeAny();
    expectTypeOf(enhanced.group).toHaveProperty("b");
    expectTypeOf(enhanced.group.b).not.toBeAny();

    // Runtime spot-checks: each leaf preserves the runtime reference (the
    // structural marker that the procedure went through enhancement).
    expect(enhanced.a["~effect"].runtime).toBe(runtime);
    expect(enhanced.group.b["~effect"].runtime).toBe(runtime);
  });

  it("returns a lazy node from .lazy() that is structurally distinguishable", () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      return "ok";
    });
    const lazied = builder.lazy(async () => ({
      default: { ping: procedure },
    }));

    expect(isLazy(lazied)).toBe(true);
    expect(isProcedure(lazied)).toBe(false);
  });
});
