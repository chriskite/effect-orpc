import type {
  AnySchema,
  ContractRouter,
  ErrorMap,
  Meta,
  Schema,
} from "@orpc/contract";
import type { Context, Router } from "@orpc/server";
import { Builder, fallbackConfig, lazy } from "@orpc/server";
import type { ManagedRuntime } from "effect";

import { enhanceEffectRouter } from "./effect-enhance-router";
import { EffectDecoratedProcedure } from "./effect-procedure";
import { createEffectProcedureHandler } from "./effect-runtime";
import {
  createNodeProxy,
  unhandled,
  type NodeProxyContext,
} from "./extension/create-node-proxy";
import {
  attachEffectState,
  getEffectErrorMap,
  unwrapEffectUpstream,
  type EffectProxyTarget,
} from "./extension/state";
import type { EffectErrorMap, MergedEffectErrorMap } from "./tagged-error";
import { effectErrorMapToErrorMap } from "./tagged-error";
import type {
  AnyBuilderLike,
  EffectBuilderDef,
  InferBuilderCurrentContext,
  InferBuilderErrorMap,
  InferBuilderInitialContext,
  InferBuilderInputSchema,
  InferBuilderMeta,
  InferBuilderOutputSchema,
} from "./types";
import type { EffectBuilderSurface } from "./types/effect-builder-surface";

const builderVirtualDescriptors = {
  "~effect": { enumerable: true },
  effect: { enumerable: false },
  errors: { enumerable: false },
  handler: { enumerable: false },
  lazy: { enumerable: false },
  router: { enumerable: false },
  traced: { enumerable: false },
} as const;

const builderVirtualKeys = [
  "~effect",
  "errors",
  "effect",
  "traced",
  "handler",
  "router",
  "lazy",
] as const;

type EffectBuilderTarget = EffectBuilder<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
> &
  EffectProxyTarget<AnyBuilderLike>;

function isBuilderLike(value: unknown): value is AnyBuilderLike {
  return typeof value === "object" && value !== null && "~orpc" in value;
}

function getOrCreateVirtualMethod<T>(
  context: NodeProxyContext<EffectBuilderTarget, AnyBuilderLike>,
  prop: PropertyKey,
  factory: () => T,
): T {
  const cache = context.methodCache;
  if (cache.has(prop)) {
    return cache.get(prop) as T;
  }

  const value = factory();
  cache.set(prop, value);
  return value;
}

function getEffectBuilderDef(
  context: NodeProxyContext<EffectBuilderTarget, AnyBuilderLike>,
): EffectBuilderDef<any, any, any, any, any, any> {
  return {
    ...context.upstream["~orpc"],
    effectErrorMap: context.state.effectErrorMap,
    runtime: context.state.runtime,
    spanConfig: context.state.spanConfig,
  };
}

function wrapBuilderLike(
  builder: AnyBuilderLike,
  state: NodeProxyContext<EffectBuilderTarget, AnyBuilderLike>["state"],
): EffectBuilder<any, any, any, any, any, any, any, any> {
  return new EffectBuilder(
    {
      ...builder["~orpc"],
      effectErrorMap: state.effectErrorMap,
      runtime: state.runtime,
      spanConfig: state.spanConfig,
    },
    unwrapEffectUpstream(builder),
  );
}

function createEffectBuilderProxy(
  target: EffectBuilderTarget,
): EffectBuilderTarget {
  return createNodeProxy<EffectBuilderTarget, AnyBuilderLike>(target, {
    getVirtual(context, prop) {
      const effectDef = getEffectBuilderDef(context);
      if (prop === "~effect") {
        return getEffectBuilderDef(context);
      }

      const { upstream: source, state } = context;

      switch (prop) {
        case "errors":
          return getOrCreateVirtualMethod(context, prop, () => {
            return <U extends EffectErrorMap>(errors: U) => {
              const nextEffectErrorMap: MergedEffectErrorMap<
                typeof state.effectErrorMap,
                U
              > = {
                ...state.effectErrorMap,
                ...errors,
              };
              const nextBuilder: AnyBuilderLike = Reflect.apply(
                Reflect.get(source, "errors", source),
                source,
                [effectErrorMapToErrorMap(errors)],
              );

              return wrapBuilderLike(nextBuilder, {
                ...state,
                effectErrorMap: nextEffectErrorMap,
              });
            };
          });
        case "effect":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              effectFn: Parameters<
                EffectBuilderSurface<
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any
                >["effect"]
              >[0],
            ) => {
              const defaultCaptureStackTrace = addSpanStackTrace();
              return new EffectDecoratedProcedure({
                ...effectDef,
                handler: async (opts) => {
                  // `opts` is contravariant: oRPC passes a wider context
                  // shape than the handler factory's narrower constraint
                  // can statically prove compatible.
                  return createEffectProcedureHandler({
                    defaultCaptureStackTrace,
                    effectErrorMap: state.effectErrorMap,
                    effectFn,
                    runtime: state.runtime,
                    spanConfig: state.spanConfig,
                  })(opts as unknown as never);
                },
              });
            };
          });
        case "traced":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (spanName: string) =>
              wrapBuilderLike(source, {
                ...state,
                spanConfig: {
                  captureStackTrace: addSpanStackTrace(),
                  name: spanName,
                },
              });
          });
        case "handler":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              handler: Parameters<
                EffectBuilderSurface<
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any
                >["handler"]
              >[0],
            ) =>
              new EffectDecoratedProcedure({
                ...effectDef,
                handler,
              });
          });
        case "router":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (router: Router<ContractRouter<any>, any>) =>
              // enhanceEffectRouter returns the structural enhanced shape; the
              // declared return type from the virtual method is generic.
              enhanceEffectRouter(router, effectDef) as unknown;
          });
        case "lazy":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              loader: () => Promise<{
                default: Router<ContractRouter<any>, any>;
              }>,
            ) =>
              // Same as above — enhanceEffectRouter is typed at the call site
              // via the declared method signature, not at the Proxy return.
              enhanceEffectRouter(lazy(loader), effectDef) as unknown;
          });
        default:
          return unhandled();
      }
    },
    virtualDescriptors: builderVirtualDescriptors,
    virtualKeys: builderVirtualKeys,
    wrapResult(context, _prop, result) {
      if (!isBuilderLike(result)) {
        return result;
      }

      return wrapBuilderLike(result, context.state);
    },
  });
}

