import { ORPCError } from './error'
import { consumeEventIterator, resolveFriendlyClientOptions, safe } from './utils'

it('safe', async () => {
  const r1 = await safe(Promise.resolve(1))
  expect([...r1]).toEqual([null, 1, false, true])
  expect({ ...r1 }).toEqual(expect.objectContaining({ error: null, data: 1, isDefined: false, isSuccess: true }))

  const e2 = new Error('error')
  const r2 = await safe(Promise.reject(e2))
  expect([...r2]).toEqual([e2, undefined, false, false])
  expect({ ...r2 }).toEqual(expect.objectContaining({ error: e2, data: undefined, isDefined: false, isSuccess: false }))

  const e3 = new ORPCError('BAD_GATEWAY', { defined: true })
  const r3 = await safe(Promise.reject(e3))
  expect([...r3]).toEqual([e3, undefined, true, false])
  expect({ ...r3 }).toEqual(expect.objectContaining({ error: e3, data: undefined, isDefined: true, isSuccess: false }))

  const e4 = new ORPCError('BAD_GATEWAY')
  const r4 = await safe(Promise.reject(e4))
  expect([...r4]).toEqual([e4, undefined, false, false])
  expect({ ...r4 }).toEqual(expect.objectContaining({ error: e4, data: undefined, isDefined: false, isSuccess: false }))
})

it('resolveFriendlyClientOptions', () => {
  expect(resolveFriendlyClientOptions({})).toEqual({ context: {} })
  expect(resolveFriendlyClientOptions({ context: { a: 1 } })).toEqual({ context: { a: 1 } })
  expect(resolveFriendlyClientOptions({ lastEventId: '123' })).toEqual({ context: {}, lastEventId: '123' })
})

describe('consumeEventIterator', () => {
  it('on success', async () => {
    const iterator = (async function* () {
      yield 1
      yield 2
      return 3
    }())

    const onEvent = vi.fn()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const onFinish = vi.fn()

    const unsubscribe = consumeEventIterator(iterator, {
      onEvent,
      onError,
      onSuccess,
      onFinish,
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(2)
      expect(onEvent).toHaveBeenNthCalledWith(1, 1)
      expect(onEvent).toHaveBeenNthCalledWith(2, 2)

      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenNthCalledWith(1, 3)
      expect(onFinish).toHaveBeenCalledTimes(1)
      expect(onFinish).toHaveBeenNthCalledWith(1, [null, 3, true])

      expect(onError).toHaveBeenCalledTimes(0)
    })
  })

  it('on error', async () => {
    const error = new Error('TEST')
    const iterator = (async function* () {
      yield 1
      yield 2
      throw error
    }())

    const onEvent = vi.fn()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const onFinish = vi.fn()

    const unsubscribe = consumeEventIterator(iterator, {
      onEvent,
      onError,
      onSuccess,
      onFinish,
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(2)
      expect(onEvent).toHaveBeenNthCalledWith(1, 1)
      expect(onEvent).toHaveBeenNthCalledWith(2, 2)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenNthCalledWith(1, error)

      expect(onFinish).toHaveBeenCalledTimes(1)
      expect(onFinish).toHaveBeenNthCalledWith(1, [error, undefined, false])

      expect(onSuccess).toHaveBeenCalledTimes(0)
    })
  })

  it('on error without onError and onFinish', async () => {
    const unhandledRejectionHandler = vi.fn()
    process.on('unhandledRejection', unhandledRejectionHandler)

    afterEach(() => {
      process.off('unhandledRejection', unhandledRejectionHandler)
    })

    const error = new Error('TEST')
    const iterator = (async function* () {
      yield 1
      yield 2
      throw error
    }())

    const onEvent = vi.fn()

    const unsubscribe = consumeEventIterator(iterator, {
      onEvent,
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(2)
      expect(onEvent).toHaveBeenNthCalledWith(1, 1)
      expect(onEvent).toHaveBeenNthCalledWith(2, 2)
    })

    expect(unhandledRejectionHandler).toHaveBeenCalledTimes(1)
    expect(unhandledRejectionHandler).toHaveBeenNthCalledWith(1, error, expect.anything())
  })

  it('unsubscribe', async () => {
    let cleanup = false
    const iterator = (async function* () {
      try {
        await new Promise(resolve => setTimeout(resolve, 25))
        yield 1
        yield 2
        return 3
      }
      finally {
        cleanup = true
      }
    }())

    const onEvent = vi.fn()
    const onSuccess = vi.fn()
    const onFinish = vi.fn()
    const onError = vi.fn()

    const unsubscribe = consumeEventIterator(iterator, {
      onEvent,
      onError,
      onSuccess,
      onFinish,
    })

    await new Promise(resolve => setTimeout(resolve, 1))
    await unsubscribe()
    expect(cleanup).toBe(true)
    // side-effect of async generator - waiting for .next resolve before .return effect
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenNthCalledWith(1, 1)

    expect(onError).toHaveBeenCalledTimes(0)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onFinish).toHaveBeenCalledTimes(1)
    // undefined can be passed on success because iterator can be canceled
    expect(onSuccess).toHaveBeenNthCalledWith(1, undefined)
    expect(onFinish).toHaveBeenNthCalledWith(1, [null, undefined, true])
  })

  it('error on unsubscribe', async () => {
    const error = new Error('TEST')
    let cleanup = false
    const iterator = (async function* () {
      try {
        await new Promise(resolve => setTimeout(resolve, 25))
        yield 1
        yield 2
        return 3
      }
      finally {
        cleanup = true
        // eslint-disable-next-line no-unsafe-finally
        throw error
      }
    }())

    const onEvent = vi.fn()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const onFinish = vi.fn()

    const unsubscribe = consumeEventIterator(iterator, {
      onEvent,
      onError,
      onSuccess,
      onFinish,
    })

    await new Promise(resolve => setTimeout(resolve, 1))
    await expect(unsubscribe()).rejects.toThrow(error)
    expect(cleanup).toBe(true)
    // side-effect of async generator - waiting for .next resolve before .return effect
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenNthCalledWith(1, 1)

    expect(onError).toHaveBeenCalledTimes(0)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onFinish).toHaveBeenCalledTimes(1)
    // undefined can be passed on success because iterator can be canceled
    expect(onSuccess).toHaveBeenNthCalledWith(1, undefined)
    expect(onFinish).toHaveBeenNthCalledWith(1, [null, undefined, true])
  })

  it('on iterator promise rejection', async () => {
    const error = new Error('TEST')
    const iterator = Promise.reject(error)

    const onEvent = vi.fn()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const onFinish = vi.fn()

    void consumeEventIterator(iterator, {
      onEvent,
      onError,
      onSuccess,
      onFinish,
    })

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledTimes(0)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenNthCalledWith(1, error)

      expect(onFinish).toHaveBeenCalledTimes(1)
      expect(onFinish).toHaveBeenNthCalledWith(1, [error, undefined, false])

      expect(onSuccess).toHaveBeenCalledTimes(0)
    })
  })
})
