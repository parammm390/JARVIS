import { z } from "zod";

export const ImportEntitySchema = z.enum([
  "customer", "lead", "appointment", "service_visit", "equipment", "work_order",
  "quote", "proposal", "invoice", "payment", "inventory_item", "technician",
]);

export const NormalizationSchema = z.enum([
  "trim", "lowercase", "uppercase", "title_case", "digits_only", "phone_e164", "empty_to_null",
]);

export const FieldMappingSchema = z.object({
  from: z.string().min(1).optional(),
  compose: z.object({ from: z.array(z.string().min(1)).min(1), separator: z.string().default(" ") }).optional(),
  literal: z.unknown().optional(),
  type: z.enum(["string", "number", "integer", "boolean", "date", "json"]).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  normalize: z.array(NormalizationSchema).default([]),
  valueMap: z.record(z.unknown()).optional(),
}).superRefine((rule, ctx) => {
  const selectors = [rule.from !== undefined, rule.compose !== undefined, rule.literal !== undefined].filter(Boolean).length;
  if (selectors > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "field mapping may use only one of from, compose, or literal" });
});

export const ImportIdentityRuleSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
});

export const ImportRelationshipSchema = z.object({
  entity: ImportEntitySchema,
  sourceId: FieldMappingSchema,
  sourceSystem: z.string().trim().min(1).max(120).optional(),
  required: z.boolean().default(true),
});

const DeclarativeImportBodyObjectSchema = z.object({
  version: z.number().int().positive().default(1),
  entity: ImportEntitySchema,
  sourceSystem: z.string().trim().min(1).max(120),
  delimiter: z.string().length(1).default(","),
  fields: z.record(FieldMappingSchema),
  externalId: FieldMappingSchema.optional(),
  identity: z.array(ImportIdentityRuleSchema).default([]),
  relationships: z.record(ImportRelationshipSchema).default({}),
  updateMode: z.enum(["insert_only", "fill_missing", "source_owned"]).default("fill_missing"),
  batchSize: z.number().int().min(1).max(1000).default(100),
});

function validateDefinition(definition: z.infer<typeof DeclarativeImportBodyObjectSchema>, ctx: z.RefinementCtx): void {
  const allowedFields: Record<z.infer<typeof ImportEntitySchema>, readonly string[]> = {
    customer: ["name", "firstName", "lastName", "phone", "email", "address", "role", "marketingConsent"],
    lead: ["name", "phone", "email", "address", "notes", "source", "status"],
    appointment: ["scheduledAt", "status", "durationMinutes", "notes"],
    service_visit: ["type", "scheduledAt", "completedAt", "notes"],
    equipment: ["type", "model", "installDate", "source"],
    work_order: ["type", "status", "depositAmountUsd", "scheduledAt", "completedAt"],
    quote: ["status", "validUntil", "lineItems"],
    proposal: ["status", "content", "sentAt"],
    invoice: ["amountUsd", "status", "memo", "dueDate"],
    payment: ["amountUsd", "method", "status", "receivedAt"],
    inventory_item: ["sku", "name", "quantity", "reorderThreshold", "unitCostUsd"],
    technician: ["name", "contactInfo", "availability"],
  };
  const allowedRelationships: Record<z.infer<typeof ImportEntitySchema>, readonly string[]> = {
    customer: [], lead: ["householdId"], appointment: ["householdId", "technicianId"],
    service_visit: ["householdId", "technicianId"], equipment: ["householdId"],
    work_order: ["householdId", "quoteId", "technicianId"], quote: ["householdId"], proposal: ["householdId", "quoteId"],
    invoice: ["householdId"], payment: ["invoiceId"], inventory_item: [], technician: [],
  };
  for (const field of Object.keys(definition.fields)) {
    if (!allowedFields[definition.entity].includes(field)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", field], message: `${field} is not a supported canonical field for ${definition.entity}` });
  }
  for (const field of Object.keys(definition.relationships)) {
    if (!allowedRelationships[definition.entity].includes(field)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relationships", field], message: `${field} is not a supported relationship for ${definition.entity}` });
  }
  const requiredRelationship: Partial<Record<z.infer<typeof ImportEntitySchema>, string>> = {
    appointment: "householdId", service_visit: "householdId", equipment: "householdId", work_order: "householdId",
    quote: "householdId", proposal: "householdId", invoice: "householdId", payment: "invoiceId",
  };
  const required = requiredRelationship[definition.entity];
  if (required && !definition.relationships[required]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relationships", required], message: `${definition.entity} requires a ${required} relationship` });
  if (!definition.externalId && definition.identity.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identity"], message: "externalId or at least one deterministic identity rule is required" });
  }
  for (const [index, rule] of definition.identity.entries()) {
    for (const field of rule.fields) {
      if (!definition.fields[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identity", index, "fields"], message: `identity field ${field} is not mapped` });
      else if (definition.fields[field]!.type === "json") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identity", index, "fields"], message: `identity field ${field} cannot use json conversion` });
    }
  }
}

export const DeclarativeImportBodySchema = DeclarativeImportBodyObjectSchema.superRefine(validateDefinition);

export const DeclarativeImportDefinitionSchema = DeclarativeImportBodyObjectSchema.extend({
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/),
  format: z.enum(["csv", "json", "jsonl"]),
}).superRefine(validateDefinition);

export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type ImportEntity = z.infer<typeof ImportEntitySchema>;
export type DeclarativeImportBody = z.infer<typeof DeclarativeImportBodySchema>;
export type DeclarativeImportDefinition = z.infer<typeof DeclarativeImportDefinitionSchema>;

export function parseImportDefinition(value: unknown): DeclarativeImportDefinition {
  return DeclarativeImportDefinitionSchema.parse(value);
}
