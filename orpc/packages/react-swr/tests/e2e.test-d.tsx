import { isDefinedError } from '@orpc/client'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import useSWRMutation from 'swr/mutation'
import useSWRSubscription from 'swr/subscription'
import { orpc as client } from '../../client/tests/shared'
import { orpc, streamedOrpc } from './shared'

beforeEach(() => {
  vi.clearAllMocks()
})

it('.call', () => {
  expectTypeOf(orpc.ping.call).toEqualTypeOf(client.ping)
})

it('useSWR', async () => {
  const swr = useSWR(
    orpc.nested.ping.key({ input: { input: 123 } }),
    orpc.ping.fetcher(),
  )

  expectTypeOf(swr.data).toEqualTypeOf<{ output: string } | undefined>()

  if (swr.error && isDefinedError(swr.error) && swr.error.code === 'BASE') {
    // FIXME: this should be typed
    // expectTypeOf(swr.error.data).toEqualTypeOf<{ output: string }>()
  }

  // FIXME: this should error because invalid key
  useSWR(
    'invalid',
    orpc.ping.fetcher(),
  )
})

it('useSWRMutation', async () => {
  const mutation = useSWRMutation(
    orpc.nested.ping.key({ input: { input: 123 } }),
    orpc.ping.mutator(),
  )

  expectTypeOf<Parameters<typeof mutation.trigger>[0]>().toEqualTypeOf<{ input: number }>()
  expectTypeOf(mutation.data).toEqualTypeOf<{ output: string } | undefined>()

  if (mutation.error && isDefinedError(mutation.error) && mutation.error.code === 'BASE') {
    // FIXME: this should be typed
    // expectTypeOf(mutation.error.data).toEqualTypeOf<{ output: string }>()
  }
})

it('useSWRInfinite', async () => {
  const swr = useSWRInfinite(
    (index, previousPageData) => {
      // FIXME: this should be typed
      // expectTypeOf(previousPageData).toEqualTypeOf<{ output: string } | undefined>()

      return orpc.nested.ping.key({ input: { input: index + 1 } })
    },
    orpc.ping.fetcher(),
  )

  if (swr.error && isDefinedError(swr.error) && swr.error.code === 'BASE') {
    // FIXME: this should be typed
    // expectTypeOf(swr.error.data).toEqualTypeOf<{ output: string }>()
  }

  expectTypeOf(swr.data).toEqualTypeOf<Array<{ output: string }> | undefined>()
})

it('useSWRSubscription with subscriber', async () => {
  const subscription = useSWRSubscription(
    streamedOrpc.streamed.key({ input: { input: 3 } }),
    streamedOrpc.streamed.subscriber({ maxChunks: 2 }),
  )

  expectTypeOf(subscription.data).toEqualTypeOf<Array<{ output: string }> | undefined>()

  if (subscription.error && isDefinedError(subscription.error) && subscription.error.code === 'BASE') {
    expectTypeOf(subscription.error.data).toEqualTypeOf<{ output: string }>()
  }

  useSWRSubscription(
    'invalid',
    // @ts-expect-error: invalid key
    streamedOrpc.streamed.subscriber({ maxChunks: 2 }),
  )
})

it('useSWRSubscription with liveSubscriber', async () => {
  const subscription = useSWRSubscription(
    streamedOrpc.streamed.key({ input: { input: 3 } }),
    streamedOrpc.streamed.liveSubscriber(),
  )

  expectTypeOf(subscription.data).toEqualTypeOf<{ output: string } | undefined>()

  if (subscription.error && isDefinedError(subscription.error) && subscription.error.code === 'BASE') {
    expectTypeOf(subscription.error.data).toEqualTypeOf<{ output: string }>()
  }

  useSWRSubscription(
    'invalid',
    // @ts-expect-error: invalid key
    streamedOrpc.streamed.liveSubscriber(),
  )
})
