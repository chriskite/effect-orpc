import type { StandardHeaders } from '@orpc/standard-server'
import type { HTTPPath } from '../../types'
import { toStandardHeaders as fetchHeadersToStandardHeaders } from '@orpc/standard-server-fetch'
import { COMMON_ORPC_ERROR_DEFS } from '../../error'

export function toHttpPath(path: readonly string[]): HTTPPath {
  return `/${path.map(encodeURIComponent).join('/')}`
}

export function toStandardHeaders(headers: Headers | StandardHeaders): StandardHeaders {
  /**
   * Determines if the provided `headers` is a headers-like object.
   * Avoids `instanceof` checks as this is intended for standard APIs where the Headers constructor may not be available.
   */
  if (typeof headers.forEach === 'function') {
    return fetchHeadersToStandardHeaders(headers as Headers)
  }

  return headers as StandardHeaders
}

export function getMalformedResponseErrorCode(status: number): string {
  return Object.entries(COMMON_ORPC_ERROR_DEFS).find(([, def]) => def.status === status)?.[0] ?? 'MALFORMED_ORPC_ERROR_RESPONSE'
}
