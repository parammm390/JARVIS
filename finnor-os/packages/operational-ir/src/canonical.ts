import { createHash } from "node:crypto";
import {
  IR_HASH_PREFIX,
  type IrSemanticHash,
  type OperationalProgram,
  type OperationalProgramDraft,
} from "./contracts";
import { OperationalProgramDraftSchema } from "./schema";

export class CanonicalSerializationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path || "$"}`);
    this.name = "CanonicalSerializationError";
  }
}

/** RFC-8785-style deterministic JSON for the JSON value domain used by IR. Arrays
 * retain their supplied order. IR-specific unordered sets are normalized before
 * this serializer is called. */
export function canonicalSerialize(value: unknown, path = "$", seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalSerializationError("non-finite numbers are forbidden", path);
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (value === undefined) throw new CanonicalSerializationError("undefined is forbidden", path);
  if (typeof value !== "object") throw new CanonicalSerializationError(`unsupported ${typeof value} value`, path);
  if (value instanceof Date) throw new CanonicalSerializationError("Date objects are forbidden; use an ISO string", path);
  if (seen.has(value)) throw new CanonicalSerializationError("cyclic object graphs are forbidden", path);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry, index) => canonicalSerialize(entry, `${path}[${index}]`, seen)).join(",")}]`;
    }
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => {
      if (row[key] === undefined) throw new CanonicalSerializationError("undefined object members are forbidden", `${path}.${key}`);
      return `${JSON.stringify(key)}:${canonicalSerialize(row[key], `${path}.${key}`, seen)}`;
    }).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

const ROOT_NON_SEMANTIC_FIELDS = new Set(["compilerVersion", "provenance", "nonSemantic", "irSemanticHash"]);
const UNORDERED_ARRAY_FIELDS = new Set([
  "constraints",
  "entities",
  "observations",
  "subjectRefs",
  "entityRefs",
  "targetRefs",
  "targets",
  "expectedObservationRefs",
  "dependsOn",
  "includeEntityRefs",
  "excludeEntityRefs",
  "candidates",
  "accepted",
  "refs",
]);

function arrayIsUnordered(key: string | undefined, parent: Record<string, unknown> | undefined): boolean {
  if (!key || !parent) return false;
  if (UNORDERED_ARRAY_FIELDS.has(key)) return true;
  if (key === "branches" && parent.kind === "parallel") return true;
  if (key === "predicates" && (parent.kind === "all" || parent.kind === "any")) return true;
  if (key === "criteria" && (parent.mode === "ALL" || parent.mode === "all")) return true;
  return false;
}

function normalizeSemanticValue(
  value: unknown,
  path: string[],
  parent?: Record<string, unknown>,
  key?: string,
): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry, index) => normalizeSemanticValue(entry, [...path, String(index)]));
    return arrayIsUnordered(key, parent)
      ? normalized.sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)))
      : normalized;
  }
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) throw new CanonicalSerializationError("Date objects are forbidden; use an ISO string", path.join("."));
  const row = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const childKey of Object.keys(row).sort()) {
    if (path.length === 0 && ROOT_NON_SEMANTIC_FIELDS.has(childKey)) continue;
    if (row[childKey] === undefined) continue;
    result[childKey] = normalizeSemanticValue(row[childKey], [...path, childKey], row, childKey);
  }
  return result;
}

/** Returns the exact semantic projection used by the IR hash. Sequence step order
 * and FIRST_MATCH branch-case order remain meaningful; explicitly set-valued fields
 * and parallel branches are sorted. */
export function canonicalizeIrSemanticValue(value: OperationalProgram | OperationalProgramDraft): unknown {
  return normalizeSemanticValue(value, []);
}

/** Canonicalizes a standalone IR fragment (Goal, Predicate, Constraint, etc.) with
 * the same set-order rules used by the program hash. */
export function canonicalizeIrFragment(value: unknown): unknown {
  return normalizeSemanticValue(value, []);
}

export function canonicalIrSemanticJson(value: OperationalProgram | OperationalProgramDraft): string {
  return canonicalSerialize(canonicalizeIrSemanticValue(value));
}

export function computeIrSemanticHash(value: OperationalProgram | OperationalProgramDraft): IrSemanticHash {
  const hex = createHash("sha256").update(canonicalIrSemanticJson(value), "utf8").digest("hex");
  return `${IR_HASH_PREFIX}${hex}`;
}

export function isIrSemanticHash(value: unknown): value is IrSemanticHash {
  return typeof value === "string" && /^ir:sha256:[0-9a-f]{64}$/.test(value);
}

/** Sealing is deterministic and performs strict schema parsing. Static semantic
 * validation is separate so malformed/cyclic fixtures can still be sealed and then
 * proven rejected by validateOperationalProgram. */
export function sealOperationalProgram(draft: OperationalProgramDraft): OperationalProgram {
  const parsed = OperationalProgramDraftSchema.parse(draft);
  return { ...parsed, irSemanticHash: computeIrSemanticHash(parsed) };
}

export function hasValidIrSemanticHash(program: OperationalProgram): boolean {
  return isIrSemanticHash(program.irSemanticHash) && program.irSemanticHash === computeIrSemanticHash(program);
}
