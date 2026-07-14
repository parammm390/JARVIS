/**
 * Boundary-safe PII handling. Values sent to an LLM, Zep, logs, or telemetry must
 * be redacted first. Tokens are reversible only in the request process, allowing
 * the planner to reason over a request without receiving raw contact details.
 */
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+?\d[\d .()\-]{7,}\d)(?!\w)/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const STREET_ADDRESS = /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|court|ct\.?|way|place|pl\.?|parkway|pkwy\.?)(?:\s*,?\s*[A-Za-z .'-]+)?(?:\s*,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?\b/gi;
const SENSITIVE_KEY = /(?:email|e_mail|phone|mobile|contact|address|street|postal|zip|ssn|social.?security|card|payment|token|secret|password|api.?key)/i;

export interface RedactionResult {
  value: string;
  tokens: Map<string, string>;
}

function nextToken(tokens: Map<string, string>, kind: string, raw: string): string {
  for (const [token, value] of tokens) if (value === raw) return token;
  const token = `[${kind}_${[...tokens.keys()].filter((key) => key.startsWith(`[${kind}_`)).length + 1}]`;
  tokens.set(token, raw);
  return token;
}

export function redactText(value: string): RedactionResult {
  const tokens = new Map<string, string>();
  let redacted = value.replace(EMAIL, (raw) => nextToken(tokens, "EMAIL", raw));
  redacted = redacted.replace(STREET_ADDRESS, (raw) => nextToken(tokens, "ADDRESS", raw));
  redacted = redacted.replace(SSN, (raw) => nextToken(tokens, "SSN", raw));
  redacted = redacted.replace(CARD, (raw) => nextToken(tokens, "CARD", raw));
  redacted = redacted.replace(PHONE, (raw) => nextToken(tokens, "PHONE", raw));
  return { value: redacted, tokens };
}

export function restoreTokens<T>(value: T, tokens: ReadonlyMap<string, string>): T {
  if (typeof value === "string") {
    let restored: string = value;
    for (const [token, raw] of tokens) restored = restored.replaceAll(token, raw);
    return restored as T;
  }
  if (Array.isArray(value)) return value.map((entry) => restoreTokens(entry, tokens)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, restoreTokens(entry, tokens)])) as T;
  }
  return value;
}

/** Removes direct identifiers in structured data, preserving non-identifying business facts. */
export function redactStructured<T>(value: T): T {
  if (typeof value === "string") return redactText(value).value as T;
  if (Array.isArray(value)) return value.map((entry) => redactStructured(entry)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactStructured(entry)]),
    ) as T;
  }
  return value;
}

/**
 * External integrations receive only their declared fields. A tool must opt in to
 * every field it needs; accidental new PII fields therefore fail closed.
 */
export function minimizeExternalInput(input: Record<string, unknown>, allowedFields: readonly string[] | undefined): Record<string, unknown> {
  if (!allowedFields) return redactStructured(input);
  return Object.fromEntries(allowedFields.filter((key) => key in input).map((key) => [key, input[key]]));
}
