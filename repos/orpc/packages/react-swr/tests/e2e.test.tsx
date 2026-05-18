import { act, renderHook } from '@testing-library/react'
import useSWR, { mutate } from 'swr'
import useSWRInfinite from 'swr/infinite'
import useSWRMutation from 'swr/mutation'
import useSWRSubscription from 'swr/subscription'
import { orpc, streamedOrpc } from './shared'

beforeEach(async () => {
  vi.clearAllMocks()
  // Clear SWR's global cache to avoid carrying data between tests
  await mutate(() => true, undefined, { revalidate: false })
})

it('case: useSWR & mutate & useSWRMutation', async () => {
  const fetcher = vi.fn(orpc.ping.fetcher())

  const { result } = renderHook(() => {
    const swr = useSWR(
      orpc.nested.ping.key({ input: { input: 123 } }),
      fetcher,
    )
    const mutation = useSWRMutation(
      orpc.nested.ping.key({ input: { input: 123 } }),
      orpc.nested.pong.mutator(),
    )

    return { swr, mutation }
  })

  expect(result.current.swr.isLoading).toBe(true)

  await act(async () => {
    await vi.waitFor(() => expect(result.current.swr.data).toEqual({ output: '123' }))
  })
  expect(fetcher).toHaveBeenCalledTimes(1)

  await act(async () => {
    await result.current.mutation.trigger({ input: { input: 456 } })
  })
  expect(fetcher).toHaveBeenCalledTimes(2)

  await act(async () => {
    await mutate(orpc.matcher())
  })
  expect(fetcher).toHaveBeenCalledTimes(3)

  await act(async () => {
    await mutate(orpc.nested.ping.matcher({ input: { input: 123 }, strategy: 'exact' }))
  })
  expect(fetcher).toHaveBeenCalledTimes(4)

  await act(async () => {
    await mutate(orpc.nested.pong.matcher())
  })
  // not matched - no invalidate happens
  expect(fetcher).toHaveBeenCalledTimes(4)
})

it('case: useSWRInfinite', async () => {
  const { result } = renderHook(() => {
    const swr = useSWRInfinite(
      index => orpc.nested.ping.key({ input: { input: index + 1 } }),
      orpc.ping.fetcher(),
    )

    return { swr }
  })

  expect(result.current.swr.isLoading).toBe(true)

  await act(async () => {
    await vi.waitFor(() => expect(result.current.swr.data).toEqual([{ output: '1' }]))
    result.current.swr.setSize(2)
  })

  await act(async () => {
    await vi.waitFor(() => expect(result.current.swr.data).toEqual([{ output: '1' }, { output: '2' }]))
    result.current.swr.setSize(3)
  })

  await act(async () => {
    await vi.waitFor(() => expect(result.current.swr.data).toEqual([{ output: '1' }, { output: '2' }, { output: '3' }]))
    result.current.swr.setSize(3)
  })
})

it('case: useSubscription & .subscriber', async () => {
  const { result } = renderHook(() => {
    const subscription = useSWRSubscription(
      streamedOrpc.streamed.key({ input: { input: 3 } }),
      streamedOrpc.streamed.subscriber({ maxChunks: 2 }),
    )

    return { subscription }
  })

  expect(result.current.subscription.data).toBeUndefined()

  await act(async () => {
    await vi.waitFor(() => expect(result.current.subscription.data).toEqual([{ output: '1' }, { output: '2' }]))
  })
})

it('case: useSubscription & .liveSubscriber', async () => {
  const { result } = renderHook(() => {
    const subscription = useSWRSubscription(
      streamedOrpc.streamed.key({ input: { input: 4 } }),
      streamedOrpc.streamed.liveSubscriber(),
    )

    return { subscription }
  })

  expect(result.current.subscription.data).toBeUndefined()

  await act(async () => {
    await vi.waitFor(() => expect(result.current.subscription.data).toEqual({ output: '3' }))
  })
})
