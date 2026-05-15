---
"effect-orpc": minor
---

Type-system tightening:

- Replaced `as any` casts at proxy/factory boundaries with the narrowest viable `as unknown as <T>` (or equivalent) casts and added one-line comments explaining what each one is asserting. Affected sites: `effect-builder.ts:178, 218, 226`, `effect-runtime.ts:153`, `contract.ts:420`, `tagged-error.ts:261`.
- Added `tests/enhance-router-types.test.ts` with `expectTypeOf` assertions that pin the structural shape `enhanceEffectRouter` produces from a known fixture, so future refactors of `EnhancedEffectRouter` can't silently regress.
- Evaluated `exactOptionalPropertyTypes: true` and deferred: the flag generates ~10+ errors in existing tests that explicitly pass `signal: undefined` for documentation clarity. The cost of fixing every call site outweighs the benefit on a codebase where `undefined` and key-absent are treated identically.
