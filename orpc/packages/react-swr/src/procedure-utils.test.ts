import { createProcedureUtils } from './procedure-utils'
import { SWR_OPERATION_CONTEXT_SYMBOL } from './types'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createProcedureUtils', () => {
  const client = vi.fn()
  const utils = createProcedureUtils(client, { path: ['ping'] })

  it('.call', () => {
    expect(utils.call).toBe(client)
  })

  it('.key', () => {
    expect(utils.key()).toEqual([['ping'], { input: undefined }])
    expect(utils.key({ input: { search: '__search__' } })).toEqual([['ping'], { input: { search: '__search__' } }])
  })

  it('.fetcher', async () => {
    client.mockResolvedValueOnce('__output__')
    const fetcher = utils.fetcher({ context: { batch: true } })

    await expect(fetcher([['ping'], { input: { search: '__search__' } }])).resolves.toEqual('__output__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'fetcher' } } })
  })

  describe('.subscriber', async () => {
    it('on success', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        yield '__event__1'
        yield '__event__2'
        yield '__event__3'
      })
      const subscriber = utils.subscriber({ context: { batch: true }, maxChunks: 2 })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })

      expect(unsubscribe).toBeInstanceOf(Function)
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'subscriber' } }, signal: expect.any(AbortSignal) })

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(next).toHaveBeenCalledTimes(4)
      expect(next).toHaveBeenCalledWith(undefined, expect.any(Function))

      expect(next).toHaveBeenNthCalledWith(1, undefined, undefined) // reset mode
      expect(next.mock.calls[1]![1](undefined)).toEqual(['__event__1'])
      expect(next.mock.calls[2]![1](['1'])).toEqual(['1', '__event__2'])
      // exceeds maxChunks, so it should only return the last 2 events
      expect(next.mock.calls[3]![1](['1', '2'])).toEqual(['2', '__event__3'])
    })

    it('on success refetchMode=append', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        yield '__event__1'
        yield '__event__2'
        yield '__event__3'
      })
      const subscriber = utils.subscriber({ context: { batch: true }, maxChunks: 2, refetchMode: 'append' })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })

      expect(unsubscribe).toBeInstanceOf(Function)
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'subscriber' } }, signal: expect.any(AbortSignal) })

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(next).toHaveBeenCalledTimes(3)
      expect(next).toHaveBeenCalledWith(undefined, expect.any(Function))

      expect(next.mock.calls[0]![1](undefined)).toEqual(['__event__1'])
      expect(next.mock.calls[1]![1](['1'])).toEqual(['1', '__event__2'])
      // exceeds maxChunks, so it should only return the last 2 events
      expect(next.mock.calls[2]![1](['1', '2'])).toEqual(['2', '__event__3'])
    })

    it('on unsubscribe', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 100))
        yield '__event__1'
        yield '__event__2'
        yield '__event__3'
      })
      const subscriber = utils.subscriber({ context: { batch: true }, maxChunks: 2 })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })
      await new Promise(resolve => setTimeout(resolve, 10))
      unsubscribe()

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'subscriber' } }, signal: expect.any(AbortSignal) })
      expect(client.mock.calls[0]![1].signal.aborted).toBe(true)
    })

    it('on error while yielding', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('__error__')
      })
      const subscriber = utils.subscriber({ context: { batch: true }, maxChunks: 2 })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })

      expect(unsubscribe).toBeInstanceOf(Function)
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'subscriber' } }, signal: expect.any(AbortSignal) })

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(next).toHaveBeenCalledTimes(2)
      expect(next).toHaveBeenCalledWith(new Error('__error__'))
    })

    it('on error after unsubscribe', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('__error__')
      })
      const subscriber = utils.subscriber({ context: { batch: true }, maxChunks: 2 })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })
      unsubscribe()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(next).toHaveBeenCalledTimes(1)
    })

    it('on non-AsyncIteratorObject output', async () => {
      client.mockResolvedValueOnce('__output__')
      const subscriber = utils.subscriber({ context: { batch: true } })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(next).toHaveBeenCalledTimes(1)
      expect(next).toHaveBeenCalledWith(new Error('.subscriber requires an event iterator output'))
    })
  })

  describe('.liveSubscriber', async () => {
    it('on success', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 100))
        yield '__event__1'
        yield '__event__2'
        yield '__event__3'
      })
      const subscriber = utils.liveSubscriber({ context: { batch: true } })

      const next = vi.fn()
      const unsubscribe = await subscriber([['ping'], { input: { search: '__search__' } }], { next })

      expect(unsubscribe).toBeInstanceOf(Function)
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'liveSubscriber' } }, signal: expect.any(AbortSignal) })

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(next).toHaveBeenCalledTimes(3)
      expect(next).toHaveBeenNthCalledWith(1, undefined, '__event__1')
      expect(next).toHaveBeenNthCalledWith(2, undefined, '__event__2')
      expect(next).toHaveBeenNthCalledWith(3, undefined, '__event__3')
    })

    it('on unsubscribe', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        yield '__event__1'
        yield '__event__2'
        yield '__event__3'
      })
      const subscriber = utils.liveSubscriber({ context: { batch: true } })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })
      await new Promise(resolve => setTimeout(resolve, 20))
      unsubscribe()

      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'liveSubscriber' } }, signal: expect.any(AbortSignal) })
      expect(client.mock.calls[0]![1].signal.aborted).toBe(true)
    })

    it('on error while yielding', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('__error__')
      })
      const subscriber = utils.liveSubscriber({ context: { batch: true } })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })

      expect(unsubscribe).toBeInstanceOf(Function)
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'liveSubscriber' } }, signal: expect.any(AbortSignal) })

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(next).toHaveBeenCalledTimes(1)
      expect(next).toHaveBeenCalledWith(new Error('__error__'))
    })

    it('on error after unsubscribe', async () => {
      client.mockImplementationOnce(async function* () {
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('__error__')
      })
      const subscriber = utils.liveSubscriber({ context: { batch: true } })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })
      unsubscribe()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(next).toHaveBeenCalledTimes(0)
    })

    it('on non-AsyncIteratorObject output', async () => {
      client.mockResolvedValueOnce('__output__')
      const subscriber = utils.liveSubscriber({ context: { batch: true } })

      const next = vi.fn()
      const unsubscribe = subscriber([['ping'], { input: { search: '__search__' } }], { next })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(next).toHaveBeenCalledTimes(1)
      expect(next).toHaveBeenCalledWith(new Error('.liveSubscriber requires an event iterator output'))
    })
  })

  it('.mutator', async () => {
    client.mockResolvedValueOnce('__output__')
    const mutator = utils.mutator({ context: { batch: true } })

    await expect(mutator('key', { arg: { search: '__search__' } })).resolves.toEqual('__output__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toHaveBeenCalledWith({ search: '__search__' }, { context: { batch: true, [SWR_OPERATION_CONTEXT_SYMBOL]: { type: 'mutator' } } })
  })
})
