import { canonicalSerialize } from "@finnor/operational-ir";

export function assertIsoTimestamp(value: string, field: string): void {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be an ISO-compatible timestamp`);
}

export function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`${field} must be non-empty`);
}

/** Uses the canonical serializer as the single JSON-safety check. */
export function assertCanonicalJson(value: unknown, field: string): void {
  try {
    canonicalSerialize(value);
  } catch (error) {
    throw new TypeError(`${field} must be deterministic JSON: ${(error as Error).message}`);
  }
}

export function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function immutableClone<T>(value: T): T {
  assertCanonicalJson(value, "immutable value");
  return deepFreeze(structuredClone(value));
}

export function compareStable(left: unknown, right: unknown): number {
  return canonicalSerialize(left).localeCompare(canonicalSerialize(right));
}
