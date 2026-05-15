import { isObject } from '@orpc/shared'

export function isSubsetOf(subsetKey: unknown, fullKey: unknown): boolean {
  return subsetKey === fullKey
    ? true
    : typeof subsetKey !== typeof fullKey
      ? false
      : isObject(subsetKey) && isObject(fullKey)
        ? Object.keys(subsetKey).every(key => subsetKey[key] === undefined || isSubsetOf(subsetKey[key], fullKey[key]))
        : Array.isArray(subsetKey) && Array.isArray(fullKey)
          ? subsetKey.every((value, index) => isSubsetOf(value, fullKey[index]))
          : false
}
