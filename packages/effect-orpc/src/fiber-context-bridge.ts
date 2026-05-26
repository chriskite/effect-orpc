import type { FiberRefs } from "effect";

export interface FiberContextBridge {
  readonly getCurrentFiberRefs: () => FiberRefs.FiberRefs | undefined;
  readonly runWithFiberRefs: <T>(refs: FiberRefs.FiberRefs, fn: () => T) => T;
}

let bridge: FiberContextBridge | undefined;
let missingBridgeWarned = false;

export function installFiberContextBridge(
  nextBridge: FiberContextBridge | undefined,
): void {
  if (bridge !== nextBridge) {
    // Bridge state changed; clear the dedupe flag so a subsequent
    // uninstall re-fires the warning instead of being permanently silenced
    // by an earlier process-lifetime warning.
    missingBridgeWarned = false;
  }
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

/**
 * Emit a one-time `console.warn` if `.useEffect()` middleware runs while no
 * fiber-context bridge is installed. Without the bridge, FiberRefs set in
 * the middleware (e.g. `Effect.annotateLogs` applied to `next()`) silently
 * fail to reach downstream `.effect()` handlers — see the README's
 * "Request-Scoped Fiber Context" section. The dedupe flag is reset whenever
 * `installFiberContextBridge` transitions to a different bridge value, so
 * uninstall/reinstall cycles in tests still surface the warning.
 */
export function warnIfMissingFiberContextBridge(): void {
  if (bridge !== undefined || missingBridgeWarned) return;
  missingBridgeWarned = true;
  console.warn(
    "[effect-orpc] `.useEffect()` middleware ran but no fiber-context bridge " +
      "is installed. FiberRefs set in the middleware (such as log annotations " +
      "from `Effect.annotateLogs` applied to `next()`) will not reach " +
      "downstream `.effect()` handlers. Import `@chriskite/effect-orpc/node` " +
      "once at startup to install the AsyncLocalStorage-backed bridge. See " +
      'the README\'s "Request-Scoped Fiber Context" section.',
  );
}
