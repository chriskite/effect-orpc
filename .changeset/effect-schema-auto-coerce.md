---
"@chriskite/effect-orpc": minor
---

Auto-convert Effect `Schema` passed to `.input()` / `.output()`.

Previously, using an Effect `Schema` with `.input()` or `.output()` on either
`makeEffectORPC(...)` builders or the `eoc` contract builder required wrapping
the schema with `Schema.standardSchemaV1(...)` at every call site, since oRPC's
validation pipeline only understands Standard Schema v1.

The builder and contract proxies now detect Effect schemas at runtime and
convert them automatically; the method signatures additionally accept
`Schema.Schema<A, I, never>` and infer the resulting Standard Schema in the
return type, so handler input/output stay correctly typed without manual
casting.

```ts
import { Schema } from "effect"

const getUser = effectOs
  .input(Schema.Struct({ id: Schema.String }))
  .output(Schema.Struct({ name: Schema.String }))
  .effect(function* ({ input }) {
    // input.id: string
    return { name: `user-${input.id}` }
  })
```

Standard Schema inputs (Zod, Valibot, ArkType, etc.) continue to pass through
unchanged, and the two styles can be mixed within the same procedure.
