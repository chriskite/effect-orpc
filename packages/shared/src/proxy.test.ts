import { overlayProxy, preventNativeAwait } from './proxy'

describe('preventNativeAwait', () => {
  it('should work normally if not awaited', () => {
    const obj = { value: 42 }
    const proxy = preventNativeAwait(obj)
    expect(proxy).toEqual(obj)

    const obj2 = { then: 323, catch: 123 }
    const proxy2 = preventNativeAwait(obj2)
    expect(proxy2).toEqual(obj2)

    const obj3 = { then: (...args: any[]) => ({ args }), catch: (...args: any[]) => ({ args }) }
    const proxy3 = preventNativeAwait(obj3)
    expect(proxy3.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
    expect(proxy3.catch(4, 5, 6)).toEqual({ args: [4, 5, 6] })
  })

  it('returns itself if awaited', async () => {
    const obj = { value: 42 }
    const proxy = preventNativeAwait(obj)
    expect(await proxy).toEqual(obj)

    const obj2 = { then: 323, catch: 123 }
    const proxy2 = preventNativeAwait(obj2)
    expect(await proxy2).toEqual(obj2)
    expect(await proxy2).toEqual(obj2)

    const obj3 = { then: (...args: any[]) => ({ args }), catch: (...args: any[]) => ({ args }) }
    const proxy3 = preventNativeAwait(obj3)
    const result3 = await (proxy3 as any)
    expect(result3.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
    expect(result3.catch(3, 4, 5)).toEqual({ args: [3, 4, 5] })
  })

  it('returns itself if multiple awaited times', async () => {
    const obj = { value: 42 }
    const proxy = preventNativeAwait(obj)
    const result = await (proxy as any)
    expect(result).toEqual(obj)
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(await proxy).toEqual(obj)

    const obj2 = { then: 323, catch: 123 }
    const proxy2 = preventNativeAwait(obj2)
    const result2 = await (proxy2 as any)
    expect(result2).toEqual(obj2)
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(await proxy2).toEqual(obj2)

    const obj3 = { then: (...args: any[]) => ({ args }), catch: (...args: any[]) => ({ args }) }
    const proxy3 = preventNativeAwait(obj3)
    const result3 = await (proxy3 as any)
    expect(result3.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
    expect(result3.catch(4, 5, 6)).toEqual({ args: [4, 5, 6] })
    await new Promise(resolve => setTimeout(resolve, 1))
    const result3_2 = await (proxy3 as any)
    expect(result3_2.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
    expect(result3_2.catch(4, 5, 6)).toEqual({ args: [4, 5, 6] })
  })

  it('returns itself if nested awaited times', async () => {
    const obj = { value: 42 }
    const proxy = preventNativeAwait(obj)
    const result = await (proxy as any)
    expect(result).toEqual(obj)
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(await result).toEqual(obj)

    const obj2 = { then: 323, catch: 123 }
    const proxy2 = preventNativeAwait(obj2)
    const result2 = await (proxy2 as any)
    expect(result2).toEqual(obj2)
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(await result2).toEqual(obj2)

    const obj3 = { then: (...args: any[]) => ({ args }), catch: (...args: any[]) => ({ args }) }
    const proxy3 = preventNativeAwait(obj3)
    const result3 = await (proxy3 as any)
    expect(result3.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
    expect(result3.catch(4, 5, 6)).toEqual({ args: [4, 5, 6] })
    await new Promise(resolve => setTimeout(resolve, 1))
    const result3_2 = await (result3 as any)
    expect(result3_2.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
    expect(result3_2.catch(4, 5, 6)).toEqual({ args: [4, 5, 6] })
  })

  it('resolves via Promise.resolve without triggering thenable assimilation', async () => {
    const obj = { value: 42 }
    const proxy = preventNativeAwait(obj)
    await expect(Promise.resolve(proxy)).resolves.toEqual(obj)

    const obj2 = { then: 123 }
    const proxy2 = preventNativeAwait(obj2)
    await expect(Promise.resolve(proxy2)).resolves.toEqual(obj2)

    const obj3 = { then: (...args: any[]) => ({ args }) }
    const proxy3 = preventNativeAwait(obj3)
    const resolved = await Promise.resolve(proxy3 as any)
    expect(resolved.then(1, 2, 3)).toEqual({ args: [1, 2, 3] })
  })
})

describe('overlayProxy', () => {
  it('should combine properties from both target and overlay (overlay takes precedence)', () => {
    const target = { a: 1, b: 2, c: 3 }
    const overlay = { a: 10, d: 40 }
    const proxy = overlayProxy(target, overlay)

    expect(proxy.a).toBe(10) // from overlay (overridden)
    expect(proxy.b).toBe(2) // from target
    expect(proxy.c).toBe(3) // from target
    expect(proxy.d).toBe(40) // from overlay

    expect('a' in proxy).toBe(true)
    expect('b' in proxy).toBe(true)
    expect('c' in proxy).toBe(true)
    expect('d' in proxy).toBe(true)
    expect('not_exists' in proxy).toBe(false)

    expect(Object.keys(proxy)).toEqual(['a', 'b', 'c'])
    expect(Object.getPrototypeOf(proxy)).toBe(Object.getPrototypeOf(target))
  })

  it('should handle method overriding correctly', () => {
    const target = {
      name: 'target',
      getName1() { return `target: ${this.name}` },
      getName2() { return `target: ${this.name}` },
    }
    const overlay = {
      name: 'overlay',
      getName2() { return `overlay: ${this.name}` },
    }
    const proxy = overlayProxy(target, overlay)

    expect(proxy.getName1()).toBe('target: target')
    expect(proxy.getName2()).toBe('overlay: overlay')
  })

  describe('lazy target', () => {
    it('should combine properties from both target and overlay (overlay takes precedence)', () => {
      const target = vi.fn(() => ({ a: 1, b: 2, c: 3 }))
      const overlay = { a: 10, d: 40 }
      const proxy = overlayProxy(target, overlay)

      expect(proxy.a).toBe(10) // from overlay (overridden)
      expect(proxy.b).toBe(2) // from target
      expect(proxy.c).toBe(3) // from target
      expect(proxy.d).toBe(40) // from overlay

      expect('a' in proxy).toBe(true)
      expect('b' in proxy).toBe(true)
      expect('c' in proxy).toBe(true)
      expect('d' in proxy).toBe(true)
      expect('not_exists' in proxy).toBe(false)

      expect(target).toHaveBeenCalledTimes(5)
      target.mockReturnValue({ e: 50 } as any)

      expect(proxy.a).toBe(10) // from overlay (overridden)
      expect((proxy as any).e).toBe(50) // from target
      expect('b' in proxy).toBe(false)
      expect('c' in proxy).toBe(false)
    })

    it('should handle method overriding correctly', () => {
      const target = vi.fn(() => ({
        name: 'target',
        getName1() { return `target: ${this.name}` },
        getName2() { return `target: ${this.name}` },
      }))
      const overlay = {
        name: 'overlay',
        getName2() { return `overlay: ${this.name}` },
      }
      const proxy = overlayProxy(target, overlay)

      expect(proxy.getName1()).toBe('target: target')
      expect(proxy.getName2()).toBe('overlay: overlay')

      expect(target).toHaveBeenCalledTimes(1)
      target.mockReturnValue({
        name: 'target2',
        getName1() { return `target: ${this.name}` },
        getName2() { return `target: ${this.name}` },
      })

      expect(proxy.getName1()).toBe('target: target2')
      expect(proxy.getName2()).toBe('overlay: overlay')
    })
  })

  it('usable for async generator', async () => {
    const target = (async function* () {
      yield 1
      yield 2
    }())

    ;(target as any)[Symbol.for('TEST')] = true

    const proxy = overlayProxy(target, (async function* () {
      yield 3
      yield 4
    }()))

    expect((proxy as any)[Symbol.for('TEST')]).toBe(true)
    expect(await proxy.next()).toEqual({ done: false, value: 3 })
    expect(await proxy.next()).toEqual({ done: false, value: 4 })
    expect(await proxy.next()).toEqual({ done: true, value: undefined })
  })
})
