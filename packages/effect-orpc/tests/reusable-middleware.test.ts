import type { Context } from "@orpc/server";
import { call } from "@orpc/server";
import { Effect, HashMap, Logger, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { makeEffectORPC } from "../src/effect-builder";
// Side-effect import: installs the fiber-context bridge so FiberRefs (log
// annotations, trace context, etc.) set in a `.useEffect` middleware reach
// downstream `.effect()` procedure handlers. See README §"Effect-Native
// Middleware" → "Log annotations / FiberRefs propagate".
import "../src/node";
import type { EffectMiddlewareHandler } from "../src/types";

/**
 * Reusable Effect middleware factory: annotates every downstream log entry
 * with key/value pairs derived from the current request context.
 *
 * Generic over `TContext` so it composes with any builder. Doesn't change
 * the context (`TOutContext = Record<never, never>`), require any services
 * (`TRequirementsProvided = never`), or contribute tagged errors.
 */
function annotateLogsMiddleware<TContext extends Context>(
  getAnnotations: (context: TContext) => Record<string, unknown>,
): EffectMiddlewareHandler<
  TContext,
  Record<never, never>,
  unknown,
  unknown,
  Record<never, never>,
  Record<never, never>,
  never
> {
  return function* ({ next, context }) {
    return yield* next({ context }).pipe(
      Effect.annotateLogs(getAnnotations(context)),
    );
  };
}

describe("reusable Effect middleware", () => {
  it("annotateLogsMiddleware plugs into useEffect and tags handler logs", async () => {
    type CapturedLog = {
      message: unknown;
      annotations: Record<string, unknown>;
    };
    const captured: CapturedLog[] = [];

    const captureLogger = Logger.make(({ message, annotations }) => {
      const entries: Record<string, unknown> = {};
      for (const [key, value] of HashMap.entries(annotations)) {
        entries[key] = value;
      }
      captured.push({ message, annotations: entries });
    });

    const TestLogger = Logger.replace(Logger.defaultLogger, captureLogger);
    const runtime = ManagedRuntime.make(TestLogger);

    const effectOs = makeEffectORPC(runtime)
      .$context<{ requestId: string; userId?: string }>()
      .useEffect(
        annotateLogsMiddleware((context) => ({
          requestId: context.requestId,
          userId: context.userId ?? "anonymous",
        })),
      );

    const me = effectOs.effect(function* ({ context }) {
      yield* Effect.logInfo("resolving me");
      return { userId: context.userId ?? null };
    });

    await call(me, undefined, {
      context: { requestId: "req-1", userId: "u-1" },
    });
    await call(me, undefined, {
      context: { requestId: "req-2" },
    });

    const matches = (entry: CapturedLog, requestId: string) => {
      if (entry.annotations.requestId !== requestId) return false;
      return Array.isArray(entry.message)
        ? entry.message.includes("resolving me")
        : entry.message === "resolving me";
    };

    const log1 = captured.find((e) => matches(e, "req-1"));
    const log2 = captured.find((e) => matches(e, "req-2"));

    expect(log1?.annotations).toMatchObject({
      requestId: "req-1",
      userId: "u-1",
    });
    expect(log2?.annotations).toMatchObject({
      requestId: "req-2",
      userId: "anonymous",
    });

    await runtime.dispose();
  });
});
