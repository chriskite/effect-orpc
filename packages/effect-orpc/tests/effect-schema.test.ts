import { call } from "@orpc/server";
import { Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";
import { eoc } from "../src/eoc";

const runtime = ManagedRuntime.make(Layer.empty);

describe("Effect Schema auto-coercion (builder)", () => {
  it("accepts an Effect Schema in .input() without manual conversion", async () => {
    const builder = makeEffectORPC(runtime);

    const procedure = builder
      .input(Schema.Struct({ n: Schema.Number }))
      .effect(function* ({ input }) {
        return { doubled: input.n * 2 };
      });

    const result = await call(procedure, { n: 21 });
    expect(result).toEqual({ doubled: 42 });
  });

  it("validates input via the Effect Schema and rejects invalid payloads", async () => {
    const builder = makeEffectORPC(runtime);

    const procedure = builder
      .input(Schema.Struct({ n: Schema.Number }))
      .effect(function* ({ input }) {
        return { doubled: input.n * 2 };
      });

    await expect(
      call(procedure, "not an object" as unknown as { n: number }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts an Effect Schema in .output() and enforces the contract", async () => {
    const builder = makeEffectORPC(runtime);

    const procedure = builder
      .input(Schema.Struct({ n: Schema.Number }))
      .output(Schema.Struct({ doubled: Schema.Number }))
      .effect(function* ({ input }) {
        return { doubled: input.n * 2 };
      });

    const result = await call(procedure, { n: 21 });
    expect(result).toEqual({ doubled: 42 });
  });

  it("interleaves Effect Schema and Standard Schema across input/output", async () => {
    const { default: z } = await import("zod");
    const builder = makeEffectORPC(runtime);

    const procedure = builder
      .input(Schema.Struct({ n: Schema.Number }))
      .output(z.object({ doubled: z.number() }))
      .effect(function* ({ input }) {
        return { doubled: input.n * 2 };
      });

    const result = await call(procedure, { n: 21 });
    expect(result).toEqual({ doubled: 42 });
  });
});

describe("Effect Schema auto-coercion (eoc contract)", () => {
  it("accepts an Effect Schema in .input() / .output() on the contract builder", async () => {
    const contract = eoc
      .input(Schema.Struct({ n: Schema.Number }))
      .output(Schema.Struct({ doubled: Schema.Number }));

    // The contract's input/output schemas must expose `~standard` so that
    // oRPC's procedure machinery (and OpenAPI generators) can read them
    // through the Standard Schema interface.
    expect(contract["~orpc"].inputSchema).toBeDefined();
    expect(contract["~orpc"].inputSchema).toHaveProperty("~standard");
    expect(contract["~orpc"].outputSchema).toBeDefined();
    expect(contract["~orpc"].outputSchema).toHaveProperty("~standard");
  });
});
