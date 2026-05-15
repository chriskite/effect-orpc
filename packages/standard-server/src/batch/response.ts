import type { Promisable } from '@orpc/shared'
import type { StandardHeaders, StandardResponse } from '../types'
import { AsyncIteratorClass, isAsyncIteratorObject, isObject } from '@orpc/shared'

export type BatchResponseMode = 'streaming' | 'buffered'

export interface BatchResponseBodyItem extends StandardResponse {
  index: number
}

export interface ToBatchResponseOptions extends StandardResponse {
  body: AsyncIteratorObject<BatchResponseBodyItem>

  /**
   * @default 'streaming'
   */
  mode?: BatchResponseMode
}

export function toBatchResponse(options: ToBatchResponseOptions): Promisable<StandardResponse> {
  const mode = options.mode ?? 'streaming'

  const minifyResponseItem = (item: BatchResponseBodyItem): Partial<BatchResponseBodyItem> => {
    return {
      index: item.index,
      status: item.status === options.status ? undefined : item.status,
      headers: Object.keys(item.headers).length ? item.headers : undefined,
      body: item.body,
    }
  }

  if (mode === 'buffered') {
    return (async () => {
      try {
        const body: Partial<BatchResponseBodyItem>[] = []

        for await (const item of options.body) {
          body.push(minifyResponseItem(item))
        }

        return {
          headers: options.headers,
          status: options.status,
          body,
        }
      }
      finally {
        await options.body.return?.()
      }
    })()
  }

  return {
    headers: options.headers,
    status: options.status,
    body: new AsyncIteratorClass(
      async () => {
        const { done, value } = await options.body.next()

        if (done) {
          return { done, value }
        }

        return {
          done,
          value: {
            index: value.index,
            status: value.status === options.status ? undefined : value.status,
            headers: Object.keys(value.headers).length ? value.headers : undefined,
            body: value.body,
          } satisfies Partial<BatchResponseBodyItem>,
        }
      },
      async (reason) => {
        if (reason !== 'next') {
          await options.body.return?.()
        }
      },
    ),
  }
}

export function parseBatchResponse(response: StandardResponse): AsyncGenerator<BatchResponseBodyItem> {
  const body = response.body

  if (isAsyncIteratorObject(body) || Array.isArray(body)) {
    const iterator = (async function* () {
      for await (const item of body) {
        if (!isObject(item) || !('index' in item) || typeof item.index !== 'number') {
          throw new TypeError('Invalid batch response', {
            cause: item,
          })
        }

        yield {
          index: item.index,
          status: item.status as undefined | number ?? response.status,
          headers: item.headers as undefined | StandardHeaders ?? {},
          body: item.body,
        } satisfies BatchResponseBodyItem
      }
    })()

    return new AsyncIteratorClass(
      () => iterator.next(),
      async (reason) => {
        if (reason !== 'next' && isAsyncIteratorObject(body)) {
          await body.return?.()
        }
      },
    )
  }

  throw new TypeError('Invalid batch response', {
    cause: response,
  })
}