// Frames belonging to this package — the captured trace should walk past them
// and land on the first user frame.
const PACKAGE_FRAME_MARKERS = [
  "effect-orpc/dist/",
  "effect-orpc/src/",
  "/packages/effect-orpc/dist/",
  "/packages/effect-orpc/src/",
];

/**
 * Captures the stack trace at the call site for better error reporting in spans.
 * This is called at procedure definition time to capture where the procedure was defined.
 *
 * The cache uses three states: `undefined` = not yet resolved, `null` = resolved
 * to no user frame, `string` = resolved user frame.
 */
export function addSpanStackTrace(): () => string | undefined {
  const traceError = new Error();
  let cache: string | null | undefined;
  return () => {
    if (cache !== undefined) {
      return cache ?? undefined;
    }
    const stack = traceError.stack;
    if (stack === undefined) {
      cache = null;
      return;
    }
    const lines = stack.split("\n");
    // Skip the Error header line. Walk frames; first frame that does not
    // belong to this package wins.
    for (let i = 1; i < lines.length; i++) {
      const frame = lines[i];
      if (frame === undefined) continue;
      const trimmed = frame.trim();
      if (PACKAGE_FRAME_MARKERS.some((marker) => trimmed.includes(marker))) {
        continue;
      }
      if (trimmed.startsWith("at node:internal/")) {
        continue;
      }
      cache = trimmed;
      return cache;
    }
    cache = null;
    return;
  };
}

/**
 * Effect-native procedure builder that wraps an oRPC Builder instance
 * and adds Effect-specific capabilities while preserving Effect error
 * and requirements types.
 */
export class EffectBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> implements EffectBuilderSurface<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  TEffectErrorMap,
  TMeta,
  TRequirementsProvided,
  TRuntimeError
