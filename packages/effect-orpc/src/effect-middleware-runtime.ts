import type { Meta } from "@orpc/contract";
import { ORPCError } from "@orpc/contract";
import type { Context, Middleware, MiddlewareResult } from "@orpc/server";
import type { ManagedRuntime } from "effect";
import { Effect, Exit } from "effect";

import { toORPCErrorFromCause } from "./effect-runtime";
import { getCurrentFiberRefs, runWithFiberRefs } from "./fiber-context-bridge";
import type { EffectErrorMap } from "./tagged-error";
import { createEffectErrorConstructorMap } from "./tagged-error";
import type { EffectMiddlewareHandler, EffectMiddlewareNextFn } from "./types";

/**
 * Builds an oRPC `Middleware` from an Effect-shaped handler. The resulting
 * middleware:
 *
 * 1. Hands an Effect-shaped `next` to the user code. The user yields it,
 *    so the bridge into the downstream Promise is wrapped in
 *    `Effect.tryPromise`. Downstream `ORPCError` rejections become typed
 *    Effect failures (matching the contract advertised by
 *    `EffectMiddlewareNextFn`); anything else surfaces as a defect.
 * 2. Captures the middleware fiber's `FiberRefs` immediately before each
 *    `next()` call and installs them in the fiber-context bridge for the
 *    duration of the downstream call. That preserves the README guarantee
 *    that request-scoped state (logger annotations, trace context, etc.)
 *    set by a middleware Effect is visible to downstream `.effect()`
 *    procedures.
 * 3. Inherits captured FiberRefs from any outer `withFiberContext` scope
 *    (mirrors `createEffectProcedureHandler` so cross-cutting state set up
 *    in an HTTP adapter still reaches the middleware Effect).
 * 4. Maps the resulting `Exit.Failure` through `toORPCErrorFromCause`, so
 *    middleware failures land in oRPC's error pipeline the same way
 *    procedure failures do.
 */
export function createEffectMiddlewareHandler<
  TInContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  effectFn: EffectMiddlewareHandler<
    TInContext,
    TOutContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TMeta & Record<never, never>,
    TRequirementsProvided
  >;
}): Middleware<TInContext, TOutContext, TInput, TOutput, any, TMeta> {
  const { runtime, effectErrorMap, effectFn } = options;

  return async (opts, input, output) => {
    const errors = createEffectErrorConstructorMap(effectErrorMap);

    const effectNext: EffectMiddlewareNextFn<TOutput, TEffectErrorMap> = ((
      ...nextArgs: readonly unknown[]
    ) =>
      Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
        Effect.tryPromise({
          try: () =>
            Promise.resolve(
              runWithFiberRefs(fiberRefs, () =>
                // oRPC's `next` is typed as a generic overload set; we forward
                // the user-supplied arguments verbatim.
                (opts.next as (...args: readonly unknown[]) => unknown)(
                  ...nextArgs,
                ),
              ),
            ),
          // The runtime contract is "every failure surfaces as an ORPCError":
          // - existing `ORPCError` instances pass through unchanged so the
          //   middleware can `Effect.catchIf` on `code` and read typed `data`;
          // - everything else is wrapped as INTERNAL_SERVER_ERROR. The static
          //   failure channel of `effectNext` reflects this — see
          //   `EffectMiddlewareNextFn` for the discriminated-union shape.
          catch: (cause) =>
            cause instanceof ORPCError
              ? cause
              : new ORPCError("INTERNAL_SERVER_ERROR", {
                  cause:
                    cause instanceof Error ? cause : new Error(String(cause)),
                }),
        }),
      )) as EffectMiddlewareNextFn<TOutput, TEffectErrorMap>;

    const effectOpts = {
      context: opts.context,
      path: opts.path,
      procedure: opts.procedure,
      signal: opts.signal,
      lastEventId: opts.lastEventId,
      errors,
      next: effectNext,
    };

    // `Effect.fnUntraced` accepts both generator and async functions; the
    // intersection of those over our `EffectMiddlewareHandler` shape is wider
    // than the type system can express. Cast through `unknown` at the boundary.
    const resolver = Effect.fnUntraced(
      effectFn as unknown as Parameters<typeof Effect.fnUntraced>[0],
    );
    const middlewareEffect = resolver(effectOpts, input, output);

    const capturedFiberRefs = getCurrentFiberRefs();
    const effectWithRefs = capturedFiberRefs
      ? Effect.zipRight(
          Effect.inheritFiberRefs(capturedFiberRefs),
          middlewareEffect,
        )
      : middlewareEffect;

    const exit = await runtime.runPromiseExit(effectWithRefs, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause, opts.signal);
    }

    return exit.value as MiddlewareResult<TOutContext, TOutput>;
  };
}
