import * as Key from '@orpc/tanstack-query'
import { skipToken } from '@tanstack/vue-query'
import { computed, ref } from 'vue'
import { queryClient } from '../tests/shared'
import { createProcedureUtils } from './procedure-utils'

vi.mock('@tanstack/vue-query', async (origin) => {
  const original = await origin() as any

  return {
    ...original,
    experimental_streamedQuery: vi.fn(original.experimental_streamedQuery),
  }
})

const generateOperationKeySpy = vi.spyOn(Key, 'generateOperationKey')

beforeEach(() => {
  queryClient.clear()
  vi.clearAllMocks()
})

describe('createProcedureUtils', () => {
  const controller = new AbortController()
  const signal = controller.signal
  const client = vi.fn().mockResolvedValue('__output__')
  const utils = createProcedureUtils(client, { path: ['ping'] })

  it('.call', () => {
    expect(utils.call).toBe(client)
  })

  describe('.queryOptions', async () => {
    it('without skipToken', async () => {
      const options = utils.queryOptions({ input: computed(() => ({ search: ref('__search__') })), context: { batch: '__batch__' } })

      expect(options.enabled.value).toBe(undefined)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: { search: '__search__' } })

      await expect(options.queryFn!({ signal } as any)).resolves.toEqual('__output__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, { signal, context: { batch: '__batch__' } })
    })

    it('with skipToken', async () => {
      const options = utils.queryOptions({ input: skipToken, context: { batch: '__batch__' } })

      expect(options.enabled.value).toBe(false)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: skipToken })

      expect(() => options.queryFn!({ signal } as any)).toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)
    })

    it('with ref', async () => {
      const input = ref<any>(skipToken)

      const options = utils.queryOptions({ input, context: { batch: '__batch__' } })

      expect(options.enabled.value).toBe(false)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'query', input: skipToken })

      expect(() => options.queryFn!({ signal } as any)).toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)

      input.value = computed(() => ({ search: ref('__search__') }))

      expect(options.enabled.value).toBe(undefined)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[1]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(2)
      expect(generateOperationKeySpy).toHaveBeenNthCalledWith(2, ['ping'], { type: 'query', input: { search: '__search__' } })

      await expect(options.queryFn!({ signal } as any)).resolves.toEqual('__output__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__' }, { signal, context: { batch: '__batch__' } })
    })
  })

  describe('.infiniteOptions', () => {
    it('without skipToken', async () => {
      const getNextPageParam = vi.fn()

      const options = utils.infiniteOptions({
        input: pageParam => (computed(() => ({ search: '__search__', pageParam }))),
        context: { batch: '__batch__' },
        getNextPageParam,
        initialPageParam: '__initialPageParam__',
      })

      expect(options.enabled.value).toBe(undefined)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'infinite', input: { search: '__search__', pageParam: '__initialPageParam__' } })

      expect(options.initialPageParam).toEqual('__initialPageParam__')
      expect(options.getNextPageParam).toBe(getNextPageParam)

      await expect(options.queryFn!({ signal, pageParam: '__pageParam__' } as any)).resolves.toEqual('__output__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__', pageParam: '__pageParam__' }, { signal, context: { batch: '__batch__' } })
    })

    it('with skipToken', async () => {
      const getNextPageParam = vi.fn()

      const options = utils.infiniteOptions({
        input: skipToken,
        context: { batch: '__batch__' },
        getNextPageParam,
        initialPageParam: '__initialPageParam__',
      })

      expect(options.enabled.value).toBe(false)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'infinite', input: skipToken })

      expect(options.initialPageParam).toEqual('__initialPageParam__')
      expect(options.getNextPageParam).toBe(getNextPageParam)

      expect(() => options.queryFn!({ signal, pageParam: '__pageParam__' } as any)).toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)
    })

    it('with ref', async () => {
      const getNextPageParam = vi.fn()
      const input = ref<any>(skipToken)

      const options = utils.infiniteOptions({
        input,
        context: { batch: '__batch__' },
        getNextPageParam,
        initialPageParam: '__initialPageParam__',
      })

      expect(options.enabled.value).toBe(false)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[0]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
      expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'infinite', input: skipToken })

      expect(options.initialPageParam).toEqual('__initialPageParam__')
      expect(options.getNextPageParam).toBe(getNextPageParam)

      expect(() => options.queryFn!({ signal, pageParam: '__pageParam__' } as any)).toThrow('queryFn should not be called with skipToken used as input')
      expect(client).toHaveBeenCalledTimes(0)

      input.value = (pageParam: any) => (computed(() => ({ search: '__search__', pageParam })))

      expect(options.enabled.value).toBe(undefined)

      expect(options.queryKey.value).toBe(generateOperationKeySpy.mock.results[1]!.value)
      expect(generateOperationKeySpy).toHaveBeenCalledTimes(2)
      expect(generateOperationKeySpy).toHaveBeenNthCalledWith(2, ['ping'], { type: 'infinite', input: { search: '__search__', pageParam: '__initialPageParam__' } })

      await expect(options.queryFn!({ signal, pageParam: '__pageParam__' } as any)).resolves.toEqual('__output__')
      expect(client).toHaveBeenCalledTimes(1)
      expect(client).toBeCalledWith({ search: '__search__', pageParam: '__pageParam__' }, { signal, context: { batch: '__batch__' } })
    })
  })

  it('.mutationOptions', async () => {
    const options = utils.mutationOptions({
      context: { batch: '__batch__' },
    })

    expect(options.mutationKey).toBe(generateOperationKeySpy.mock.results[0]!.value)
    expect(generateOperationKeySpy).toHaveBeenCalledTimes(1)
    expect(generateOperationKeySpy).toHaveBeenCalledWith(['ping'], { type: 'mutation' })

    await expect((options as any).mutationFn('__input__')).resolves.toEqual('__output__')
    expect(client).toHaveBeenCalledTimes(1)
    expect(client).toBeCalledWith('__input__', { context: { batch: '__batch__' } })
  })
})
