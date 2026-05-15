import type { ErrorMap } from './error'
import { ORPCError } from '@orpc/client'
import z from 'zod'
import { baseErrorMap } from '../tests/shared'
import { mergeErrorMap, validateORPCError, ValidationError } from './error'

it('validationError', () => {
  const error = new ValidationError({ message: 'message', issues: [{ message: 'message' }] })
  expect(error).toBeInstanceOf(Error)
  expect(error.issues).toEqual([{ message: 'message' }])
})

it('mergeErrorMap', () => {
  expect(mergeErrorMap(baseErrorMap, baseErrorMap)).toEqual(baseErrorMap)
  expect(mergeErrorMap(baseErrorMap, { OVERRIDE: {}, INVALID: {} })).toEqual(
    { OVERRIDE: {}, INVALID: {}, BASE: baseErrorMap.BASE },
  )
})

describe('validateORPCError', () => {
  const errors: ErrorMap = {
    BAD_GATEWAY: {
      data: z.object({
        value: z.string().transform(v => Number.parseInt(v)),
      }),
    },
    CONFLICT: {
      status: 483,
    },
  }

  it('ignore not-match errors when defined=false', async () => {
    const e1 = new ORPCError('BAD_GATEWAY', { status: 501, data: { value: '123' } })
    expect(await validateORPCError(errors, e1)).toBe(e1)

    const e2 = new ORPCError('NOT_FOUND')
    expect(await validateORPCError(errors, e2)).toBe(e2)

    const e3 = new ORPCError('BAD_GATEWAY', { data: 'invalid' })
    expect(await validateORPCError(errors, e3)).toBe(e3)

    const e4 = new ORPCError('CONFLICT')
    expect(await validateORPCError(errors, e4)).toBe(e4)
  })

  it('modify not-match errors when defined=true', async () => {
    const e1 = new ORPCError('BAD_GATEWAY', { defined: true, status: 501 })
    const v1 = await validateORPCError(errors, e1)
    expect(v1).not.toBe(e1)
    expect({ ...v1 }).toEqual({ ...e1, defined: false })

    const e2 = new ORPCError('NOT_FOUND', { defined: true })
    const v2 = await validateORPCError(errors, e2)
    expect(v2).not.toBe(e2)
    expect({ ...v2 }).toEqual({ ...e2, defined: false })

    const e3 = new ORPCError('BAD_GATEWAY', { defined: true, data: 'invalid' })
    const v3 = await validateORPCError(errors, e3)
    expect(v3).not.toBe(e3)
    expect({ ...v3 }).toEqual({ ...e3, defined: false })

    const e4 = new ORPCError('CONFLICT', { defined: true })
    const v4 = await validateORPCError(errors, e4)
    expect(v4).not.toBe(e4)
    expect({ ...v4 }).toEqual({ ...e4, defined: false })
  })

  it('ignore match errors when defined=true and data schema is undefined', async () => {
    const e1 = new ORPCError('CONFLICT', { defined: true, status: 483 })
    expect(await validateORPCError(errors, e1)).toBe(e1)
  })

  it('return new error when defined=true and data schema is undefined with match error', async () => {
    const e1 = new ORPCError('CONFLICT', { status: 483 })
    const v1 = await validateORPCError(errors, e1)
    expect(v1).not.toBe(e1)
    expect({ ...v1 }).toEqual({ ...e1, defined: true })
  })

  it('return new with defined=true and validated data with match errors', async () => {
    const e1 = new ORPCError('BAD_GATEWAY', { data: { value: '123' } })
    const v1 = await validateORPCError(errors, e1)
    expect(v1).not.toBe(e1)
    expect({ ...v1 }).toEqual({ ...e1, defined: true, data: { value: 123 } })
  })
})
