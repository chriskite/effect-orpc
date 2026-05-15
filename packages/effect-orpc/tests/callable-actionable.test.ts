import { Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { makeEffectORPC } from "../src/effect-builder";

const runtime = ManagedRuntime.make(Layer.empty);

describe(".callable() and .actionable() round-trip", () => {
  const builder = makeEffectORPC(runtime);
  const procedure = builder
    .input(z.object({ n: z.number() }))
    .output(z.object({ doubled: z.number() }))
    .effect(function* ({ input }) {
      return { doubled: (input as { n: number }).n * 2 };
    });

  it(".callable() produces a callable client that round-trips through Effect", async () => {
    const callable = procedure.callable();
    const result = await callable({ n: 21 });
    expect(result).toEqual({ doubled: 42 });
  });

  it(".actionable() produces a server-action style tuple [error | null, data | null]", async () => {
    const action = procedure.actionable();
    const result = await action({ n: 9 });
    // Server action result shape is [error, data] tuple.
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ doubled: 18 });
  });
});
