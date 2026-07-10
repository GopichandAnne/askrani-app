/** A per-store connector as the panel sees it (never includes the raw secret). */
export type Integration = {
  id: string;
  name: string;
  description: string;
  // deno JSON Schema for the tool's args
  params_schema: JsonSchema;
  kind: string;
  endpoint_url: string;
  side_effect: boolean;
  enabled: boolean;
  timeout_ms: number;
  has_secret: boolean;
  updated_at: string | null;
};

export type ParamType = "string" | "number" | "boolean" | "integer";

export type IntegrationParam = {
  name: string;
  type: ParamType;
  description: string;
  required: boolean;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
};

/** Editor rows -> JSON Schema (what the model receives as the tool's parameters). */
export function paramsToSchema(params: IntegrationParam[]): JsonSchema {
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];
  for (const p of params) {
    const name = p.name.trim();
    if (!name) continue;
    properties[name] = { type: p.type, description: p.description.trim() || undefined };
    if (p.required) required.push(name);
  }
  return { type: "object", properties, required };
}

/** JSON Schema -> editor rows (to populate the dialog when editing). */
export function schemaToParams(schema: JsonSchema | null | undefined): IntegrationParam[] {
  const props = schema?.properties ?? {};
  const req = new Set(schema?.required ?? []);
  return Object.entries(props).map(([name, v]) => ({
    name,
    type: (["string", "number", "boolean", "integer"].includes(v?.type) ? v.type : "string") as ParamType,
    description: v?.description ?? "",
    required: req.has(name),
  }));
}
