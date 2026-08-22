const SECRET_KEY = /secret|password|passcode|access[\s_-]?token|refresh[\s_-]?token|private[\s_-]?key|api[\s_-]?key|credential|cookie|session[\s_-]?storage|local[\s_-]?storage|authorization/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:ste|sk)[_-][A-Za-z0-9_-]{16,}\b/gi,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /([?&](?:access_token|refresh_token|api_key|token)=)[^&#\s]+/gi,
];

function boundedString(value: string, max = 4_000): string {
  const redacted = SECRET_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, (_match, prefix?: string) => prefix ? `${prefix}[REDACTED]` : "[REDACTED]"), value);
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}…`;
}

/** Persistence/log boundary. It removes secret-shaped fields and explicitly supplied
 * sensitive input values, bounds output, and never preserves browser storage. */
export function redactComputerValue(value: unknown, sensitiveValues: readonly string[] = [], depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") {
    if (sensitiveValues.some((secret) => secret.length > 0 && value.includes(secret))) return "[REDACTED]";
    return boundedString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactComputerValue(item, sensitiveValues, depth + 1));
  if (!value || typeof value !== "object") return String(value ?? "");
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, nested]) => [
    key,
    SECRET_KEY.test(key) ? "[REDACTED]" : redactComputerValue(nested, sensitiveValues, depth + 1),
  ]));
}

export function assertNoComputerSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SECRET_KEY.test(serialized) || SECRET_VALUE_PATTERNS.some((pattern) => { pattern.lastIndex = 0; return pattern.test(serialized); })) {
    throw new Error("Secret-shaped data cannot be persisted in computer execution state");
  }
}
