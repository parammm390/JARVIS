import { createHash } from "node:crypto";
import type { JsonValue, SourceIdentityMappings } from "./contracts";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString(10);
  if (value === undefined) return null;
  return value;
}

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalSerialize(value)).digest("hex");
}

export function prefixedHash<TPrefix extends string>(prefix: TPrefix, value: unknown): `${TPrefix}${string}` {
  return `${prefix}${sha256(value)}`;
}

export function stableUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function stableJsonValue(value: unknown): JsonValue {
  return canonicalize(value) as JsonValue;
}

export function emptySourceIdentities(): SourceIdentityMappings {
  return {
    workIds: [],
    businessEffectIds: [],
    businessEffectSemanticHashes: [],
    providerOperationIds: [],
    idempotencyKeys: [],
    operationalIrSemanticHashes: [],
    p5SimulationTraceIds: [],
    commandIds: [],
    workflowRunIds: [],
    workflowStepIds: [],
    decisionReceiptIds: [],
    computerRunIds: [],
    queryExecutionIds: [],
    instructionIds: [],
    authorityDecisionIds: [],
    other: [],
  };
}

export function mergeSourceIdentities(...parts: Array<Partial<SourceIdentityMappings> | undefined>): SourceIdentityMappings {
  const merged = emptySourceIdentities();
  const keys = Object.keys(merged).filter((key) => key !== "other") as Array<Exclude<keyof SourceIdentityMappings, "other">>;
  for (const key of keys) merged[key] = stableUnique(parts.flatMap((part) => part?.[key] ?? []));
  const other = parts.flatMap((part) => part?.other ?? [])
    .filter((entry) => Boolean(entry.domain) && Boolean(entry.id))
    .sort((left, right) => `${left.domain}:${left.id}`.localeCompare(`${right.domain}:${right.id}`));
  merged.other = other.filter((entry, index) => index === 0 || entry.domain !== other[index - 1]!.domain || entry.id !== other[index - 1]!.id);
  return merged;
}

export function assertIsoTimestamp(value: string, label: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

export function compareIsoThenId(
  left: { occurredAt: string; sequence?: number; eventId: string },
  right: { occurredAt: string; sequence?: number; eventId: string },
): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
    || left.eventId.localeCompare(right.eventId);
}
