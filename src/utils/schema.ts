import { jsonSchemaToZod } from "json-schema-to-zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function convertJsonSchemaToZod(jsonSchema: any) {
  const zod = jsonSchemaToZod(jsonSchema);
  console.log(zod);
  return zod;
}

export function convertZodToJsonSchema(zod: any) {
  return zodToJsonSchema(zod);
}
