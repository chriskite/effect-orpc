import { call } from "@orpc/server";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { makeEffectORPC } from "../src/effect-builder";
import { ORPCTaggedError } from "../src/tagged-error";

class NotFoundError extends ORPCTaggedError("NotFoundError", {
  code: "NOT_FOUND",
  schema: z.object({ id: z.string() }),
}) {}

class ForbiddenError extends ORPCTaggedError("ForbiddenError", {
  code: "FORBIDDEN",
  schema: z.object({ role: z.string() }),
}) {}

const runtime = ManagedRuntime.make(Layer.empty);

describe("multi-layer error-map composition", () => {
  it("merges errors from chained .errors() calls and runtime throws win at runtime", async () => {
    const builder = makeEffectORPC(runtime)
      .errors({ NOT_FOUND: NotFoundError })
      .errors({ FORBIDDEN: ForbiddenError })
      .errors({
        BAD_REQUEST: {
          status: 400,
          message: "invalid input",
        },
      });

    const notFoundProc = builder
      .input(z.object({ kind: z.literal("not-found") }))
      .effect(function* ({ errors }) {
        return yield* Effect.fail(
          errors.NOT_FOUND({ data: { id: "missing" } }),
        );
      });
    const forbiddenProc = builder
      .input(z.object({ kind: z.literal("forbidden") }))
      .effect(function* ({ errors }) {
        return yield* Effect.fail(
          errors.FORBIDDEN({ data: { role: "viewer" } }),
        );
      });
    const badRequestProc = builder
      .input(z.object({ kind: z.literal("bad-request") }))
      .effect(function* ({ errors }) {
        return yield* Effect.fail(errors.BAD_REQUEST({}));
      });

    await expect(
      call(notFoundProc, { kind: "not-found" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { id: "missing" },
    });
    await expect(
      call(forbiddenProc, { kind: "forbidden" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { role: "viewer" },
    });
    await expect(
      call(badRequestProc, { kind: "bad-request" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });

  it("a later .errors() call with the same code shadows the earlier one", async () => {
    class FirstNotFoundError extends ORPCTaggedError("FirstNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ tag: z.literal("first") }),
    }) {}
    class SecondNotFoundError extends ORPCTaggedError("SecondNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ tag: z.literal("second") }),
    }) {}

    const builder = makeEffectORPC(runtime)
      .errors({ NOT_FOUND: FirstNotFoundError })
      .errors({ NOT_FOUND: SecondNotFoundError });

    const procedure = builder.effect(function* ({ errors }) {
      // The most recently merged constructor wins; the type system reflects
      // the merged map but the runtime constructor is the second one.
      return yield* Effect.fail(
        errors.NOT_FOUND({ data: { tag: "second" } as never }),
      );
    });

    await expect(call(procedure, undefined)).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { tag: "second" },
    });
  });
});
