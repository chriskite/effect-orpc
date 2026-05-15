import { createGeneralUtils } from './general-utils'

describe('createGeneralUtils', () => {
  const utils = createGeneralUtils(['test', 'path'])

  describe('.matcher', () => {
    it('strategy=partial', () => {
      expect(utils.matcher()([['test', 'path'], { input: { value1: 'test' } }])).toBe(true)
      expect(utils.matcher()([['test', 'path'], { input: undefined }])).toBe(true)
      expect(utils.matcher()([['invalid'], { input: { value1: 'test' } }])).toBe(false)

      expect(utils.matcher({ input: { value1: true } })([['test', 'path'], { input: { value1: true, value2: true } }])).toBe(true)
      expect(utils.matcher({ input: { value1: true } })([['test', 'path'], { input: { value1: false, value2: true } }])).toBe(false)
    })

    it('strategy=exact', () => {
      expect(utils.matcher({ strategy: 'exact', input: { value1: 'test' } })([['test', 'path'], { input: { value1: 'test' } }])).toBe(true)
      expect(utils.matcher({ strategy: 'exact' })([['test', 'path'], { input: { value1: 'test' } }])).toBe(false)
      expect(utils.matcher({ strategy: 'exact', input: { value1: 'test' } })([['invalid'], { input: { value1: 'test' } }])).toBe(false)
    })
  })
})
