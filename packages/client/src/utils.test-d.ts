import type { OnFinishState } from '@orpc/shared'
import type { ORPCError } from './error'
import type { Client, ClientContext, ClientPromiseResult } from './types'
import { isDefinedError } from './error'
import { consumeEventIterator, safe } from './utils'

describe('safe', async () => {
  const client = {} as Client<ClientContext, string, number, Error | ORPCError<'BAD_GATEWAY', { val: string }>>

  it('tuple style', async () => {
    const [error, data, isDefined, isSuccess] = await safe(client('123'))

    if (error || !isSuccess) {
      expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
      expectTypeOf(data).toEqualTypeOf<undefined>()
      expectTypeOf(isDefined).toEqualTypeOf<boolean>()

      if (isDefinedError(error)) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }

      if (isDefined) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }
      else {
        expectTypeOf(error).toEqualTypeOf<Error>()
      }
    }
    else {
      expectTypeOf(error).toEqualTypeOf<null>()
      expectTypeOf(data).toEqualTypeOf<number>()
      expectTypeOf(isDefined).toEqualTypeOf<false>()
    }
  })

  it('object style', async () => {
    const { error, data, isDefined, isSuccess } = await safe(client('123'))

    if (error || !isSuccess) {
      expectTypeOf(error).toEqualTypeOf<Error | ORPCError<'BAD_GATEWAY', { val: string }>>()
      expectTypeOf(data).toEqualTypeOf<undefined>()
      expectTypeOf(isDefined).toEqualTypeOf<boolean>()

      if (isDefinedError(error)) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }

      if (isDefined) {
        expectTypeOf(error).toEqualTypeOf<ORPCError<'BAD_GATEWAY', { val: string }>>()
      }
      else {
        expectTypeOf(error).toEqualTypeOf<Error>()
      }
    }
    else {
      expectTypeOf(error).toEqualTypeOf<null>()
      expectTypeOf(data).toEqualTypeOf<number>()
      expectTypeOf(isDefined).toEqualTypeOf<false>()
    }
  })

  it('can catch Promise', async () => {
    const { error, data } = await safe({} as Promise<number>)

    expectTypeOf(error).toEqualTypeOf<Error | null>()
    expectTypeOf(data).toEqualTypeOf<number | undefined>()
  })
})

describe('consumeEventIterator', () => {
  it('can infer types from ClientPromiseResult + AsyncGenerator', () => {
    void consumeEventIterator({} as ClientPromiseResult<AsyncGenerator<'message-value', 'done-value'>, 'error-value'>, {
      onEvent: (message) => {
        expectTypeOf(message).toEqualTypeOf<'message-value'>()
      },
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<'error-value'>()
      },
      onSuccess: (value) => {
        expectTypeOf(value).toEqualTypeOf<'done-value' | undefined>()
      },
      onFinish: (state) => {
        expectTypeOf(state).toEqualTypeOf<OnFinishState<'done-value' | undefined, 'error-value'>>()
      },
    })
  })

  it('can infer types from AsyncIterator', () => {
    void consumeEventIterator({} as AsyncIterator<'message-value', 'done-value'>, {
      onEvent: (message) => {
        expectTypeOf(message).toEqualTypeOf<'message-value'>()
      },
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<Error>()
      },
      onSuccess: (value) => {
        expectTypeOf(value).toEqualTypeOf<'done-value' | undefined>()
      },
      onFinish: (state) => {
        expectTypeOf(state).toEqualTypeOf<OnFinishState<'done-value' | undefined, Error>>()
      },
    })
  })
})
