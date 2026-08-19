import { createHash } from "node:crypto";
import type { DeclarativeImportDefinition, FieldMapping, ImportEntity } from "./definition";

export interface ImportIssue {
  stage: "parse" | "mapping" | "normalization" | "validation" | "identity" | "relationship" | "write";
  code: string;
  message: string;
  field?: string;
}

export interface MappedRow {
  data: Record<string, unknown>;
  externalId?: string;
  sourceId?: string;
  identityKey?: string;
  relationshipSourceIds: Record<string, { entity: ImportEntity; sourceSystem: string; sourceId: string; required: boolean }>;
  issues: ImportIssue[];
}

function selectedValue(row: Record<string, unknown>, rule: FieldMapping): unknown {
  if (rule.literal !== undefined) return rule.literal;
  if (rule.compose) return rule.compose.from
    .map((field) => row[field])
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => typeof value === "string" ? value.trim() : value)
    .join(rule.compose.separator);
  if (rule.from) return row[rule.from];
  return undefined;
}

function normalize(value: unknown, operations: FieldMapping["normalize"]): unknown {
  let result = value;
  for (const operation of operations) {
    if (operation === "empty_to_null" && typeof result === "string" && !result.trim()) result = null;
    if (result === null || result === undefined) continue;
    if (operation === "trim") result = String(result).trim();
    if (operation === "lowercase") result = String(result).toLowerCase();
    if (operation === "uppercase") result = String(result).toUpperCase();
    if (operation === "digits_only") result = String(result).replace(/\D/g, "");
    if (operation === "title_case") result = String(result).toLowerCase().replace(/\b\p{L}/gu, (char) => char.toUpperCase());
    if (operation === "phone_e164") {
      const raw = String(result).trim();
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) throw new Error("must contain 7-15 phone digits");
      result = raw.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
    }
  }
  return result;
}

function convert(value: unknown, rule: FieldMapping): unknown {
  if (value === undefined || value === null || value === "") return value;
  const normalized = normalize(value, rule.normalize);
  const mapped = rule.valueMap
    ? Object.prototype.hasOwnProperty.call(rule.valueMap, String(normalized)) ? rule.valueMap[String(normalized)] : Symbol.for("unmapped")
    : normalized;
  if (mapped === Symbol.for("unmapped")) throw new Error(`value ${JSON.stringify(normalized)} has no valueMap entry`);
  if (rule.type === "string") return String(mapped);
  if (rule.type === "number") { const result = Number(mapped); if (!Number.isFinite(result)) throw new Error("must be a finite number"); return result; }
  if (rule.type === "integer") { const result = Number(mapped); if (!Number.isInteger(result)) throw new Error("must be an integer"); return result; }
  if (rule.type === "boolean") {
    if (typeof mapped === "boolean") return mapped;
    const key = String(mapped).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(key)) return true;
    if (["false", "0", "no", "n"].includes(key)) return false;
    throw new Error("must be a boolean");
  }
  if (rule.type === "date") { const date = new Date(String(mapped)); if (Number.isNaN(date.getTime())) throw new Error("must be a valid date"); return date.toISOString(); }
  if (rule.type === "json") {
    if (typeof mapped === "object") return mapped;
    try { return JSON.parse(String(mapped)); } catch { throw new Error("must be valid JSON"); }
  }
  return mapped;
}

function mapRule(row: Record<string, unknown>, rule: FieldMapping): unknown {
  const selected = selectedValue(row, rule);
  return convert(selected === undefined || selected === null || selected === "" ? rule.default : selected, rule);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function mapSourceRow(row: Record<string, unknown>, definition: DeclarativeImportDefinition): MappedRow {
  const data: Record<string, unknown> = {};
  const issues: ImportIssue[] = [];
  for (const [field, rule] of Object.entries(definition.fields)) {
    try {
      const value = mapRule(row, rule);
      if (rule.required && (value === undefined || value === null || value === "")) issues.push({ stage: "mapping", code: "required", message: "required value is missing", field });
      else if (value !== undefined) data[field] = value;
    } catch (error) {
      issues.push({ stage: "normalization", code: "conversion_failed", message: (error as Error).message, field });
    }
  }
  let externalId: string | undefined;
  if (definition.externalId) {
    try {
      const value = mapRule(row, definition.externalId);
      if (definition.externalId.required && (value === undefined || value === null || value === "")) issues.push({ stage: "identity", code: "external_id_required", message: "external source id is missing", field: "externalId" });
      else if (value !== undefined && value !== null && value !== "") externalId = String(value);
    } catch (error) { issues.push({ stage: "identity", code: "external_id_invalid", message: (error as Error).message, field: "externalId" }); }
  }
  let identityKey: string | undefined;
  for (const rule of definition.identity) {
    const values = rule.fields.map((field) => data[field]);
    if (values.every((value) => value !== undefined && value !== null && value !== "")) {
      identityKey = digest(JSON.stringify([definition.entity, ...rule.fields.map((field, index) => [field, values[index]])]));
      break;
    }
  }
  const sourceId = externalId ?? (identityKey ? `identity:${identityKey}` : undefined);
  if (!sourceId) issues.push({ stage: "identity", code: "identity_unresolved", message: "row has neither an external id nor a complete deterministic identity" });

  const relationshipSourceIds: MappedRow["relationshipSourceIds"] = {};
  for (const [field, relationship] of Object.entries(definition.relationships)) {
    try {
      const value = mapRule(row, relationship.sourceId);
      if (value === undefined || value === null || value === "") {
        if (relationship.required) issues.push({ stage: "relationship", code: "relationship_source_id_required", message: "relationship source id is missing", field });
      } else {
        relationshipSourceIds[field] = { entity: relationship.entity, sourceSystem: relationship.sourceSystem ?? definition.sourceSystem, sourceId: String(value), required: relationship.required };
      }
    } catch (error) { issues.push({ stage: "relationship", code: "relationship_source_id_invalid", message: (error as Error).message, field }); }
  }
  return { data, externalId, sourceId, identityKey, relationshipSourceIds, issues };
}
