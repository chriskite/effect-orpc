import type { FiberRefs } from "effect";

export interface FiberContextBridge {
  readonly getCurrentFiberRefs: () => FiberRefs.FiberRefs | undefined;
  readonly runWithFiberRefs: <T>(refs: FiberRefs.FiberRefs, fn: () => T) => T;
}

let bridge: FiberContextBridge | undefined;

export function installFiberContextBridge(
  nextBridge: FiberContextBridge | undefined,
): void {
  bridge = nextBridge;
}

export function getCurrentFiberRefs(): FiberRefs.FiberRefs | undefined {
  return bridge?.getCurrentFiberRefs();
}

/**
 * Run `fn` inside the bridge's request-scoped storage with the supplied
 * FiberRefs visible to nested handlers. When no bridge is installed (e.g.
 * a non-Node runtime that cannot import `effect-orpc/node`), the FiberRefs
 * are not propagated and `fn` is invoked directly.
 */
export function runWithFiberRefs<T>(refs: FiberRefs.FiberRefs, fn: () => T): T {
  if (bridge === undefined) {
    return fn();
  }
  return bridge.runWithFiberRefs(refs, fn);
}
