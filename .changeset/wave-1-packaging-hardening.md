---
"effect-orpc": minor
---

Packaging and CI hardening:

- Emit real `.d.ts` files from `tsup`. Published types now point at `dist/*.d.ts` instead of `src/*.ts`, removing the dependency on `allowImportingTsExtensions` in consumer projects.
- Stop shipping test sources in the npm tarball. The `tests/` directory is now a sibling of `src/` and is excluded from `files`. The `src/` directory is no longer shipped — only `dist/`, `LICENSE`, and `README.md`.
- Tighten peer-dep ranges from `>=X.Y.Z` to `^X.Y.Z` for `@orpc/*` and `effect`. Each new major will be validated and bumped deliberately.
- Add `description`, `homepage`, `bugs`, `engines` (`node: >=20`, `bun: >=1.2`), and `sideEffects` (with a carve-out for `./dist/node.js` which installs the fiber-context bridge at import time) to `package.json`.
- Add a `ci.yml` workflow that runs `check`, `test`, and `build` on every pull request. Pin Bun to `1.3.9` in both workflows.
- Sign npm publishes with `--provenance` via `NPM_CONFIG_PROVENANCE`.
- Add `dependabot.yml` for monthly npm + github-actions updates, grouped by `@orpc/*`, `effect/@effect/*`, and dev tools.