> {
  /**
   * Sets or overrides the config.
   *
   * @see {@link https://orpc.dev/docs/client/server-side#middlewares-order Middlewares Order Docs}
   * @see {@link https://orpc.dev/docs/best-practices/dedupe-middleware#configuration Dedupe Middleware Docs}
   */
  declare $config: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$config"];
  /**
   * Set or override the initial context.
   *
   * @see {@link https://orpc.dev/docs/context Context Docs}
   */
  declare $context: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$context"];
  /**
   * Sets or overrides the initial meta.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  declare $meta: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$meta"];
  /**
   * Sets or overrides the initial route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  declare $route: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$route"];
  /**
   * Sets or overrides the initial input schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#initial-configuration Initial Procedure Configuration Docs}
   */
  declare $input: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$input"];
  /**
   * This property holds the defined options and the effect-specific properties.
   */
  declare "~effect": EffectBuilderDef<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * This property holds the defined options.
   */
  declare "~orpc": EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["~orpc"];
  /**
   * Creates a middleware.
   *
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  declare middleware: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["middleware"];
  /**
   * Adds type-safe custom errors.
   * Supports both traditional oRPC error definitions and ORPCTaggedError classes.
   *
   * @example
   * ```ts
   * // Traditional format
   * builder.errors({ BAD_REQUEST: { status: 400, message: 'Bad request' } })
   *
   * // Tagged error class
   * builder.errors({ USER_NOT_FOUND: UserNotFoundError })
   *
   * // Mixed
   * builder.errors({
   *   BAD_REQUEST: { status: 400 },
   *   USER_NOT_FOUND: UserNotFoundError,
   * })
   * ```
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  declare errors: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["errors"];
  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  declare use: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["use"];
  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  declare meta: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["meta"];
  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  declare route: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["route"];
  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  declare input: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["input"];
  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  declare output: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["output"];
  /**
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns An EffectBuilder with span tracing configured
   *
   * @example
   * ```ts
   * const getUser = effectOs
   *   .input(z.object({ id: z.string() }))
   *   .traced('users.getUser')
   *   .effect(function* ({ input }) {
   *     const userService = yield* UserService
   *     return yield* userService.findById(input.id)
   *   })
   * ```
   */
  declare traced: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["traced"];
  /**
   * Defines the handler of the procedure using a standard async/sync function.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  declare handler: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["handler"];
  /**
   * Defines the handler of the procedure using an Effect.
   * The Effect is executed using the ManagedRuntime provided during builder creation.
   * The effect is automatically wrapped with `Effect.withSpan`.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  declare effect: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["effect"];
  /**
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  declare prefix: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["prefix"];
  /**
   * Adds tags to all procedures in the router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  declare tag: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["tag"];
  /**
   * Applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  declare router: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["router"];
  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  declare lazy: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["lazy"];

  constructor(
    def: EffectBuilderDef<
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >,
    builder?: AnyBuilderLike,
  ) {
    const { runtime, spanConfig, effectErrorMap, ...orpcDef } = def;

    attachEffectState(this, builder ?? new Builder(orpcDef), {
      effectErrorMap,
      runtime,
      spanConfig,
    });

    return createEffectBuilderProxy(this);
  }
}

/**
 * Creates an Effect-aware procedure builder with the specified ManagedRuntime.
 * Uses the default builder shape from `@orpc/server`.
 *
 * @param runtime - The ManagedRuntime that provides services for Effect procedures
 * @returns An EffectBuilder instance for creating Effect-native procedures
 *
 * @example
 * ```ts
 * import { makeEffectORPC } from '@orpc/effect'
 * import { Effect, Layer, ManagedRuntime } from 'effect'
 *
 * const runtime = ManagedRuntime.make(Layer.empty)
 * const effectOs = makeEffectORPC(runtime)
 *
 * const hello = effectOs.effect(() => Effect.succeed('Hello!'))
 * ```
 */
export function makeEffectORPC<TRequirementsProvided, TRuntimeError>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
): EffectBuilder<
  Context,
  Context,
  Schema<unknown, unknown>,
  Schema<unknown, unknown>,
  Record<never, never>,
  Record<never, never>,
  TRequirementsProvided,
  TRuntimeError
>;

/**
 * Creates an Effect-aware procedure builder by wrapping an existing oRPC Builder
 * with the specified ManagedRuntime.
 *
 * @param runtime - The ManagedRuntime that provides services for Effect procedures
 * @param builder - The oRPC Builder instance to wrap (e.g., a customized `os`)
 * @returns An EffectBuilder instance that extends the original builder with Effect support
 *
 * @example
 * ```ts
 * import { makeEffectORPC } from '@orpc/effect'
 * import { os } from '@orpc/server'
 * import { Effect, Layer, ManagedRuntime } from 'effect'
 *
 * // Create a customized builder
 * const authedOs = os.use(authMiddleware)
 *
 * // Wrap it with Effect support
 * const runtime = ManagedRuntime.make(UserServiceLive)
 * const effectOs = makeEffectORPC(runtime, authedOs)
 *
 * const getUser = effectOs
 *   .input(z.object({ id: z.string() }))
 *   .effect(
 *     Effect.fn(function* ({ input }) {
 *       const userService = yield* UserService
 *       return yield* userService.findById(input.id)
 *     })
 *   )
 * ```
 */
export function makeEffectORPC<
  TBuilder extends AnyBuilderLike<
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  >,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  builder: TBuilder,
): EffectBuilder<
  InferBuilderInitialContext<TBuilder>,
  InferBuilderCurrentContext<TBuilder>,
  InferBuilderInputSchema<TBuilder>,
  InferBuilderOutputSchema<TBuilder>,
  InferBuilderErrorMap<TBuilder>,
  InferBuilderMeta<TBuilder>,
  TRequirementsProvided,
  TRuntimeError
>;

export function makeEffectORPC<TRequirementsProvided, TRuntimeError>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  builder?: AnyBuilderLike,
): EffectBuilder<
  any,
  any,
  any,
  any,
  any,
  any,
  TRequirementsProvided,
  TRuntimeError
> {
  const resolvedBuilder = builder ?? emptyBuilder();
  const effectErrorMap = getEffectErrorMap(resolvedBuilder);
  return new EffectBuilder(
    {
      ...resolvedBuilder["~orpc"],
      effectErrorMap: effectErrorMap,
      errorMap: effectErrorMapToErrorMap(effectErrorMap),
      runtime,
    },
    unwrapEffectUpstream(resolvedBuilder),
  );
}

function emptyBuilder(): AnyBuilderLike {
  return new Builder({
    config: {},
    dedupeLeadingMiddlewares: true,
    errorMap: {},
    inputValidationIndex: fallbackConfig("initialInputValidationIndex"),
    meta: {},
    middlewares: [],
    outputValidationIndex: fallbackConfig("initialOutputValidationIndex"),
    route: {},
  });
}
