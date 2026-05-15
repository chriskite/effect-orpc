import { call } from "@orpc/server";
import { Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";

// Minimal hand-rolled Standard Schema v1 fixture — exercises the library's
// Standard-Schema integration without pulling in Valibot/ArkType as a devDep.
type Issue = { readonly message: string };
type ValidateResult<T> = { value: T } | { issues: Issue[] };

function makeNumberInputSchema() {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test-fixture",
      validate(input: unknown): ValidateResult<{ n: number }> {
        if (
          typeof input === "object" &&
          input !== null &&
          "n" in input &&
          typeof (input as Record<string, unknown>).n === "number"
        ) {
          return { value: input as { n: number } };
        }
        return { issues: [{ message: "expected { n: number }" }] };
      },
      types: {
        input: undefined as unknown as { n: number },
        output: undefined as unknown as { n: number },
      },
    },
  };
}

function makeStringOutputSchema() {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test-fixture",
      validate(input: unknown): ValidateResult<{ doubled: string }> {
        if (
          typeof input === "object" &&
          input !== null &&
          "doubled" in input &&
          typeof (input as Record<string, unknown>).doubled === "string"
        ) {
          return { value: input as { doubled: string } };
        }
        return { issues: [{ message: "expected { doubled: string }" }] };
      },
      types: {
        input: undefined as unknown as { doubled: string },
        output: undefined as unknown as { doubled: string },
      },
    },
  };
}

const runtime = ManagedRuntime.make(Layer.empty);

describe("Standard Schema integration", () => {
  const builder = makeEffectORPC(runtime);
  const procedure = builder
    .input(makeNumberInputSchema())
    .output(makeStringOutputSchema())
    .effect(function* ({ input }) {
      return { doubled: String((input as { n: number }).n * 2) };
    });

  it("validates input + output via a non-Zod Standard Schema implementation", async () => {
    const result = await call(procedure, { n: 21 });
    expect(result).toEqual({ doubled: "42" });
  });

  it("rejects input that fails a non-Zod Standard Schema validator", async () => {
    await expect(
      call(procedure, "not an object" as unknown as { n: number }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
