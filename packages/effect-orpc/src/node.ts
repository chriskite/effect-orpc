import { AsyncLocalStorage } from "node:async_hooks";

import type { FiberRefs } from "effect";
import { Effect } from "effect";

import {
  installFiberContextBridge,
  type FiberContextBridge,
} from "./fiber-context-bridge";

const fiberRefsStorage = new AsyncLocalStorage<FiberRefs.FiberRefs>();

const bridge: FiberContextBridge = {
  getCurrentFiberRefs: () => fiberRefsStorage.getStore(),
  runWithFiberRefs: <T>(refs: FiberRefs.FiberRefs, fn: () => T) =>
    fiberRefsStorage.run(refs, fn),
};

installFiberContextBridge(bridge);

/**
 * Capture the current Effect FiberRefs and run `fn` inside an
 * AsyncLocalStorage scope so effect-orpc procedure handlers dispatched during
 * `fn` inherit them via `Effect.inheritFiberRefs`.
 *
 * **Runtime requirements.** Requires `node:async_hooks`. Supported on
 * Node ≥ 18 and Bun ≥ 1.2. On runtimes without `async_hooks` (Cloudflare
 * Workers, browser, some Deno configurations), importing this entrypoint
 * fails and the bridge is never installed. The library does not surface a
 * runtime error — handlers simply do not see captured FiberRefs. See the
 * "Runtime requirements" section of the README.
 *
 * **Interruption caveat.** `Effect.promise` does not propagate Effect
 * interruption to the underlying Promise. This is safe today because `fn` is
 * a framework continuation (e.g. `next()` from Hono) that completes when the
 * HTTP response is sent. If you pass a long-running async function here,
 * interrupting the outer Effect will not cancel it; reach for `Effect.async`
 * with an explicit abort callback instead.
 */
export function withFiberContext<T>(fn: () => Promise<T>): Effect.Effect<T> {
  return Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
    Effect.promise(() => fiberRefsStorage.run(fiberRefs, fn)),
  );
}
