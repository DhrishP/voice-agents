import { jsonSchemaToZod } from "json-schema-to-zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

export function convertJsonSchemaToZod(jsonSchema: any) {
  const zod = jsonSchemaToZod(jsonSchema);
  console.log(zod);
  return zod;
}

export function convertZodToJsonSchema(zod: any) {
  return zodToJsonSchema(zod);
}

/**
 * Converts a plain object to a Zod schema with support for arrays and nested objects
 * @param obj The plain object to convert to a Zod schema
 * @returns A Zod schema that validates the structure of the input object
 */
export function objectToZodSchema(obj: Record<string, any>) {
  return z.object(
    Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? z.array(
              typeof value[0] === "string"
                ? z.string()
                : typeof value[0] === "number"
                ? z.number()
                : typeof value[0] === "boolean"
                ? z.boolean()
                : typeof value[0] === "object"
                ? z.object(
                    Object.fromEntries(
                      Object.entries(value[0]).map(([key, value]) => [
                        key,
                        typeof value === "string"
                          ? z.string()
                          : typeof value === "number"
                          ? z.number()
                          : typeof value === "boolean"
                          ? z.boolean()
                          : Array.isArray(value)
                          ? z.array(
                              typeof value[0] === "string"
                                ? z.string()
                                : typeof value[0] === "number"
                                ? z.number()
                                : typeof value[0] === "boolean"
                                ? z.boolean()
                                : z.any()
                            )
                          : z.any(),
                      ])
                    )
                  )
                : z.any()
            )
          : typeof value === "string"
          ? z.string()
          : typeof value === "number"
          ? z.number()
          : typeof value === "boolean"
          ? z.boolean()
          : typeof value === "object"
          ? z.object(
              Object.fromEntries(
                Object.entries(value).map(([key, value]) => [
                  key,
                  typeof value === "string"
                    ? z.string()
                    : typeof value === "number"
                    ? z.number()
                    : typeof value === "boolean"
                    ? z.boolean()
                    : Array.isArray(value)
                    ? z.array(
                        typeof value[0] === "string"
                          ? z.string()
                          : typeof value[0] === "number"
                          ? z.number()
                          : typeof value[0] === "boolean"
                          ? z.boolean()
                          : z.any()
                      )
                    : z.any(),
                ])
              )
            )
          : z.any(),
      ])
    )
  );
}
