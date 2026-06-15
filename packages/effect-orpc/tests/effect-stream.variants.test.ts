import { eventIterator } from "@orpc/contract";
import { Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { makeEffectORPC, ORPCTaggedError } from "../src";

/**
 * Type-regression coverage for the stream `.effect()` overload across every
 * reachable builder variant.
 *
 * The bug this guards against: if a variant's stream and non-stream `effect`
 * overloads disagree on the `input` type, an un-annotated handler param
 * (`(opts) => Stream...`) fails overload resolution under `tsc -b` — TS locks
 * the contextual type from the first overload and contravariance rejects the
 * second. So every case below uses the bare `(opts) => Stream` form (reading
 * `opts` to force the param to be type-checked); input variants additionally
 * destructure `{ input }` to assert the parsed-input type flows through.
 *
 * These are as much compile-time assertions as runtime ones — if the overloads
 * regress, `bun run check` fails before the test runs.
 */

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

async function collect<T>(iter: AsyncIteratorObject<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) {
    out.push(v);
  }
  return out;
}

const inputSchema = z.object({ count: z.number() });
const outputSchema = eventIterator(z.object({ value: z.number() }));

class BoomError extends ORPCTaggedError("NOT_FOUND", { status: 404 }) {}

describe("effect stream — builder variant type coverage", () => {
  it("base: no input, no output", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect((opts) => {
      // reading opts forces the param to be type-checked
      void opts.lastEventId;
      return Stream.make({ value: 1 }, { value: 2 });
    });

    expect(await collect(await callHandler(procedure))).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
  });

  it("input only", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.input(inputSchema).effect(({ input }) =>
      Stream.make(
        ...Array.from({ length: input.count }, (_, i) => ({
          value: i,
        })),
      ),
    );

    const result = await callHandler(procedure, { input: { count: 3 } });
    expect(await collect(result)).toEqual([
      { value: 0 },
      { value: 1 },
      { value: 2 },
    ]);
  });

  it("output only", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.output(outputSchema).effect((opts) => {
      void opts.lastEventId;
      return Stream.make({ value: 7 });
    });

    expect(await collect(await callHandler(procedure))).toEqual([{ value: 7 }]);
  });

  it("input + output", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .input(inputSchema)
      .output(outputSchema)
      .effect(({ input }) =>
        Stream.make(
          ...Array.from({ length: input.count }, (_, i) => ({
            value: i,
          })),
        ),
      );

    const result = await callHandler(procedure, { input: { count: 2 } });
    expect(await collect(result)).toEqual([{ value: 0 }, { value: 1 }]);
  });

  it("with errors()", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.errors({ NOT_FOUND: {} }).effect((opts) => {
      void opts.lastEventId;
      return Stream.make({ value: 1 });
    });

    expect(await collect(await callHandler(procedure))).toEqual([{ value: 1 }]);
  });

  it("with errors() + input + output", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .errors({ NOT_FOUND: {} })
      .input(inputSchema)
      .output(outputSchema)
      .effect(({ input }) => Stream.make({ value: input.count }));

    const result = await callHandler(procedure, { input: { count: 9 } });
    expect(await collect(result)).toEqual([{ value: 9 }]);
  });

  it("with Effect middleware (useEffect)", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .useEffect(function* ({ next }) {
        return yield* next({});
      })
      .input(inputSchema)
      .output(outputSchema)
      .effect(({ input }) => Stream.make({ value: input.count }));

    const result = await callHandler(procedure, { input: { count: 4 } });
    expect(await collect(result)).toEqual([{ value: 4 }]);
  });

  it("with traced()", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder.traced("stream.span").effect((opts) => {
      void opts.lastEventId;
      return Stream.make({ value: 5 });
    });

    expect(await collect(await callHandler(procedure))).toEqual([{ value: 5 }]);
  });

  it("error mapping works across a variant with errors()", async () => {
    const builder = makeEffectORPC(runtime);
    const procedure = builder
      .errors({ NOT_FOUND: {} })
      .output(outputSchema)
      .effect(() => Stream.fail(new BoomError()));

    await expect(async () => {
      for await (const _ of await callHandler(procedure)) {
        // unreachable
      }
    }).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
