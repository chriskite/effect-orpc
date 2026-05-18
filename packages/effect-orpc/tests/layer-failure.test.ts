import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";

class MissingEnvService extends Context.Tag("MissingEnvService")<
  MissingEnvService,
  { value: string }
>() {}

describe("ManagedRuntime layer-init failure", () => {
  it("surfaces a layer build failure as a 500 rather than hanging", async () => {
    const failingLayer = Layer.effect(
      MissingEnvService,
      Effect.fail("missing-env"),
    );
    const runtime = ManagedRuntime.make(failingLayer);
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      const svc = yield* MissingEnvService;
      return svc.value;
    });

    await expect(
      procedure["~effect"].handler({
        context: {},
        input: undefined,
        path: ["layer-failure"],
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
