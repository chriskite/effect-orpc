import { ORPCError } from '@orpc/client'
import { outputSchema } from '../../contract/tests/shared'
import { createORPCErrorConstructorMap } from './error'

describe('createORPCErrorConstructorMap', () => {
  const errors = {
    BAD_GATEWAY: {
      status: 588,
      message: 'default message',
      data: outputSchema,
    },
  }

  const constructors = createORPCErrorConstructorMap(errors)

  it('works', () => {
    const error = constructors.BAD_GATEWAY({ data: { output: 123 }, cause: 'cause' })

    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toEqual('BAD_GATEWAY')
    expect(error.status).toBe(588)
    expect(error.defined).toBe(true)
    expect(error.message).toBe('default message')
    expect(error.data).toEqual({ output: 123 })
    expect(error.cause).toBe('cause')
  })

  it('can override message', () => {
    expect(
      constructors.BAD_GATEWAY({ message: 'custom message', data: { output: 123 } }).message,
    ).toBe('custom message')
  })

  it('can arbitrary access', () => {
    // @ts-expect-error - invalid access
    const error = constructors.ANY_THING({ data: 'DATA', message: 'MESSAGE', cause: 'cause' })

    expect(error).toBeInstanceOf(ORPCError)
    expect(error.code).toEqual('ANY_THING')
    expect(error.status).toBe(500)
    expect(error.defined).toBe(false)
    expect(error.message).toBe('MESSAGE')
    expect(error.data).toEqual('DATA')
    expect(error.cause).toBe('cause')
  })

  it('not proxy when access with symbol', () => {
    // @ts-expect-error - invalid access
    expect(constructors[Symbol('something')]).toBeUndefined()
  })
})
