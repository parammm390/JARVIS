import type { ImportEntity } from "./definition";
import type { ImportIssue } from "./mapping";

const exists = (value: unknown) => value !== undefined && value !== null && value !== "";
const enums: Partial<Record<ImportEntity, Record<string, string[]>>> = {
  lead: { status: ["new", "contacted", "qualified", "disqualified", "converted"] },
  appointment: { status: ["hold", "confirmed", "completed", "canceled", "no_show"] },
  equipment: { source: ["finnor", "competitor"], assetDomain: ["WATER", "HVAC", "PLUMBING", "GENERIC", "UNRESOLVED"] },
  property: { kind: ["residential", "commercial", "service_location", "unknown"] },
  work_order: { type: ["install", "repair", "warranty", "other"], status: ["draft", "scheduled", "in_progress", "completed", "canceled"] },
  quote: { status: ["draft", "sent", "accepted", "declined", "expired"] },
  invoice: { status: ["draft", "sent", "paid", "overdue", "void"] },
  payment: { method: ["card", "ach", "check", "cash", "other"], status: ["pending", "succeeded", "failed", "refunded"] },
};

export function validateCanonicalRow(entity: ImportEntity, data: Record<string, unknown>): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const require = (...fields: string[]) => fields.forEach((field) => { if (!exists(data[field])) issues.push({ stage: "validation", code: "canonical_required", message: "canonical field is required", field }); });
  if (entity === "customer") {
    if (!exists(data.name) && !exists(data.firstName) && !exists(data.lastName)) require("name");
    if (!exists(data.phone) && !exists(data.email)) issues.push({ stage: "validation", code: "contact_method_required", message: "customer requires a phone or email" });
  }
  if (entity === "lead") { require("name"); if (!exists(data.phone) && !exists(data.email)) issues.push({ stage: "validation", code: "contact_method_required", message: "lead requires a phone or email" }); }
  if (exists(data.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) issues.push({ stage: "validation", code: "invalid_email", message: "email is not valid", field: "email" });
  if (exists(data.phone) && !/^\+[1-9]\d{6,14}$/.test(String(data.phone))) issues.push({ stage: "validation", code: "invalid_phone", message: "phone must be normalized E.164", field: "phone" });
  if (entity === "appointment") require("scheduledAt");
  if (entity === "service_visit") require("type");
  if (entity === "equipment") require("type");
  if (entity === "property") require("address");
  if (entity === "work_order") require("type");
  if (entity === "quote") {
    require("lineItems");
    if (Array.isArray(data.lineItems)) data.lineItems.forEach((item, index) => {
      const quantity = item && typeof item === "object" && exists((item as Record<string, unknown>).quantity) ? Number((item as Record<string, unknown>).quantity) : 1;
      if (!item || typeof item !== "object" || !exists((item as Record<string, unknown>).label) || !(Number((item as Record<string, unknown>).unitPriceUsd) >= 0) || !Number.isInteger(quantity) || quantity <= 0) issues.push({ stage: "validation", code: "invalid_line_item", message: `line item ${index + 1} requires label, positive integer quantity, and non-negative unitPriceUsd`, field: "lineItems" });
    });
    else if (exists(data.lineItems)) issues.push({ stage: "validation", code: "invalid_line_items", message: "lineItems must be an array", field: "lineItems" });
  }
  if (entity === "proposal") {
    require("content");
    if (exists(data.content) && (typeof data.content !== "object" || Array.isArray(data.content))) issues.push({ stage: "validation", code: "invalid_proposal_content", message: "proposal content must be a JSON object", field: "content" });
  }
  if (entity === "invoice" || entity === "payment") { require("amountUsd"); if (exists(data.amountUsd) && !(Number(data.amountUsd) > 0)) issues.push({ stage: "validation", code: "positive_amount_required", message: "amountUsd must be greater than zero", field: "amountUsd" }); }
  if (entity === "inventory_item") { require("sku", "name"); for (const field of ["quantity", "reorderThreshold"]) if (exists(data[field]) && (!Number.isInteger(Number(data[field])) || Number(data[field]) < 0)) issues.push({ stage: "validation", code: "nonnegative_integer_required", message: `${field} must be a non-negative integer`, field }); }
  if (entity === "technician") require("name");
  for (const [field, allowed] of Object.entries(enums[entity] ?? {})) if (exists(data[field]) && !allowed.includes(String(data[field]))) issues.push({ stage: "validation", code: "invalid_enum", message: `${String(data[field])} is not one of ${allowed.join(", ")}`, field });
  return issues;
}
