import { eventIterator } from "@orpc/contract";
import { Context, Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { makeEffectORPC } from "../src/effect-builder";
import { ORPCTaggedError } from "../src/tagged-error";

const runtime = ManagedRuntime.make(Layer.empty);

function callHandler(procedure: any, opts?: Partial<any>) {
  return procedure["~effect"].handler({
    context: {},
    input: undefined,
    path: ["test"],
    procedure,
    signal: new AbortController().signal,
    lastEventId: undefined,
    errors: {},
    ...opts,
  });
}

async function collectIterator<T>(iter: AsyncIteratorObject<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of iter) {
    results.push(value);
  }
  return results;
}

describe("effect stream", () => {
  it("returns an AsyncIteratorObject from a plain function returning Stream", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(() =>
      Stream.make({ value: 1 }, { value: 2 }, { value: 3 }),
    );

    const result = await callHandler(procedure);

    expect(Symbol.asyncIterator in result).toBe(true);
    expect(typeof result.next).toBe("function");
    const values = await collectIterator(result);
    expect(values).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  });

  it("returns an AsyncIteratorObject from a generator returning Stream", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      const count = yield* Effect.succeed(3);
      return Stream.range(0, count);
    });

    const result = await callHandler(procedure);

    expect(Symbol.asyncIterator in result).toBe(true);
    const values = await collectIterator(result);
    expect(values).toEqual([0, 1, 2, 3]);
  });

  it("handles empty streams", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(() => Stream.empty);

    const result = await callHandler(procedure);

    const values = await collectIterator(result);
    expect(values).toEqual([]);
  });

  it("converts stream errors to ORPCErrors", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(() =>
      Stream.fail(new Error("stream error")),
    );

    const result = await callHandler(procedure);

    await expect(async () => {
      for await (const _ of result) {
        // should not reach
      }
    }).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("converts tagged errors to ORPCErrors", async () => {
    class NotFoundError extends ORPCTaggedError("NOT_FOUND", {
      status: 404,
    }) {}

    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(() => Stream.fail(new NotFoundError()));

    const result = await callHandler(procedure);

    await expect(async () => {
      for await (const _ of result) {
        // should not reach
      }
    }).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("works with input schema", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .input(z.object({ count: z.number() }))
      .effect(({ input }) =>
        Stream.make(...Array.from({ length: input.count }, (_, i) => i)),
      );

    const result = await callHandler(procedure, {
      input: { count: 3 },
    });

    const values = await collectIterator(result);
    expect(values).toEqual([0, 1, 2]);
  });

  it("works with eventIterator output schema", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .output(eventIterator(z.object({ time: z.date() })))
      .effect(() =>
        Stream.make(
          { time: new Date("2024-01-01") },
          { time: new Date("2024-01-02") },
        ),
      );

    const result = await callHandler(procedure);

    expect(Symbol.asyncIterator in result).toBe(true);
    const values = await collectIterator(
      result as AsyncIteratorObject<{ time: Date }>,
    );
    expect(values).toHaveLength(2);
    expect(values[0]!.time).toBeInstanceOf(Date);
  });

  it("still works with regular Effect (non-stream) handlers", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      const value = yield* Effect.succeed(42);
      return { result: value };
    });

    const result = await callHandler(procedure);

    expect(result).toEqual({ result: 42 });
  });

  it("handles stream with services from runtime", async () => {
    class CounterService extends Context.Tag("CounterService")<
      CounterService,
      { count: (n: number) => Stream.Stream<number> }
    >() {}

    const CounterLive = Layer.succeed(CounterService, {
      count: (n) => Stream.make(...Array.from({ length: n }, (_, i) => i)),
    });

    const rt = ManagedRuntime.make(CounterLive);
    const builder = makeEffectORPC(rt);
    const procedure = builder.effect(function* () {
      const counter = yield* CounterService;
      return counter.count(3);
    });

    const result = await callHandler(procedure);

    const values = await collectIterator(result);
    expect(values).toEqual([0, 1, 2]);
  });

  it("respects abort signal during stream consumption", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(() =>
      Stream.repeatEffect(
        Effect.map(Effect.sleep("50 millis"), () => ({ tick: Date.now() })),
      ),
    );

    const controller = new AbortController();
    const result = await callHandler(procedure, {
      signal: controller.signal,
    });

    const values: any[] = [];
    try {
      for await (const value of result) {
        values.push(value);
        if (values.length >= 2) {
          controller.abort();
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    } catch (e: any) {
      expect(e.code).toBe("CLIENT_CLOSED_REQUEST");
    }
    expect(values.length).toBeGreaterThanOrEqual(2);
  }, 10000);
});
