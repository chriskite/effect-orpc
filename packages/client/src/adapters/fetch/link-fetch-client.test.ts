import type { StandardRequest } from '@orpc/standard-server'
import * as StandardServerFetch from '@orpc/standard-server-fetch'
import { LinkFetchClient } from './link-fetch-client'

const toFetchRequestSpy = vi.spyOn(StandardServerFetch, 'toFetchRequest')
const toStandardLazyResponseSpy = vi.spyOn(StandardServerFetch, 'toStandardLazyResponse')

describe('linkFetchClient', () => {
  it('call', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('body'))
    const interceptor1 = vi.fn(({ next }) => next())
    const interceptor2 = vi.fn(({ next }) => next())

    const linkOptions = {
      fetch,
      adapterInterceptors: [interceptor1, interceptor2],
    }

    const client = new LinkFetchClient(linkOptions)

    const standardRequest: StandardRequest = {
      url: new URL('http://localhost:300/example'),
      body: { body: true },
      headers: {
        'x-custom': 'value',
      },
      method: 'POST',
      signal: AbortSignal.timeout(100),
    }

    const options = {
      context: { context: true },
      lastEventId: 'last-event-id',
      signal: AbortSignal.timeout(100),
    }

    const response = await client.call(standardRequest, options, ['example'], { body: true })

    expect(toFetchRequestSpy).toBeCalledTimes(1)
    expect(toFetchRequestSpy).toBeCalledWith(standardRequest, linkOptions)

    expect(response).toBe(toStandardLazyResponseSpy.mock.results[0]!.value)
    expect(toStandardLazyResponseSpy).toBeCalledTimes(1)
    expect(toStandardLazyResponseSpy).toBeCalledWith(
      await fetch.mock.results[0]!.value,
      { signal: toFetchRequestSpy.mock.results[0]!.value.signal },
    )

    expect(fetch).toBeCalledTimes(1)
    expect(fetch).toBeCalledWith(
      toFetchRequestSpy.mock.results[0]!.value,
      { redirect: 'manual' },
      options,
      ['example'],
      { body: true },
    )

    expect(interceptor1).toBeCalledTimes(1)
    expect(interceptor2).toBeCalledTimes(1)
    expect(interceptor1).toBeCalledWith(expect.objectContaining({
      request: toFetchRequestSpy.mock.results[0]!.value,
      ...options,
      init: { redirect: 'manual' },
      input: { body: true },
      path: ['example'],
    }))
    expect(interceptor2).toBeCalledWith(expect.objectContaining({
      request: toFetchRequestSpy.mock.results[0]!.value,
      ...options,
      init: { redirect: 'manual' },
      input: { body: true },
      path: ['example'],
    }))
  })

  it('plugins', () => {
    const initRuntimeAdapter = vi.fn()
    const interceptor = vi.fn()

    const linkOptions = {
      plugins: [
        { initRuntimeAdapter },
      ],
      adapterInterceptors: [interceptor],
    }

    const link = new LinkFetchClient(linkOptions)

    expect(initRuntimeAdapter).toHaveBeenCalledOnce()
    expect(initRuntimeAdapter).toHaveBeenCalledWith(linkOptions)
  })
})
