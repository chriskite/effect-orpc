import type { ORPCErrorCode, ORPCErrorOptions } from '@orpc/client'
import type { ErrorMap, ErrorMapItem, InferSchemaInput } from '@orpc/contract'
import type { MaybeOptionalOptions } from '@orpc/shared'
import { ORPCError } from '@orpc/client'
import { resolveMaybeOptionalOptions } from '@orpc/shared'

export type ORPCErrorConstructorMapItemOptions<TData> = Omit<ORPCErrorOptions<TData>, 'defined' | 'status'>

export type ORPCErrorConstructorMapItem<TCode extends ORPCErrorCode, TInData>
  = (...rest: MaybeOptionalOptions<ORPCErrorConstructorMapItemOptions<TInData>>) => ORPCError<TCode, TInData>

export type ORPCErrorConstructorMap<T extends ErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<infer UInputSchema>
      ? ORPCErrorConstructorMapItem<K, InferSchemaInput<UInputSchema>>
      : never
    : never
}

export function createORPCErrorConstructorMap<T extends ErrorMap>(errors: T): ORPCErrorConstructorMap<T> {
  /**
   * Must use proxy to make sure any arbitrary access can be handled.
   */
  const proxy = new Proxy(errors, {
    get(target, code) {
      if (typeof code !== 'string') {
        return Reflect.get(target, code)
      }

      const item: ORPCErrorConstructorMapItem<string, unknown> = (...rest) => {
        const options = resolveMaybeOptionalOptions(rest)
        const config = errors[code]

        return new ORPCError(code, {
          defined: Boolean(config),
          status: config?.status,
          message: options.message ?? config?.message,
          data: options.data,
          cause: options.cause,
        })
      }

      return item
    },
  })

  return proxy as any
}
