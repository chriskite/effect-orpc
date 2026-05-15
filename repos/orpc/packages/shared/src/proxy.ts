import type { AnyFunction } from './function'
import type { Value } from './value'
import { value } from './value'

/**
 * Prevents objects from being awaitable by intercepting the `then` method
 * when called by the native await mechanism. This is useful for preventing
 * accidental awaiting of objects that aren't meant to be promises.
 */
export function preventNativeAwait<T extends object>(target: T): T {
  return new Proxy(target, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (prop !== 'then' || typeof value !== 'function') {
        return value
      }

      return new Proxy(value, {
        apply(targetFn, thisArg, args) {
          /**
           * Do nothing if .then not triggered by `await`
           */
          if (args.length !== 2 || args.some(arg => !isNativeFunction(arg))) {
            return Reflect.apply(targetFn, thisArg, args)
          }

          let shouldOmit = true
          args[0].call(thisArg, preventNativeAwait(new Proxy(target, {
            get: (target, prop, receiver) => {
              /**
               * Only omit `then` once, in `await` resolution, afterwards it should become normal
               */
              if (shouldOmit && prop === 'then') {
                shouldOmit = false
                return undefined
              }

              return Reflect.get(target, prop, receiver)
            },
          })))
        },
      })
    },
  })
}

const NATIVE_FUNCTION_REGEX = /^\s*function\s*\(\)\s*\{\s*\[native code\]\s*\}\s*$/
function isNativeFunction(fn: unknown): fn is AnyFunction {
  return typeof fn === 'function' && NATIVE_FUNCTION_REGEX.test(fn.toString())
}

/**
 * Create a proxy that overlays one object (`overlay`) on top of another (`target`).
 *
 * - Properties from `overlay` take precedence.
 * - Properties not in `overlay` fall back to `target`.
 * - Methods from either object are bound to `overlay` so `this` is consistent.
 *
 * Useful when you want to override or extend behavior without fully copying/merging objects.
 */
export function overlayProxy<T extends object, U extends object>(
  target: Value<T>,
  partial: U,
): U & Omit<T, keyof U> {
  const proxy = new Proxy(typeof target === 'function' ? partial : target, {
    get(_, prop) {
      const targetValue = prop in partial
        ? partial
        : value(target)

      const v = Reflect.get(targetValue, prop)
      return typeof v === 'function'
        ? v.bind(targetValue) // .bind is required for async generator or iterator
        : v
    },
    has(_, prop) {
      return Reflect.has(partial, prop) || Reflect.has(value(target), prop)
    },
  })

  return proxy as any
}
