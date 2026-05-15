---
"effect-orpc": minor
---

API surface audit (breaking — public surface narrowed):

- Removed three implementation-detail helpers from the public surface (they remain available via deep imports for tests/advanced usage but are no longer documented or covered by semver):
  - `addSpanStackTrace`
  - `effectErrorMapToErrorMap`
  - `createEffectErrorConstructorMap`
- Confirmed `effectContractSymbol` is and remains an internal symbol — not re-exported from `index.ts`. `eoc`-branded contracts are not externally extensible by design.

If you were importing these helpers, you have two options:
1. Switch to the public surface (most users only need `makeEffectORPC`, `implementEffect`, `eoc`, `ORPCTaggedError`).
2. Pin a deep import (e.g. `effect-orpc/dist/tagged-error.js`) — but this is unsupported and may break at any time.
