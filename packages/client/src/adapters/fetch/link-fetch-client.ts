import type { Interceptor } from '@orpc/shared'
import type { StandardLazyResponse, StandardRequest } from '@orpc/standard-server'
import type { ToFetchRequestOptions } from '@orpc/standard-server-fetch'
import type { ClientContext, ClientOptions } from '../../types'
import type { StandardLinkClient } from '../standard'
import type { LinkFetchPlugin } from './plugin'
import { intercept, toArray } from '@orpc/shared'
import { toFetchRequest, toStandardLazyResponse } from '@orpc/standard-server-fetch'
import { CompositeLinkFetchPlugin } from './plugin'

export interface LinkFetchInterceptorOptions<T extends ClientContext> extends ClientOptions<T> {
  request: Request
  init: { redirect?: Request['redirect'] }
  path: readonly string[]
  input: unknown
}

export interface LinkFetchClientOptions<T extends ClientContext> extends ToFetchRequestOptions {
  fetch?: (
    request: Request,
    init: LinkFetchInterceptorOptions<T>['init'],
    options: ClientOptions<T>,
    path: readonly string[],
    input: unknown,
  ) => Promise<Response>

  adapterInterceptors?: Interceptor<LinkFetchInterceptorOptions<T>, Promise<Response>>[]

  plugins?: LinkFetchPlugin<T>[]
}

export class LinkFetchClient<T extends ClientContext> implements StandardLinkClient<T> {
  private readonly fetch: Exclude<LinkFetchClientOptions<T>['fetch'], undefined>
  private readonly toFetchRequestOptions: ToFetchRequestOptions
  private readonly adapterInterceptors: Exclude<LinkFetchClientOptions<T>['adapterInterceptors'], undefined>

  constructor(options: LinkFetchClientOptions<T>) {
    const plugin = new CompositeLinkFetchPlugin(options.plugins)

    plugin.initRuntimeAdapter(options)

    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.toFetchRequestOptions = options
    this.adapterInterceptors = toArray(options.adapterInterceptors)
  }

  async call(standardRequest: StandardRequest, options: ClientOptions<T>, path: readonly string[], input: unknown): Promise<StandardLazyResponse> {
    const request = toFetchRequest(standardRequest, this.toFetchRequestOptions)

    const fetchResponse = await intercept(
      this.adapterInterceptors,
      { ...options, request, path, input, init: { redirect: 'manual' } },
      ({ request, path, input, init, ...options }) => this.fetch(request, init, options, path, input),
    )

    const lazyResponse = toStandardLazyResponse(fetchResponse, { signal: request.signal })

    return lazyResponse
  }
}
