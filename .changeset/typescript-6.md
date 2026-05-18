---
"@chriskite/effect-orpc": minor
---

Update the `typescript` peer-dep range to `^6`. TypeScript 6.0.3 type-checks the codebase cleanly with no source-level changes required.

Consumers still on TypeScript 5.x will need to upgrade (or pin `@chriskite/effect-orpc@^0.3` until they do); the package no longer declares compatibility with the TS 5 range. The bundled `.d.ts` files continue to compile against the older language service, but the supported development surface is TS 6.

Root `tsconfig.json` also picks up `"ignoreDeprecations": "6.0"` so that `tsup`'s internal DTS pipeline (which still passes the now-deprecated `baseUrl` option through `rollup-plugin-dts`) can emit declarations. Drop this once tsup ships a TS 6-compatible release.
