---
"@chriskite/effect-orpc": patch
---

Fix `Cannot find module '@chriskite/effect-orpc'` for installed consumers.

The published `package.json`'s `exports` field pointed at `./src/index.ts` / `./src/node.ts`, but `src/` is excluded from the npm tarball. The intent was for `publishConfig.exports` to override these at publish time, but **`npm publish` does not apply `publishConfig.exports`** — that is a pnpm/Bun-specific convention. As a result, every published version since 0.3.0 advertised `exports` paths that did not exist inside the tarball, and consumers (IntelliJ, tsc, bundlers using exports resolution) failed with `TS2307: Cannot find module`.

This release switches to a single canonical `exports` field that points directly at `./dist/*.d.ts` and `./dist/*.js`, removing the brittle `publishConfig.exports` indirection. Turbo's `test` task now declares `dependsOn: ["^build"]` so workspace dev (examples/hono) builds the package before consuming it.

No source-level changes are required for consumers — upgrading to this patch fixes the missing-module error.
