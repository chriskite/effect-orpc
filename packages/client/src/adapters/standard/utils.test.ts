import { getMalformedResponseErrorCode, toHttpPath, toStandardHeaders } from './utils'

it('convertPathToHttpPath', () => {
  expect(toHttpPath(['ping'])).toEqual('/ping')
  expect(toHttpPath(['nested', 'ping'])).toEqual('/nested/ping')
  expect(toHttpPath(['nested/', 'ping'])).toEqual('/nested%2F/ping')
})

it('toStandardHeaders', () => {
  expect(toStandardHeaders({})).toEqual({})
  expect(toStandardHeaders({ 'content-type': 'application/json' })).toEqual({ 'content-type': 'application/json' })

  expect(toStandardHeaders(new Headers())).toEqual({})
  const headers = new Headers({ 'content-type': 'application/json' })
  expect(toStandardHeaders(headers)).toEqual({ 'content-type': 'application/json' })
  expect(toStandardHeaders({ forEach: headers.forEach.bind(headers) } as any)).toEqual({ 'content-type': 'application/json' })
})

it('getMalformedResponseErrorCode', () => {
  expect(getMalformedResponseErrorCode(400)).toEqual('BAD_REQUEST')
  expect(getMalformedResponseErrorCode(401)).toEqual('UNAUTHORIZED')
  expect(getMalformedResponseErrorCode(433)).toEqual('MALFORMED_ORPC_ERROR_RESPONSE')
})
