import type { AnySchema } from "@orpc/contract";
import * as Schema from "effect/Schema";

/**
 * A schema accepted by Effect-aware `.input()` / `.output()` methods.
 *
 * Either a Standard Schema (already compatible with oRPC) or an Effect
 * `Schema` with no required context — the latter is converted to a Standard
 * Schema automatically at runtime via `Schema.standardSchemaV1`.
 */
export type EffectAcceptedSchema = AnySchema | Schema.Schema<any, any, never>;

/**
 * Resolves an `EffectAcceptedSchema` to its Standard-Schema form.
 *
 * - If the input already extends `AnySchema`, it is returned as-is.
 * - If it is an Effect `Schema<A, I, never>`, it resolves to the
 *   `StandardSchemaV1<I, A>` shape produced by `Schema.standardSchemaV1`.
 */
export type ToStandardSchema<S> = S extends AnySchema
  ? S
  : S extends Schema.Schema<infer A, infer I, never>
    ? ReturnType<typeof Schema.standardSchemaV1<A, I>>
    : never;

/**
 * Coerces an `EffectAcceptedSchema` into a Standard Schema at runtime.
 *
 * Already-Standard schemas pass through untouched; Effect schemas are
 * wrapped with `Schema.standardSchemaV1` so oRPC's validation pipeline can
 * read them through the `~standard` interface.
 */
export function coerceToStandardSchema<S extends EffectAcceptedSchema>(
  schema: S,
): ToStandardSchema<S> {
  if (typeof schema === "object" && schema !== null && "~standard" in schema) {
    return schema as ToStandardSchema<S>;
  }

  if (Schema.isSchema(schema)) {
    return Schema.standardSchemaV1(
      schema as Schema.Schema<any, any, never>,
    ) as unknown as ToStandardSchema<S>;
  }

  return schema as ToStandardSchema<S>;
}
