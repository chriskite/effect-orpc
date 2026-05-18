import { ORPCError } from "@orpc/contract";
import type {
  Context,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { ManagedRuntime } from "effect";
import { Cause, Effect, Exit } from "effect";

import { getCurrentFiberRefs } from "./fiber-context-bridge";
import type { EffectErrorConstructorMap, EffectErrorMap } from "./tagged-error";
import {
  createEffectErrorConstructorMap,
  isORPCTaggedError,
} from "./tagged-error";
import type { EffectProcedureHandler, EffectSpanConfig } from "./types";

export function toORPCErrorFromCause(
  cause: Cause.Cause<unknown>,
  signal?: AbortSignal,
): ORPCError<string, unknown> {
  if (Cause.isInterruptedOnly(cause)) {
    if (signal?.aborted) {
      return new ORPCError("CLIENT_CLOSED_REQUEST", {
        cause: abortReasonToError(signal.reason),
      });
    }
    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error("Effect fiber interrupted"),
    });
  }
  return Cause.match(cause, {
    onDie(defect) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: defect instanceof Error ? defect : new Error(String(defect)),
      });
    },
    onFail(error) {
      if (isORPCTaggedError(error)) {
        return error.toORPCError();
      }
      if (error instanceof ORPCError) {
        return error;
      }
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: error,
      });
    },
    onInterrupt(fiberId) {
      // Interrupt mixed with non-interrupt causes — keep as 500 to surface the real failure.
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`Effect fiber ${fiberId} interrupted`),
      });
    },
    onSequential: combineCauses,
    onEmpty: new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error("Unknown error"),
    }),
    onParallel: combineCauses,
  });
}

function abortReasonToError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  if (reason === undefined) {
    return new Error("Client aborted request");
  }
  return new Error(String(reason));
}

function combineCauses(
  left: ORPCError<string, unknown>,
  right: ORPCError<string, unknown>,
): ORPCError<string, unknown> {
  const leftCause = left.cause;
  const rightCause = right.cause;
  if (rightCause === undefined || rightCause === leftCause) {
    return left;
  }
  const aggregated =
    leftCause === undefined
      ? rightCause
      : new AggregateError(
          [leftCause, rightCause],
          "Effect cause contained multiple failures",
        );
  return new ORPCError(left.code, {
    defined: left.defined,
    status: left.status,
    message: left.message,
    data: left.data,
    cause: aggregated,
  });
}

export function createEffectProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  effectFn: EffectProcedureHandler<
    TCurrentContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    any
  >;
  spanConfig?: EffectSpanConfig;
  defaultCaptureStackTrace: () => string | undefined;
}): ProcedureHandler<
  TCurrentContext,
  TInput,
  TOutput,
  any,
  TMeta & Record<never, never>
> {
  const {
    runtime,
    effectErrorMap,
    effectFn,
    spanConfig,
    defaultCaptureStackTrace,
  } = options;

  return async (opts) => {
    const effectOpts: ProcedureHandlerOptions<
      TCurrentContext,
      TInput,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta & Record<never, never>
    > = {
      context: opts.context,
      input: opts.input,
      path: opts.path,
      procedure: opts.procedure,
      signal: opts.signal,
      lastEventId: opts.lastEventId,
      errors: createEffectErrorConstructorMap(effectErrorMap),
    };

    const spanName = spanConfig?.name ?? opts.path.join(".");
    const captureStackTrace =
      spanConfig?.captureStackTrace ?? defaultCaptureStackTrace;
    // `Effect.fnUntraced` accepts both generator and async functions; the
    // intersection of those over our `EffectProcedureHandler` shape is wider
    // than the type system can express. Cast through `unknown` at the boundary.
    const resolver = Effect.fnUntraced(
      effectFn as unknown as Parameters<typeof Effect.fnUntraced>[0],
    );
    const tracedEffect = Effect.withSpan(resolver(effectOpts), spanName, {
      captureStackTrace,
    });
    // Inherit captured request-scoped FiberRefs (set up by withFiberContext)
    // into the runtime fiber. The captured refs override the runtime's refs
    // on conflict — matches the README guarantee that request-scoped state
    // shadows application-scoped state.
    const capturedFiberRefs = getCurrentFiberRefs();
    const effectWithRefs = capturedFiberRefs
      ? Effect.zipRight(
          Effect.inheritFiberRefs(capturedFiberRefs),
          tracedEffect,
        )
      : tracedEffect;
    const exit = await runtime.runPromiseExit(effectWithRefs, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause, opts.signal);
    }

    return exit.value as TOutput;
  };
}
