import type { ComputerOriginPolicy } from "./contracts";

export class ComputerOriginError extends Error {
  constructor(readonly code: "missing_home_url" | "invalid_origin" | "origin_blocked", message: string) {
    super(message);
    this.name = "ComputerOriginError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

export function normalizeOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ComputerOriginError("invalid_origin", "Application origin configuration is invalid"); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new ComputerOriginError("invalid_origin", "Only credential-free HTTP(S) application origins are allowed");
  }
  if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ComputerOriginError("invalid_origin", "Non-local application origins must use HTTPS");
  }
  return url.origin;
}

function uniqueOrigins(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeOrigin))].sort();
}

function narrowed(configured: string[], restriction: string[]): string[] {
  if (restriction.length === 0) return configured;
  const allowed = new Set(restriction);
  return configured.filter((origin) => allowed.has(origin));
}

/** Origin authority is configuration-derived only. Task/model payload URLs are never
 * accepted, so a model cannot broaden this set. Profile restrictions may narrow the
 * account configuration but cannot add an origin. */
export function deriveComputerOriginPolicy(
  accountMetadataValue: unknown,
  restrictionsValue: unknown,
): ComputerOriginPolicy {
  const metadata = record(accountMetadataValue);
  const restrictions = record(restrictionsValue);
  const homeUrl = typeof metadata.homeUrl === "string" ? metadata.homeUrl.trim() : "";
  if (!homeUrl) throw new ComputerOriginError("missing_home_url", "The application account has no governed homeUrl");
  const homeOrigin = normalizeOrigin(homeUrl);
  const configuredApp = uniqueOrigins([homeOrigin, ...strings(metadata.allowedOrigins)]);
  const configuredAuth = uniqueOrigins(strings(metadata.authOrigins));
  const restrictedApp = uniqueOrigins(strings(restrictions.allowedOrigins));
  const restrictedAuth = uniqueOrigins(strings(restrictions.allowedAuthOrigins));
  const allowedOrigins = narrowed(configuredApp, restrictedApp);
  const authOrigins = narrowed(configuredAuth, restrictedAuth);
  if (!allowedOrigins.includes(homeOrigin)) {
    throw new ComputerOriginError("origin_blocked", "The auth-profile restrictions exclude the configured application home origin");
  }
  return Object.freeze({ homeUrl, allowedOrigins: Object.freeze(allowedOrigins), authOrigins: Object.freeze(authOrigins) });
}

export function assertAllowedUrl(value: string, policy: ComputerOriginPolicy): string {
  if (value === "about:blank") return value;
  const origin = normalizeOrigin(value);
  if (!policy.allowedOrigins.includes(origin) && !policy.authOrigins.includes(origin)) {
    throw new ComputerOriginError("origin_blocked", `Navigation to ${origin} is outside the governed application boundary`);
  }
  return value;
}

export function safePageUrl(value: string): string {
  if (value === "about:blank") return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return "invalid-url"; }
}
