import type { ClientContext } from '../../types'
import type { StandardLinkPlugin } from '../standard'
import type { LinkFetchClientOptions } from './link-fetch-client'
import { CompositeStandardLinkPlugin } from '../standard'

export interface LinkFetchPlugin<T extends ClientContext> extends StandardLinkPlugin<T> {
  initRuntimeAdapter?(options: LinkFetchClientOptions<T>): void
}

export class CompositeLinkFetchPlugin<T extends ClientContext, TPlugin extends LinkFetchPlugin<T>>
  extends CompositeStandardLinkPlugin<T, TPlugin> implements LinkFetchPlugin<T> {
  initRuntimeAdapter(options: LinkFetchClientOptions<T>): void {
    for (const plugin of this.plugins) {
      plugin.initRuntimeAdapter?.(options)
    }
  }
}
