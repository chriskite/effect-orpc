import { ORPCError } from "@orpc/contract";
import { Context, Effect, Layer, ManagedRuntime, Option, Tracer } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";

type CapturedSpan = {
  readonly name: string;
  readonly attributes: Record<string, unknown>;
};

function createRecordingTracer(): {
  readonly tracer: Tracer.Tracer;
  readonly spans: CapturedSpan[];
} {
  const spans: CapturedSpan[] = [];
  const tracer = Tracer.make({
    span(name, _parent, _ctx, _links, _startTime, _kind, options) {
      const attributes = new Map<string, unknown>(
        Object.entries(options?.attributes ?? {}),
      );
      const span: Tracer.Span = {
        _tag: "Span",
        name,
        spanId: `span-${spans.length + 1}`,
        traceId: "trace",
        parent: Option.none(),
        context: Context.empty(),
        status: { _tag: "Started", startTime: 0n },
        attributes,
        links: [],
        sampled: true,
        kind: "internal",
        end(_endTime, _exit) {
          spans.push({
            name,
            attributes: Object.fromEntries(attributes),
          });
        },
        attribute(key, value) {
          attributes.set(key, value);
        },
        event() {
          // not needed
        },
        addLinks() {
          // not needed
        },
      };
      return span;
    },
    context(f) {
      return f();
    },
  });
  return { tracer, spans };
}

const makeTracingRuntime = (tracer: Tracer.Tracer) =>
  ManagedRuntime.make(Layer.setTracer(tracer) as unknown as Layer.Layer<never>);

const failingHandlerOpts = (procedure: unknown) => ({
  context: {},
  input: undefined,
  path: ["users", "list"],
  procedure: procedure as never,
  signal: undefined as AbortSignal | undefined,
  lastEventId: undefined as string | undefined,
  errors: {},
});

describe("tracing", () => {
  it("records a span named after the procedure path by default", async () => {
    const { tracer, spans } = createRecordingTracer();
    const runtime = makeTracingRuntime(tracer);

    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      return "ok";
    });

    await procedure["~effect"].handler(failingHandlerOpts(procedure));

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("users.list");
  });

  it("uses .traced(name) when provided", async () => {
    const { tracer, spans } = createRecordingTracer();
    const runtime = makeTracingRuntime(tracer);

    const builder = makeEffectORPC(runtime);
    const procedure = builder.traced("custom-span-name").effect(function* () {
      return "ok";
    });

    await procedure["~effect"].handler(failingHandlerOpts(procedure));

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("custom-span-name");
  });

  it("records a code.stacktrace attribute pointing at user code on failure", async () => {
    const { tracer, spans } = createRecordingTracer();
    const runtime = makeTracingRuntime(tracer);

    // The procedure must fail for Effect to attach the code.stacktrace attribute.
    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.fail(new ORPCError("INTERNAL_SERVER_ERROR"));
      return "unreachable";
    });

    await procedure["~effect"]
      .handler(failingHandlerOpts(procedure))
      .catch(() => {
        // expected
      });

    expect(spans).toHaveLength(1);
    const stacktrace = spans[0]?.attributes["code.stacktrace"];
    expect(typeof stacktrace).toBe("string");
    expect(stacktrace).not.toContain("effect-orpc/src/");
    expect(stacktrace).not.toContain("effect-orpc/dist/");
    expect(stacktrace as string).toMatch(/tracing\.test\.ts/);
  });

  it("caches the captured frame across invocations", async () => {
    const { tracer, spans } = createRecordingTracer();
    const runtime = makeTracingRuntime(tracer);

    const builder = makeEffectORPC(runtime);
    const procedure = builder.effect(function* () {
      yield* Effect.fail(new ORPCError("INTERNAL_SERVER_ERROR"));
      return "unreachable";
    });

    const invoke = () =>
      procedure["~effect"]
        .handler(failingHandlerOpts(procedure))
        .catch(() => null);

    await invoke();
    await invoke();
    await invoke();

    expect(spans).toHaveLength(3);
    const traces = spans.map((s) => s.attributes["code.stacktrace"]);
    expect(traces[0]).toBeDefined();
    expect(traces[1]).toBe(traces[0]);
    expect(traces[2]).toBe(traces[0]);
  });
});
