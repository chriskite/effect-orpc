# Contributing

Thanks for considering a contribution to `@chriskite/effect-orpc`.

## Development setup

Prerequisites: Node.js ≥ 20 (Node ≥ 24 recommended) and Bun ≥ 1.2 (the repo
pins Bun via `packageManager`).

```sh
git clone https://github.com/chriskite/effect-orpc.git
cd effect-orpc
bun install --frozen-lockfile
```

## The basic loop

```sh
bun run check        # format + lint + type-check
bun run test         # run all tests (package + examples)
bun run build        # produce dist/ artifacts and emit .d.ts
```

`bun run fix` will auto-format and auto-fix lint errors where possible.

## Where things live

- `packages/effect-orpc/src/` — library source.
- `packages/effect-orpc/tests/` — package tests (vitest).
- `examples/hono/` — end-to-end Hono example, including HTTP-level wire tests.
- `effect/`, `orpc/` — vendored read-only copies of the dependency sources for
  in-editor reference; **do not modify**.

## Changesets

Every PR that changes user-facing behavior should include a changeset:

```sh
bunx changeset
```

Pick the bump level (typically `patch` for fixes, `minor` for additive
changes; the package is pre-1.0 so breaking changes also use `minor`).
Commit the generated file under `.changeset/`.

## Pull requests

- Keep PRs focused: one concern per branch.
- Add tests for new behavior or regressions you fix.
- CI runs `check`, `test`, and `build` on every PR — keep it green before
  requesting review.
- For substantial changes, open a discussion or issue first to align on
  approach.

## Reporting bugs

Use [GitHub Issues](https://github.com/chriskite/effect-orpc/issues) for bug
reports. For security issues, see [`SECURITY.md`](./SECURITY.md).
