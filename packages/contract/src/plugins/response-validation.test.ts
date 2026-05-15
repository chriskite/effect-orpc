import { ORPCError } from '@orpc/client'
import { StandardLink } from '@orpc/client/standard'
import * as z from 'zod'
import { validateORPCError, ValidationError } from '../error'
import { ContractProcedure } from '../procedure'
import { ResponseValidationPlugin } from './response-validation'

vi.mock('../error', async original => ({
  ...await original(),
  validateORPCError: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('responseValidationPlugin', () => {
  const schema = z.object({
    value: z.string().or(z.number()).transform(v => Number.parseInt(v.toString())),
  })

  const procedure = new ContractProcedure({
    outputSchema: schema,
    errorMap: {
      TEST: {
        data: schema,
      },
    },
    meta: {},
    route: {},
  })

  const withoutOutputSchemaProcedure = new ContractProcedure({
    errorMap: {},
    meta: {},
    route: {},
  })

  const contract = {
    procedure,
    nested: {
      procedure,
    },
    withoutOutputSchema: withoutOutputSchemaProcedure,
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
      new ResponseValidationPlugin(contract),
    ],
    // ResponseValidationPlugin should execute before user defined interceptors
    interceptors: [interceptor],
  })

  describe('validate output', async () => {
    it('procedure with output schema', async () => {
      codec.decode.mockResolvedValueOnce({ value: '123' })

      const output = await link.call(['procedure'], {}, { context: {} })

      expect(output).toEqual({ value: 123 })
      expect(await interceptor.mock.results[0]?.value).toEqual({ value: 123 })
    })

    it('procedure without output schema', async () => {
      codec.decode.mockResolvedValueOnce('anything')

      const output = await link.call(['withoutOutputSchema'], {}, { context: {} })

      expect(output).toEqual('anything')
      expect(await interceptor.mock.results[0]?.value).toEqual('anything')
    })

    it('on error case', async () => {
      codec.decode.mockResolvedValueOnce('invalid')

      await expect(link.call(['procedure'], {}, { context: {} })).rejects.toSatisfy((e) => {
        expect(e).toBeInstanceOf(ValidationError)
        expect(e.message).toBe('Server response output does not match expected schema')
        expect(e.issues).toBeDefined()
        expect(e.data).toEqual('invalid')

        return true
      })

      await expect(interceptor.mock.results[0]?.value).rejects.toSatisfy((e) => {
        expect(e).toBeInstanceOf(ValidationError)
        expect(e.message).toBe('Server response output does not match expected schema')
        expect(e.issues).toBeDefined()
        expect(e.data).toEqual('invalid')

        return true
      })
    })
  })

  describe('validate error', () => {
    it('with ORPCError', async () => {
      const error = new ORPCError('TEST', { message: 'test', defined: true })
      codec.decode.mockRejectedValueOnce(error)

      const error2 = new ORPCError('TEST', { message: 'test' })
      vi.mocked(validateORPCError).mockResolvedValueOnce(error2)

      await expect(link.call(['nested', 'procedure'], {}, { context: {} })).rejects.toBe(error2)
      await expect(interceptor.mock.results[0]?.value).rejects.toBe(error2)

      expect(validateORPCError).toHaveBeenCalledWith(contract.nested.procedure['~orpc'].errorMap, error)
    })

    it('without ORPCError', async () => {
      const error = new Error('test')
      codec.decode.mockRejectedValueOnce(error)

      await expect(link.call(['nested', 'procedure'], {}, { context: {} })).rejects.toBe(error)
      await expect(interceptor.mock.results[0]?.value).rejects.toBe(error)

      expect(validateORPCError).not.toHaveBeenCalled()
    })
  })

  it('throw if not find matching contract', async () => {
    await expect(link.call(['not', 'found'], {}, { context: {} })).rejects.toThrow('[ResponseValidationPlugin] no valid procedure found at path "not.found", this may happen when the contract router is not properly configured.')
    await expect(interceptor.mock.results[0]?.value).rejects.toThrow('[ResponseValidationPlugin] no valid procedure found at path "not.found", this may happen when the contract router is not properly configured.')
  })
})
