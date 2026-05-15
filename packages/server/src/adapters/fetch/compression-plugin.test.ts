import { ORPCError } from '@orpc/client'
import { os } from '../../builder'
import { CompressionPlugin } from './compression-plugin'
import { RPCHandler } from './rpc-handler'

describe('compressionPlugin', () => {
  const largeText = 'x'.repeat(2000) // 2KB of text, above default threshold
  const smallText = 'small response' // Small text, below threshold

  it('should not compress response when no accept-encoding header', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      plugins: [
        new CompressionPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toContain('output')
    expect(response?.headers.has('content-encoding')).toBe(false)
    expect(response?.status).toBe(200)
  })

  it('should compress response with gzip when client accepts it', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      plugins: [
        new CompressionPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip, deflate',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('gzip')
    expect(response?.status).toBe(200)

    // Verify the response can be decompressed
    const decompressed = response?.body?.pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(decompressed).text()
    expect(text).toContain('output')
  })

  it('should compress response with deflate when client accepts it', async () => {
    const handler = new RPCHandler(os.handler(() => largeText), {
      plugins: [
        new CompressionPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'deflate',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('deflate')
    expect(response?.status).toBe(200)

    // Verify the response can be decompressed
    const decompressed = response?.body?.pipeThrough(new DecompressionStream('deflate'))
    const text = await new Response(decompressed).text()
    expect(text).toContain(largeText)
  })

  it('should prefer gzip over deflate when both are supported', async () => {
    const handler = new RPCHandler(os.handler(() => largeText), {
      plugins: [
        new CompressionPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'deflate, gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('gzip')
  })

  it('should respect custom encoding order', async () => {
    const handler = new RPCHandler(os.handler(() => largeText), {
      plugins: [
        new CompressionPlugin({ encodings: ['deflate', 'gzip'] }),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip, deflate',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('deflate')
  })

  it('should not compress response below threshold', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      plugins: [
        new CompressionPlugin({ threshold: 1024 }),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              body: new Blob([smallText], { type: 'text/plain' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
        'content-length': smallText.length.toString(),
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toContain(smallText)
    expect(response?.headers.has('content-encoding')).toBe(false)
  })

  it('should compress response above custom threshold', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin({ threshold: 1024 }),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              body: new Blob([largeText], { type: 'text/plain' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('gzip')
  })

  it('should not compress when response already has content-encoding', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin(),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              headers: {
                ...result.response.headers,
                'content-encoding': 'br',
              },
              body: new Blob([largeText], { type: 'text/plain' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toBe(largeText)
    expect(response?.headers.get('content-encoding')).toBe('br')
  })

  it('should not compress when response has transfer-encoding', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin(),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              headers: {
                ...result.response.headers,
                'transfer-encoding': 'chunked',
              },
              body: new Blob([largeText], { type: 'text/plain' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toBe(largeText)
    expect(response?.headers.has('content-encoding')).toBe(false)
  })

  it('should not compress when response has no body', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin(),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              status: 204,
              body: undefined,
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.body).toBe(null)
    expect(response?.headers.has('content-encoding')).toBe(false)
    expect(response?.status).toBe(204)
  })

  it('should not compress when response has no content-type', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin(),
      ],
      adapterInterceptors: [
        async (options) => {
          const result = await options.next()
          result.response?.headers.delete('content-type') // Simulate no content-type
          return result
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.has('content-encoding')).toBe(false)
    expect(response?.headers.has('content-type')).toBe(false)
    expect(response?.status).toBe(200)
    await expect(response?.text()).resolves.toContain('output')
  })

  it('should not compress non-compressible content types', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      plugins: [
        new CompressionPlugin(),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              body: new Blob([largeText], { type: 'image/jpeg' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toBe(largeText)
    expect(response?.headers.has('content-encoding')).toBe(false)
  })

  it.each([
    'text/plain',
    'text/html',
    'application/json',
    'application/javascript',
    'application/xml',
    'font/otf',
    'application/vnd.ms-fontobject',
  ])('should compress compressible content types: %s', async (contentType) => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      plugins: [
        new CompressionPlugin(),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              body: new Blob([largeText], { type: contentType }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('gzip')
    expect(response?.headers.get('content-type')).toBe(contentType)
    expect(response?.headers.get('content-length')).toBeNull() // CompressionStream changes content length
  })

  it('should not compress when cache-control has no-transform', async () => {
    const handler = new RPCHandler(os.handler(() => 'output'), {
      plugins: [
        new CompressionPlugin(),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              headers: {
                ...result.response.headers,
                'cache-control': 'no-cache, no-transform, max-age=0',
              },
              body: new Blob([largeText], { type: 'text/plain' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toBe(largeText)
    expect(response?.headers.has('content-encoding')).toBe(false)
  })

  it('should compress when response has unknown content-length', async () => {
    const handler = new RPCHandler(os.handler(() => largeText), {
      plugins: [
        new CompressionPlugin({ threshold: 1024 }),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('gzip')
  })

  it('should not compress when no matching encoding is found', async () => {
    const handler = new RPCHandler(os.handler(() => largeText), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin({ encodings: ['gzip'] }),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'br, compress',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toContain(largeText)
    expect(response?.headers.has('content-encoding')).toBe(false)
  })

  it('should handle non-matched routes without compression', async () => {
    const handler = new RPCHandler(os.handler(() => 'ping'), {
      strictGetMethodPluginEnabled: false,
      plugins: [
        new CompressionPlugin(),
      ],
    })

    // Simulate a non-matched route by using a request that doesn't match
    const { matched, response } = await handler.handle(new Request('https://example.com/nonexistent'))

    expect(matched).toBe(false)
    expect(response).toBeUndefined()
  })

  it('should override filter and compress if filter return true', async () => {
    const filter = vi.fn(() => true)

    const handler = new RPCHandler(os.handler(() => largeText), {
      plugins: [
        new CompressionPlugin({
          filter,
        }),
      ],
      interceptors: [
        async (options) => {
          const result = await options.next()

          if (!result.matched) {
            return result
          }

          return {
            ...result,
            response: {
              ...result.response,
              // image/jpeg is not compressible by default
              body: new Blob([largeText], { type: 'image/jpeg' }),
            },
          }
        },
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBe('gzip')

    expect(filter).toHaveBeenCalledWith(expect.any(Request), expect.any(Response))
  })

  it('should not compress when filter returns false', async () => {
    const filter = vi.fn(() => false)

    const handler = new RPCHandler(os.handler(() => largeText), {
      plugins: [
        new CompressionPlugin({
          filter,
        }),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    await expect(response?.text()).resolves.toContain(largeText)
    expect(response?.headers.has('content-encoding')).toBe(false)

    expect(filter).toHaveBeenCalledWith(expect.any(Request), response)
  })

  it('should not compress event iterator responses', async () => {
    const handler = new RPCHandler(os.handler(async function* () {
      yield 'event1'
      yield 'event2'
    }), {
      plugins: [
        new CompressionPlugin({ filter: () => true }),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'text/event-stream',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    expect(response?.headers.get('content-encoding')).toBeNull()
    expect(response?.status).toBe(200)

    const text = await response?.text()
    expect(text).toContain('event1')
    expect(text).toContain('event2')
  })

  it('can compress error response', async () => {
    const error = new ORPCError('UNAUTHORIZED')

    const handler = new RPCHandler(os.handler(() => {
      throw error
    }), {
      plugins: [
        new CompressionPlugin(),
      ],
    })

    const { response } = await handler.handle(new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({}),
    }))

    const decompressed = response?.body?.pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(decompressed).text()
    expect(text).toContain(error.code)
    expect(response?.headers.get('content-encoding')).toBe('gzip')
    expect(response?.status).toBe(error.status)
  })
})
