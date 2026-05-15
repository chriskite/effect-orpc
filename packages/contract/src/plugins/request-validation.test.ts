import { ORPCError } from '@orpc/client'
import { StandardLink } from '@orpc/client/standard'
import * as z from 'zod'
import { ValidationError } from '../error'
import { ContractProcedure } from '../procedure'
import { RequestValidationPlugin, RequestValidationPluginError } from './request-validation'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestValidationPlugin', () => {
  const schema = z.object({
    value: z.number().transform(v => v.toString()),
  })

  const procedure = new ContractProcedure({
    inputSchema: schema,
    errorMap: {
      TEST: {
        data: schema,
      },
    },
    meta: {},
    route: {},
  })

  const withoutInputSchemaProcedure = new ContractProcedure({
    errorMap: {},
    meta: {},
    route: {},
  })

  const contract = {
    procedure,
    nested: {
      procedure,
    },
    withoutInputSchema: withoutInputSchemaProcedure,
  }

  const codec = {
    decode: vi.fn(),
    encode: vi.fn(),
  }

  const client = {
    call: vi.fn(),
  }

  const interceptor = vi.fn(({ next }) => next())

  const link = new StandardLink(codec, client, {
    plugins: [
      new RequestValidationPlugin(contract),
    ],
    // RequestValidationPlugin should execute before user defined interceptors
    interceptors: [interceptor],
  })

  describe('validate input', async () => {
    it('procedure with input schema', async () => {
      codec.decode.mockResolvedValueOnce('__output__')

      const output = await link.call(['procedure'], { value: 123 }, { context: {} })

      expect(output).toEqual('__output__')
      expect(client.call.mock.calls[0]?.[3]).toEqual(
        { value: 123 },
      )
    })

    it('procedure without input schema', async () => {
      codec.decode.mockResolvedValueOnce('__output__')

      const output = await link.call(['withoutInputSchema'], 'anything', { context: {} })

      expect(output).toEqual('__output__')
      expect(client.call.mock.calls[0]?.[3]).toEqual('anything')
    })

    it('throw if input does not match the expected schema', async () => {
      await expect(link.call(['nested', 'procedure'], { value: 'not a number' }, { context: {} })).rejects.toThrow(
        new ORPCError('BAD_REQUEST', {
          message: 'Input validation failed',
          data: {
            issues: expect.any(Object),
          },
          cause: new ValidationError({
            message: 'Input validation failed',
            issues: expect.any(Array),
            data: { value: 'not a number' },
          }),
        }),
      )
    })
  })

  it('throw if not find matching contract', async () => {
    await expect(link.call(['not', 'found'], {}, { context: {} })).rejects.toThrow(
      new RequestValidationPluginError('No valid procedure found at path "not.found", this may happen when the contract router is not properly configured.'),
    )
    await expect(interceptor.mock.results[0]?.value).rejects.toThrow(
      new RequestValidationPluginError('No valid procedure found at path "not.found", this may happen when the contract router is not properly configured.'),
    )
  })
})
