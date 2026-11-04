// Convert an MCP tool's JSON Schema (the `inputSchema` object) into a Zod raw
// shape, which is what McpServer.registerTool requires for a tool's inputSchema.
// Raw JSON Schema objects are rejected by the SDK, so we translate the common
// subset that real upstream tools actually use. Anything we don't recognise
// degrades to z.any() so forwarding never breaks on an exotic schema.

import { z, type ZodTypeAny } from "zod";

type JsonSchema = Record<string, unknown>;
type RawShape = Record<string, ZodTypeAny>;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// Convert a single JSON Schema node to a Zod type.
function nodeToZod(node: unknown): ZodTypeAny {
  if (typeof node !== "object" || node === null) return z.any();
  const s = node as JsonSchema;

  // enum: prefer z.enum for all-string enums, else a union of literals.
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const vals = s.enum;
    if (vals.every((v) => typeof v === "string")) {
      return withDescribe(z.enum(vals as [string, ...string[]]), s);
    }
    const literals = vals.map((v) => z.literal(v as any)) as ZodTypeAny[];
    const union = literals.length === 1 ? literals[0] : z.union(literals as any);
    return withDescribe(union, s);
  }

  // type may be a string or an array of strings (e.g. ["string","null"]).
  const rawType = s.type;
  const type = Array.isArray(rawType) ? rawType.find((t) => t !== "null") : rawType;
  const nullable = Array.isArray(rawType) && rawType.includes("null");

  let zt: ZodTypeAny;
  switch (type) {
    case "string":
      zt = z.string();
      break;
    case "number":
    case "integer":
      zt = z.number();
      break;
    case "boolean":
      zt = z.boolean();
      break;
    case "array": {
      const items = s.items;
      // tuple items (array of schemas) -> fall back to array of any
      const itemZod = Array.isArray(items) ? z.any() : nodeToZod(items ?? {});
      zt = z.array(itemZod);
      break;
    }
    case "object":
      zt = z.object(objectToShape(s));
      break;
    default:
      zt = z.any();
  }

  if (nullable) zt = zt.nullable();
  return withDescribe(zt, s);
}

function withDescribe(zt: ZodTypeAny, s: JsonSchema): ZodTypeAny {
  return typeof s.description === "string" ? zt.describe(s.description) : zt;
}

// Build a RawShape from an object schema's `properties` + `required`.
function objectToShape(schema: JsonSchema): RawShape {
  const props = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const required = new Set(asArray(schema.required).filter((r): r is string => typeof r === "string"));
  const shape: RawShape = {};
  for (const [key, propSchema] of Object.entries(props)) {
    const zt = nodeToZod(propSchema);
    shape[key] = required.has(key) ? zt : zt.optional();
  }
  return shape;
}

// Public entry: top-level inputSchema (an object schema) -> RawShape.
// A missing/empty/non-object schema yields an empty shape (no-arg tool).
export function toZodShape(schema: unknown): RawShape {
  if (typeof schema !== "object" || schema === null) return {};
  return objectToShape(schema as JsonSchema);
}
