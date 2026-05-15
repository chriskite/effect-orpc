import type { LinkFetchPlugin } from './plugin'
import { CompositeLinkFetchPlugin } from './plugin'

describe('compositeLinkFetchPlugin', () => {
  it('forward initRuntimeAdapter and sort plugins', () => {
    const plugin1 = {
      initRuntimeAdapter: vi.fn(),
      order: 1,
    } satisfies LinkFetchPlugin<any>
    const plugin2 = {
      initRuntimeAdapter: vi.fn(),
    } satisfies LinkFetchPlugin<any>
    const plugin3 = {
      initRuntimeAdapter: vi.fn(),
      order: -1,
    } satisfies LinkFetchPlugin<any>

    const compositePlugin = new CompositeLinkFetchPlugin([plugin1, plugin2, plugin3])

    const interceptor = vi.fn()

    const options = { adapterInterceptors: [interceptor] }

    compositePlugin.initRuntimeAdapter(options)

    expect(plugin1.initRuntimeAdapter).toHaveBeenCalledOnce()
    expect(plugin2.initRuntimeAdapter).toHaveBeenCalledOnce()
    expect(plugin3.initRuntimeAdapter).toHaveBeenCalledOnce()

    expect(plugin1.initRuntimeAdapter.mock.calls[0]![0]).toBe(options)
    expect(plugin2.initRuntimeAdapter.mock.calls[0]![0]).toBe(options)
    expect(plugin3.initRuntimeAdapter.mock.calls[0]![0]).toBe(options)

    expect(plugin3.initRuntimeAdapter).toHaveBeenCalledBefore(plugin2.initRuntimeAdapter)
    expect(plugin2.initRuntimeAdapter).toHaveBeenCalledBefore(plugin1.initRuntimeAdapter)
  })
})
