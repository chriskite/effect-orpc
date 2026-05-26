import type { ORPCError, ORPCErrorCode } from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  ErrorMapItem,
  Meta,
  ORPCErrorFromErrorMap,
  Schema,
} from "@orpc/contract";
import type {
  Builder,
  BuilderDef,
  BuilderWithMiddlewares,
  Context,
  EnhanceRouterOptions,
  MiddlewareNextFnOptions,
  MiddlewareOptions,
  MiddlewareOutputFn,
  MiddlewareResult,
  ProcedureBuilder,
  ProcedureBuilderWithInput,
  ProcedureBuilderWithInputOutput,
  ProcedureBuilderWithOutput,
  ProcedureDef,
  ProcedureHandlerOptions,
  RouterBuilder,
} from "@orpc/server";
import type { MaybeOptionalOptions } from "@orpc/shared";
import type { Effect, ManagedRuntime } from "effect";
import type { YieldWrap } from "effect/Utils";

import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  EffectErrorMapToUnion,
  ORPCTaggedErrorInstance,
} from "../tagged-error";

type EffectBuilderDefBase<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> = EnhanceRouterOptions<EffectErrorMapToErrorMap<TEffectErrorMap>> &
  BuilderDef<
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
  >;

/**
 * Extended builder definition that includes the Effect ManagedRuntime.
 */
export interface EffectBuilderDef<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends EffectBuilderDefBase<
  TInputSchema,
  TOutputSchema,
  TEffectErrorMap,
  TMeta
> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  /**
   * Optional span configuration for Effect tracing.
   */
  spanConfig?: EffectSpanConfig;
  /**
   * Effect-extended error map that supports both traditional errors and tagged errors.
   */
  effectErrorMap: TEffectErrorMap;
}

/**
 * Extended procedure definition that includes the Effect ManagedRuntime.
 */
export interface EffectProcedureDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends ProcedureDef<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  EffectErrorMapToErrorMap<TEffectErrorMap>,
  TMeta
> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
}

/**
 * Configuration for Effect span tracing.
 */
export interface EffectSpanConfig {
  /**
   * The name of the span for telemetry.
   */
  name: string;
  /**
   * Function to lazily capture the stack trace at definition time.
   */
  captureStackTrace: () => string | undefined;
}

/**
 * Handler type for Effect procedures.
 * The handler receives procedure options and returns an Effect.
 */
