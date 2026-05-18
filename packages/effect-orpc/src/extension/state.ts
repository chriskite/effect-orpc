import type { ManagedRuntime } from "effect";

import type { EffectErrorMap } from "../tagged-error";
import type { EffectSpanConfig } from "../types";

/**
 * Effect-augmented builders/procedures carry two parallel "internal" slots:
 *
 * - `~orpc` — the upstream oRPC `def` (errorMap, middlewares, schemas, etc).
 *   This is the canonical source of identity and is what oRPC machinery
 *   reads when it doesn't know about effect-orpc.
 * - `~effect` — adds `effectErrorMap`, `runtime`, and optional `spanConfig`
 *   on top of the upstream def. Read this when you need Effect-specific
 *   metadata (tagged-error classes, the runtime for handler dispatch).
 *
 * In addition, this module manages a third store keyed by
 * `effectInternalsSymbol`, used by the Proxy wrappers to cache derived
 * method implementations and to look up upstream/state without re-walking
 * the prototype chain. Treat the symbol-keyed slot as private to this
 * package.
 */

export interface EffectExtensionState<
  TRequirementsProvided = any,
  TRuntimeError = any,
> {
  /**
   * Extended error map that supports both traditional oRPC errors and ORPCTaggedError classes.
   * @see {@link EffectErrorMap}
   */
  effectErrorMap: EffectErrorMap;
  /**
   * The Effect ManagedRuntime that provides services for Effect procedures.
   * @see {@link ManagedRuntime.ManagedRuntime}
   */
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  /**
   * Configuration for Effect span tracing.
   * @see {@link EffectSpanConfig}
   */
  spanConfig?: EffectSpanConfig;
}

export interface EffectInternals<TUpstream extends object = object> {
  upstream: TUpstream;
  state: EffectExtensionState;
  methodCache: Map<PropertyKey, unknown>;
}

export const effectInternalsSymbol = Symbol("effect-orpc/internals");

export interface EffectProxyTarget<TUpstream extends object = object> {
  [effectInternalsSymbol]: EffectInternals<TUpstream>;
}

export function attachEffectState<
  TTarget extends object,
  TUpstream extends object,
>(
  target: TTarget,
  upstream: TUpstream,
  state: EffectExtensionState,
): asserts target is TTarget & EffectProxyTarget<TUpstream> {
  Object.defineProperties(target, {
    [effectInternalsSymbol]: {
      configurable: true,
      value: {
        methodCache: new Map<PropertyKey, unknown>(),
        state,
        upstream,
      } satisfies EffectInternals<TUpstream>,
    },
  });
}

export function getEffectInternals<TUpstream extends object>(
  target: EffectProxyTarget<TUpstream>,
): EffectInternals<TUpstream> {
  const internals = target[effectInternalsSymbol];
  if (internals === undefined) {
    throw new TypeError(
      "Object is not an effect-orpc builder/procedure: missing internal state.",
    );
  }
  return internals;
}

export function getEffectUpstream<TUpstream extends object>(
  target: EffectProxyTarget<TUpstream>,
): TUpstream {
  return getEffectInternals(target).upstream;
}

export function getEffectState(
  target: EffectProxyTarget,
): EffectExtensionState {
  return getEffectInternals(target).state;
}

export function getEffectMethodCache(
  target: EffectProxyTarget,
): Map<PropertyKey, unknown> {
  return getEffectInternals(target).methodCache;
}

export function hasEffectState(value: unknown): value is EffectProxyTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    effectInternalsSymbol in (value as object)
  );
}

export function assertEffectState<TUpstream extends object>(
  value: object,
): asserts value is EffectProxyTarget<TUpstream> {
  if (!hasEffectState(value)) {
    throw new Error("Expected effect state to be attached");
  }
}

export function getEffectErrorMap(value: {
  "~effect"?: { effectErrorMap: EffectErrorMap };
  "~orpc": { errorMap: EffectErrorMap };
}): EffectErrorMap {
  return value["~effect"]?.effectErrorMap ?? value["~orpc"].errorMap;
}

export function unwrapEffectUpstream<T extends object>(value: T): T {
  return hasEffectState(value) ? (getEffectUpstream(value) as T) : value;
}
