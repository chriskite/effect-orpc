import { ORPCError } from "@orpc/contract";
import type {
  Context,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import { streamToAsyncIteratorClass } from "@orpc/shared";
import type { ManagedRuntime } from "effect";
import { Cause, Effect, Exit, Stream } from "effect";

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

/**
 * In-band representation of a streamed value or its terminal error. Errors are
 * carried as values (not stream failures) so the underlying ReadableStream
 * never calls `controller.error()`, which would reset its queue and drop a
 * value buffered just before the failure.
 */
type StreamChunk =
  | { _tag: "item"; value: unknown }
  | { _tag: "error"; error: ORPCError<string, unknown> };

/**
 * Adapt the tagged-chunk iterator back into the value stream callers expect:
 * yield each item in order, then throw the terminal error (if any) only after
 * all preceding values have been delivered. Closing this iterator cancels the
 * underlying reader, interrupting the source fiber.
 */
async function* unwrapStreamChunks(
  base: AsyncIteratorObject<StreamChunk>,
): AsyncGenerator {
  try {
    for (;;) {
      const { done, value } = await base.next();
      if (done) {
        return;
      }
      if (value._tag === "error") {
        throw value.error;
      }
      yield value.value;
    }
  } finally {
    await base.return?.(undefined);
  }
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

    const result = (effectFn as Function)(effectOpts);

    if (
      result != null &&
      typeof result === "object" &&
      Stream.StreamTypeId in result
    ) {
      return runStreamHandler(
        result as Stream.Stream<unknown, unknown, unknown>,
        { spanName, captureStackTrace, signal: opts.signal },
      );
    }

    const generatorFn = () => result;
    const resolver = Effect.fnUntraced(
      generatorFn as unknown as Parameters<typeof Effect.fnUntraced>[0],
    );
    const tracedEffect = Effect.withSpan(resolver(), spanName, {
      captureStackTrace,
    });
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

    if (
      exit.value != null &&
      typeof exit.value === "object" &&
      Stream.StreamTypeId in exit.value
    ) {
      return runStreamHandler(
        exit.value as Stream.Stream<unknown, unknown, unknown>,
        { spanName, captureStackTrace, signal: opts.signal },
      );
    }

    return exit.value as TOutput;
  };

  async function runStreamHandler(
    stream: Stream.Stream<unknown, unknown, unknown>,
    config: {
      spanName: string;
      captureStackTrace: () => string | undefined;
      signal?: AbortSignal;
    },
  ) {
    // Carry both values and the terminal error as in-band, tagged chunks.
    //
    // If we let the Stream *fail* into the ReadableStream, Effect's
    // `toReadableStream` calls `controller.error()` from a fiber observer the
    // moment the stream fails. WHATWG `ReadableStreamDefaultControllerError`
    // resets the queue, so a value enqueued immediately before the failure is
    // discarded before the consumer can read it — silent data loss for any
    // `emit(x)` followed by a failure. Instead we map the full Cause (typed
    // failures AND defects/interrupts) into a terminal *value*; the stream
    // always completes successfully, the ReadableStream closes normally, and
    // the iterator below re-throws the error only after every prior value has
    // been delivered.
    const mappedStream: Stream.Stream<StreamChunk, never, unknown> =
      Stream.catchAllCause(
        Stream.map(stream, (value): StreamChunk => ({ _tag: "item", value })),
        (cause) =>
          Stream.succeed<StreamChunk>({
            _tag: "error",
            error: toORPCErrorFromCause(cause, config.signal),
          }),
      );
    const readableEffect = Stream.toReadableStreamEffect(mappedStream);
    const tracedEffect = Effect.withSpan(readableEffect, config.spanName, {
      captureStackTrace: config.captureStackTrace,
    });
    const capturedFiberRefs = getCurrentFiberRefs();
    const effectWithRefs = capturedFiberRefs
      ? Effect.zipRight(
          Effect.inheritFiberRefs(capturedFiberRefs),
          tracedEffect,
        )
      : tracedEffect;

    const exit = await runtime.runPromiseExit(
      effectWithRefs as Effect.Effect<ReadableStream<unknown>, never, never>,
      { signal: config.signal },
    );
    // This only catches failures constructing the ReadableStream. Errors
    // raised while the stream is being consumed surface through the stream
    // itself (mapped by `mappedStream` above), not here.
    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause, config.signal);
    }
    const readableStream = exit.value as ReadableStream<StreamChunk>;
    const iterator = unwrapStreamChunks(
      streamToAsyncIteratorClass(readableStream),
    );
    if (config.signal?.aborted) {
      await iterator.return?.(undefined);
      throw new ORPCError("CLIENT_CLOSED_REQUEST", {
        cause: abortReasonToError(config.signal.reason),
      });
    }
    config.signal?.addEventListener(
      "abort",
      () => {
        iterator.return?.(undefined);
      },
      { once: true },
    );
    return iterator as TOutput;
  }
}
