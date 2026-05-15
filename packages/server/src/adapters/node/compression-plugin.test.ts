import type { IncomingMessage, ServerResponse } from 'node:http'
import request from 'supertest'
import { os } from '../../builder'
import { CompressionPlugin } from './compression-plugin'
import { RPCHandler } from './rpc-handler'

describe('compressionPlugin', () => {
  const largeText = 'x'.repeat(2000) // 2KB of text, above default threshold

  it('should compress response when accept-encoding includes gzip', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin(),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    // Just check that we get a response, not trying to decompress for now
    expect(res.body).toBeDefined()
  })

  it('should not compress response when accept-encoding does not include compression', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin(),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'identity')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.text).toContain('output')
  })

  it('should not compress responses if below threshold', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin({
            threshold: 1000, // Set a high threshold
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
                body: new Blob(['small'], { type: 'text/plain' }),
              },
            }
          },
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.text).toContain('small')
  })

  it('should work with deflate compression', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin(),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('deflate')
  })

  it('should override default filter and compress if filter returns true', async () => {
    const filter = vi.fn(() => true)

    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin({ filter }),
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

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')

    expect(filter).toHaveBeenCalledWith(expect.any(Object), expect.any(Object))
  })

  it('should not compress if filter return false', async () => {
    const filter = vi.fn(() => false)

    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin({ filter }),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()

    expect(filter).toHaveBeenCalledWith(expect.any(Object), expect.any(Object))
  })

  it('should throw if rootInterceptor throws', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin(),
        ],
        rootInterceptors: [
          async () => {
            throw new Error('Test error')
          },
        ],
      })

      await expect(handler.handle(req, res)).rejects.toThrow('Test error')

      res.statusCode = 500
      res.end()
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(500)
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('should throw if compression options throw', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(() => 'output'), {
        plugins: [
          new CompressionPlugin({
            filter: () => {
              throw new Error('Test error')
            },
          }),
        ],
      })

      await expect(handler.handle(req, res)).rejects.toThrow('Test error')

      res.statusCode = 500
      res.end()
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(500)
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('should not compress event iterator responses', async () => {
    const res = await request(async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new RPCHandler(os.handler(async function* () {
        yield 'yield1'
        yield 'yield2'
      }), {
        plugins: [
          new CompressionPlugin({ filter: () => true }),
        ],
      })

      await handler.handle(req, res)
    })
      .post('/')
      .set('accept-encoding', 'gzip, deflate')
      .send({ input: 'test' })

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.text).toContain('yield1')
    expect(res.text).toContain('yield2')
  })
})