export type EffectProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  THandlerOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = (
  opt: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => Generator<
  YieldWrap<
    Effect.Effect<
      any,
      | EffectErrorMapToUnion<TEffectErrorMap>
      | ORPCError<ORPCErrorCode, unknown>,
      TRequirementsProvided
    >
  >,
  THandlerOutput,
  never
>;

/**
 * Maps an `EffectErrorMap` to a discriminated union of plain `ORPCError`
 * instances keyed by `code`.
 *
 * Implemented by piping the Effect-extended error map through
 * `EffectErrorMapToErrorMap` (which normalizes tagged classes into plain
 * `ErrorMapItem` entries) and then through oRPC's own `ORPCErrorFromErrorMap`.
 * Delegating to oRPC's machinery keeps the schema → data inference aligned
 * with everything else in the ecosystem and avoids subtle re-derivation bugs
 * (e.g. forgetting the `infer TSchema extends Schema<unknown, unknown>`
 * constraint that `InferSchemaOutput` relies on).
 *
 * This differs intentionally from `EffectErrorMapToUnion` in `tagged-error.ts`:
 *
 * - `EffectErrorMapToUnion` returns instance types — for tagged classes, that's
 *   the tagged class itself. That's the right shape for the *raising* side: a
 *   `.effect()` handler that does `yield* errors.SOMETHING({...})` produces a
 *   tagged-class instance and the user wants `Effect.catchTag` to discriminate
 *   on `_tag`.
 * - `EffectErrorMapToORPCErrorUnion` returns plain `ORPCError` instances. That's
 *   the right shape for the *receiving* side of `next()` inside a middleware:
 *   downstream tagged errors are converted via `.toORPCError()` in
 *   `toORPCErrorFromCause` before they cross the throw boundary, so the value
 *   that bubbles back into the middleware Effect is always a plain `ORPCError`,
 *   never the original tagged class.
 *
 * Used to type the failure channel of `EffectMiddlewareNextFn` so callers can
 * narrow on `code` (TypeScript's standard discriminated-union analysis) and
 * read `data` with the schema-derived shape rather than `unknown`.
 */
export type EffectErrorMapToORPCErrorUnion<T extends EffectErrorMap> =
  ORPCErrorFromErrorMap<EffectErrorMapToErrorMap<T>>;

/**
 * Failure-channel shape for `EffectMiddlewareNextFn`.
 *
 * Design note: we'd like to express "the declared errors, *plus* anything else
 * that may have been thrown downstream." TypeScript can't represent that
 * cleanly because `ORPCErrorCode = CommonORPCErrorCode | (string & {})` — the
 * `(string & {})` escape is wider than any string literal and absorbs the
 * declared branches under narrowing (`e.code === "BAD_REQUEST"` keeps the
 * fallback alive, collapsing `data` back to `unknown`).
 *
 * So we settle for a conditional:
 *
 * - When the builder has *declared* errors via `.errors({...})`, the failure
 *   channel is exactly the discriminated union of those errors. This matches
 *   oRPC's typed-error contract — only declared codes appear in the type, even
 *   though at runtime any `ORPCError` can surface — and lets users narrow on
 *   `code` with full `data` precision.
 * - When the builder has *no* declared errors, we keep the original wide
 *   `ORPCError<ORPCErrorCode, unknown>` so callers can still `catchAll` and
 *   inspect at runtime without the failure channel collapsing to `never`.
 *
 * The `[T] extends [never]` form is "tuple wrapping" — it suppresses
 * distribution so that an empty `EffectErrorMap` evaluates as a whole rather
 * than per-key. Without it, the conditional would distribute over `never` and
 * yield `never` instead of the fallback.
 */
type EffectMiddlewareNextFailure<TEffectErrorMap extends EffectErrorMap> = [
  EffectErrorMapToORPCErrorUnion<TEffectErrorMap>,
] extends [never]
  ? ORPCError<ORPCErrorCode, unknown>
  : EffectErrorMapToORPCErrorUnion<TEffectErrorMap>;

/**
 * Effect-shaped continuation for middleware. Mirrors the oRPC
 * `MiddlewareNextFn` shape but returns an `Effect` instead of a `Promisable`
 * so that the user's middleware Effect can `yield* next(...)` and stay
 * inside the Effect composition story.
 *
 * The failure channel reflects what the surrounding builder *declares* it
 * knows about — see `EffectMiddlewareNextFailure` for the conditional. When
 * errors are declared, the channel is a discriminated union keyed by `code`,
 * so `if (e.code === "BAD_REQUEST")` narrows `e.data` to the schema-derived
 * type with no type predicate needed.
 *
 * Note that tagged-error class identity is *not* preserved across the
 * boundary: by the time a downstream failure surfaces here,
 * `toORPCErrorFromCause` has already converted any `ORPCTaggedError` via
 * `.toORPCError()`, so `Effect.catchTag` on `_tag` does not apply. Narrow on
 * `code` instead.
 *
 * @example
 * ```ts
 * yield* next().pipe(
 *   Effect.catchAll((e) => {
 *     if (e.code === "BAD_REQUEST") {
 *       // e.data is { reason: string }, not unknown
 *       return Effect.logWarning(`bad request: ${e.data.reason}`);
 *     }
 *     return Effect.fail(e);
 *   }),
 * )
 * ```
 */
export interface EffectMiddlewareNextFn<
  TOutput,
  // Defaults to "no declared errors" so direct references to
  // `EffectMiddlewareNextFn<TOutput>` remain valid; the failure channel then
  // collapses to the original wide `ORPCError<ORPCErrorCode, unknown>`.
  TEffectErrorMap extends EffectErrorMap = Record<never, never>,
> {
  <U extends Context = Record<never, never>>(
    ...rest: MaybeOptionalOptions<MiddlewareNextFnOptions<U>>
  ): Effect.Effect<
    MiddlewareResult<U, TOutput>,
    EffectMiddlewareNextFailure<TEffectErrorMap>
  >;
}

/**
 * Options passed to an Effect middleware. Identical to the oRPC
 * `MiddlewareOptions` shape except that `next` is Effect-shaped and the
 * `errors` constructor map understands `ORPCTaggedError` classes from the
 * surrounding builder's `effectErrorMap`.
 */
export type EffectMiddlewareOptions<
  TInContext extends Context,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> = Omit<
  MiddlewareOptions<
    TInContext,
    TOutput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
  "next"
> & {
  next: EffectMiddlewareNextFn<TOutput, TEffectErrorMap>;
};

/**
 * Effect-native middleware handler.
 *
 * Returns a generator (the same Effect.fnUntraced-compatible shape used for
 * `.effect()` procedure handlers) that yields effects and ultimately returns
 * the `MiddlewareResult` of the downstream pipeline.
 */
export type EffectMiddlewareHandler<
  TInContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
> = (
  opt: EffectMiddlewareOptions<TInContext, TOutput, TEffectErrorMap, TMeta>,
  input: TInput,
  output: MiddlewareOutputFn<TOutput>,
) => Generator<
  YieldWrap<
    Effect.Effect<
      any,
      | EffectErrorMapToUnion<TEffectErrorMap>
      | ORPCError<ORPCErrorCode, unknown>,
      TRequirementsProvided
    >
  >,
  MiddlewareResult<TOutContext, TOutput>,
  never
>;

export type EffectErrorMapToErrorMap<T extends EffectErrorMap> = {
  [K in keyof T as T[K] extends ErrorMapItem<AnySchema>
    ? K extends ORPCErrorCode
      ? K
      : never
    : T[K] extends {
          new (...args: any[]): ORPCTaggedErrorInstance<any, any, any>;
        }
      ? T[K] extends { readonly code: infer TCode extends ORPCErrorCode }
        ? TCode
        : never
      : never]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<AnySchema>
      ? T[K]
      : T[K] extends {
            new (
              ...args: any[]
            ): ORPCTaggedErrorInstance<any, any, infer TSchema>;
          }
        ? ErrorMapItem<TSchema>
        : never
    : never;
};

/**
 * Any oRPC builder-like object that has the `~orpc` definition property.
 * This includes Builder, BuilderWithMiddlewares, ProcedureBuilder, etc.
 */
export interface AnyBuilderLike<
  TInputSchema extends AnySchema = AnySchema,
  TOutputSchema extends AnySchema = AnySchema,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> {
  "~orpc": BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;
}

/**
 * Infers the initial context from an oRPC builder type.
 * Since context is a phantom type parameter not present in `~orpc`,
 * we need to use conditional type inference on the known builder types.
 */
export type InferBuilderInitialContext<T> =
  T extends Builder<infer TInitial, any, any, any, any, any>
    ? TInitial
    : T extends BuilderWithMiddlewares<infer TInitial, any, any, any, any, any>
      ? TInitial
      : T extends ProcedureBuilder<infer TInitial, any, any, any, any, any>
        ? TInitial
        : T extends ProcedureBuilderWithInput<
              infer TInitial,
              any,
              any,
              any,
              any,
              any
            >
          ? TInitial
          : T extends ProcedureBuilderWithOutput<
                infer TInitial,
                any,
                any,
                any,
                any,
                any
              >
            ? TInitial
            : T extends ProcedureBuilderWithInputOutput<
                  infer TInitial,
                  any,
                  any,
                  any,
                  any,
                  any
                >
              ? TInitial
              : T extends RouterBuilder<infer TInitial, any, any, any>
                ? TInitial
                : Context;

/**
 * Infers the current context from an oRPC builder type.
 * Since context is a phantom type parameter not present in `~orpc`,
 * we need to use conditional type inference on the known builder types.
 */
export type InferBuilderCurrentContext<T> =
  T extends Builder<any, infer TCurrent, any, any, any, any>
    ? TCurrent
    : T extends BuilderWithMiddlewares<any, infer TCurrent, any, any, any, any>
      ? TCurrent
      : T extends ProcedureBuilder<any, infer TCurrent, any, any, any, any>
        ? TCurrent
        : T extends ProcedureBuilderWithInput<
              any,
              infer TCurrent,
              any,
              any,
              any,
              any
            >
          ? TCurrent
          : T extends ProcedureBuilderWithOutput<
                any,
                infer TCurrent,
                any,
                any,
                any,
                any
              >
            ? TCurrent
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  infer TCurrent,
                  any,
                  any,
                  any,
                  any
                >
              ? TCurrent
              : T extends RouterBuilder<any, infer TCurrent, any, any>
                ? TCurrent
                : Context;

/**
 * Infers the input schema from an oRPC builder type.
 */
export type InferBuilderInputSchema<T> =
  T extends Builder<any, any, infer TInput, any, any, any>
    ? TInput
    : T extends BuilderWithMiddlewares<any, any, infer TInput, any, any, any>
      ? TInput
      : T extends ProcedureBuilder<any, any, infer TInput, any, any, any>
        ? TInput
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              infer TInput,
              any,
              any,
              any
            >
          ? TInput
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                infer TInput,
                any,
                any,
                any
              >
            ? TInput
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  infer TInput,
                  any,
                  any,
                  any
                >
              ? TInput
              : Schema<unknown, unknown>;

/**
 * Infers the output schema from an oRPC builder type.
 */
export type InferBuilderOutputSchema<T> =
  T extends Builder<any, any, any, infer TOutput, any, any>
    ? TOutput
    : T extends BuilderWithMiddlewares<any, any, any, infer TOutput, any, any>
      ? TOutput
      : T extends ProcedureBuilder<any, any, any, infer TOutput, any, any>
        ? TOutput
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              infer TOutput,
              any,
              any
            >
          ? TOutput
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                infer TOutput,
                any,
                any
              >
            ? TOutput
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  infer TOutput,
                  any,
                  any
                >
              ? TOutput
              : Schema<unknown, unknown>;

/**
 * Infers the error map from an oRPC builder type.
 */
export type InferBuilderErrorMap<T> =
  T extends Builder<any, any, any, any, infer TErrorMap, any>
    ? TErrorMap
    : T extends BuilderWithMiddlewares<any, any, any, any, infer TErrorMap, any>
      ? TErrorMap
      : T extends ProcedureBuilder<any, any, any, any, infer TErrorMap, any>
        ? TErrorMap
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              any,
              infer TErrorMap,
              any
            >
          ? TErrorMap
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                any,
                infer TErrorMap,
                any
              >
            ? TErrorMap
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  any,
                  infer TErrorMap,
                  any
                >
              ? TErrorMap
              : T extends RouterBuilder<any, any, infer TErrorMap, any>
                ? TErrorMap
                : ErrorMap;

/**
 * Infers the meta from an oRPC builder type.
 */
export type InferBuilderMeta<T> =
  T extends Builder<any, any, any, any, any, infer TMeta>
    ? TMeta
    : T extends BuilderWithMiddlewares<any, any, any, any, any, infer TMeta>
      ? TMeta
      : T extends ProcedureBuilder<any, any, any, any, any, infer TMeta>
        ? TMeta
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              any,
              any,
              infer TMeta
            >
          ? TMeta
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                any,
                any,
                infer TMeta
              >
            ? TMeta
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  any,
                  any,
                  infer TMeta
                >
              ? TMeta
              : T extends RouterBuilder<any, any, any, infer TMeta>
                ? TMeta
                : Meta;

export type { EffectBuilderSurface } from "./effect-builder-surface";
export type { EffectDecoratedProcedureSurface } from "./effect-procedure-surface";

export * from "./variants";
