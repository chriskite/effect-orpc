import type { StandardLinkPlugin } from '../standard'
import type { LinkFetchPlugin } from './plugin'

describe('LinkFetchPlugin', () => {
  it('backward compatibility', () => {
    expectTypeOf<LinkFetchPlugin<{ a: string }>>().toExtend<StandardLinkPlugin<{ a: string }>>()
    expectTypeOf<StandardLinkPlugin<{ a: string }>>().toExtend<LinkFetchPlugin<{ a: string }>>()
  })
})
