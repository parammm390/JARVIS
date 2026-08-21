import { tenantIntegrations, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { readAwsSecretReference } from "./secrets";

export type TenantCredentialProvider =
  | "quickbooks"
  | "vapi"
  | "stripe"
  | "docusign"
  | "ghl"
  | "gmail"
  | "resend"
  | "meta_ads"
  | "google_ads";

export interface QuickBooksCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
  environment: "sandbox" | "production";
}

export interface VapiCredentials {
  apiKey: string;
  phoneNumberId: string;
  assistantId: string;
  assistantIds?: Readonly<Record<string, string>>;
  webhookSecret?: string;
}

export interface StripeCredentials {
  secretKey: string;
  webhookSecret?: string;
  returnUrlBase?: string;
}

export interface DocusignCredentials {
  integrationKey: string;
  userId: string;
  accountId: string;
  privateKey: string;
  baseUrl: string;
  connectSecret?: string;
}

export interface GhlCredentials {
  apiKey: string;
  locationId?: string;
  waterTestCalendarId?: string;
}

export interface GmailCredentials {
  user: string;
  appPassword: string;
}

export interface ResendCredentials {
  apiKey: string;
  fromAddress: string;
  allowlistOwnerEmail?: string;
}

export interface MetaAdsCredentials {
  accessToken: string;
  accountId: string;
}

export interface GoogleAdsCredentials {
  developerToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  customerId: string;
}

export interface TenantCredentialMap {
  quickbooks: QuickBooksCredentials;
  vapi: VapiCredentials;
  stripe: StripeCredentials;
  docusign: DocusignCredentials;
  ghl: GhlCredentials;
  gmail: GmailCredentials;
  resend: ResendCredentials;
  meta_ads: MetaAdsCredentials;
  google_ads: GoogleAdsCredentials;
}

export interface TenantCredentialContext<P extends TenantCredentialProvider = TenantCredentialProvider> {
  readonly tenantId: string;
  readonly provider: P;
  readonly source: "tenant-secret" | "legacy-env" | "system-env" | "test";
  readonly integration: {
    readonly id: string | null;
    readonly capability: string | null;
    readonly binding: string;
    readonly mode: string;
  };
  readonly reference: {
    readonly secretProvider: "aws-secrets-manager" | "legacy-env" | "system-env" | "test";
    readonly id: string;
    readonly version: string | null;
  };
  readonly credentials: Readonly<TenantCredentialMap[P]>;
  /** Contains tenant/provider/reference/version only; safe as an in-memory cache key. */
  readonly cacheKey: string;
}

export type TenantCredentialErrorCode =
  | "integration_not_bound"
  | "missing_reference"
  | "invalid_reference"
  | "ambiguous_integration"
  | "secret_unavailable"
  | "invalid_credentials"
  | "legacy_not_allowed"
  | "system_not_allowed";

export class TenantCredentialError extends Error {
  constructor(
    readonly code: TenantCredentialErrorCode,
    readonly provider: TenantCredentialProvider,
    readonly tenantId: string,
    message: string,
  ) {
    super(message);
    this.name = "TenantCredentialError";
  }
}

interface IntegrationReference {
  id: string;
  capability: string;
  binding: string;
  mode: string;
  config: unknown;
  credentialProvider: "aws-secrets-manager" | "legacy-env" | null;
  credentialRef: string | null;
  credentialVersion: string | null;
  credentialMetadata: unknown;
}

type SecretReader = (reference: string, version?: string) => Promise<Record<string, string>>;
let secretReaderOverride: SecretReader | null = null;

interface CachedSecret {
  expiresAt: number;
  value: Record<string, string>;
}
const secretCache = new Map<string, CachedSecret>();
const secretInflight = new Map<string, Promise<Record<string, string>>>();

const PROVIDER_BINDINGS: Record<TenantCredentialProvider, readonly string[]> = {
  quickbooks: ["quickbooks"],
  vapi: ["vapi"],
  stripe: ["stripe"],
  docusign: ["docusign"],
  ghl: ["ghl"],
  gmail: ["gmail"],
  resend: ["resend"],
  meta_ads: ["meta_ads", "meta"],
  google_ads: ["google_ads"],
};

const PROVIDER_CAPABILITIES: Partial<Record<TenantCredentialProvider, readonly string[]>> = {
  quickbooks: ["accounting"],
  vapi: ["communications"],
  stripe: ["payments"],
  docusign: ["esign"],
  ghl: ["crm", "scheduling"],
  gmail: ["communications"],
  resend: ["communications"],
  meta_ads: ["marketing"],
  google_ads: ["marketing"],
};

const LEGACY_BINDING_ENV: Partial<Record<TenantCredentialProvider, readonly [string, string]>> = {
  quickbooks: ["ACCOUNTING_BINDING", "quickbooks"],
  vapi: ["COMMUNICATIONS_BINDING", "vapi"],
  stripe: ["PAYMENTS_BINDING", "stripe"],
  docusign: ["ESIGN_BINDING", "docusign"],
  ghl: ["CRM_BINDING", "ghl"],
  gmail: ["EMAIL_BINDING", "gmail"],
  meta_ads: ["MARKETING_BINDING", "meta_ads"],
  google_ads: ["MARKETING_BINDING", "google_ads"],
};

function listEnv(name: string): Set<string> {
  return new Set((process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

function legacyTenantAllowed(tenantId: string): boolean {
  return listEnv("FINNOR_LEGACY_CREDENTIAL_TENANT_IDS").has(tenantId);
}

function legacyBindingEnabled(provider: TenantCredentialProvider): boolean {
  const entry = LEGACY_BINDING_ENV[provider];
  if (!entry) return false;
  const configured = process.env[entry[0]]?.trim();
  if ((provider === "meta_ads" || provider === "google_ads") && configured === "ads") return true;
  return configured === entry[1];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function integrationRoutingMetadata(integration: Pick<IntegrationReference, "config" | "credentialMetadata">): Record<string, unknown> {
  const config = object(integration.config);
  const metadata = object(integration.credentialMetadata);
  const keys = ["address", "fromAddress", "user", "phoneNumberId", "locationId", "adapter", "accountId", "realmId", "customerId"] as const;
  return Object.fromEntries(keys.flatMap((key) => {
    const preferred = metadata[key];
    const fallback = config[key];
    const value = typeof preferred === "string" && preferred.trim()
      ? preferred.trim()
      : typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
    return value ? [[key, value]] : [];
  }));
}

function hasSensitiveMetadataKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveMetadataKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => /secret|password|access[\s_-]?token|refresh[\s_-]?token|private[\s_-]?key|api[\s_-]?key|credential/i.test(key) || hasSensitiveMetadataKey(nested),
  );
}

function stringField(values: Record<string, unknown>, aliases: readonly string[], required = true): string | undefined {
  for (const alias of aliases) {
    const value = values[alias];
    if (typeof value === "string" && value.trim()) return value;
  }
  if (required) throw new Error(`missing ${aliases[0]}`);
  return undefined;
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value === "string") {
    try {
      return stringRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
  return entries.length > 0 ? Object.freeze(Object.fromEntries(entries)) : undefined;
}

function validateCredentials<P extends TenantCredentialProvider>(provider: P, raw: Record<string, unknown>): TenantCredentialMap[P] {
  let credentials: TenantCredentialMap[TenantCredentialProvider];
  switch (provider) {
    case "quickbooks": {
      const environment = stringField(raw, ["environment", "QUICKBOOKS_ENVIRONMENT"], false) ?? "sandbox";
      if (environment !== "sandbox" && environment !== "production") throw new Error("invalid environment");
      credentials = {
        clientId: stringField(raw, ["clientId", "QUICKBOOKS_CLIENT_ID"])!,
        clientSecret: stringField(raw, ["clientSecret", "QUICKBOOKS_CLIENT_SECRET"])!,
        refreshToken: stringField(raw, ["refreshToken", "QUICKBOOKS_REFRESH_TOKEN"])!,
        realmId: stringField(raw, ["realmId", "QUICKBOOKS_REALM_ID"])!,
        environment,
      };
      break;
    }
    case "vapi":
      credentials = {
        apiKey: stringField(raw, ["apiKey", "VAPI_API_KEY"])!,
        phoneNumberId: stringField(raw, ["phoneNumberId", "VAPI_PHONE_NUMBER_ID"])!,
        assistantId: stringField(raw, ["assistantId", "VAPI_ASSISTANT_ID"])!,
        assistantIds: stringRecord(raw.assistantIds ?? raw.VAPI_ASSISTANT_IDS),
        webhookSecret: stringField(raw, ["webhookSecret", "VAPI_WEBHOOK_SECRET"], false),
      };
      break;
    case "stripe":
      credentials = {
        secretKey: stringField(raw, ["secretKey", "STRIPE_SECRET_KEY"])!,
        webhookSecret: stringField(raw, ["webhookSecret", "STRIPE_WEBHOOK_SECRET"], false),
        returnUrlBase: stringField(raw, ["returnUrlBase", "PAYMENTS_RETURN_URL_BASE"], false),
      };
      break;
    case "docusign":
      credentials = {
        integrationKey: stringField(raw, ["integrationKey", "DOCUSIGN_INTEGRATION_KEY"])!,
        userId: stringField(raw, ["userId", "DOCUSIGN_USER_ID"])!,
        accountId: stringField(raw, ["accountId", "DOCUSIGN_ACCOUNT_ID"])!,
        privateKey: stringField(raw, ["privateKey", "DOCUSIGN_PRIVATE_KEY"])!,
        baseUrl: stringField(raw, ["baseUrl", "DOCUSIGN_BASE_URL"], false) ?? "https://demo.docusign.net",
        connectSecret: stringField(raw, ["connectSecret", "DOCUSIGN_CONNECT_SECRET"], false),
      };
      break;
    case "ghl":
      credentials = {
        apiKey: stringField(raw, ["apiKey", "GOHIGHLEVEL_API_KEY"])!,
        locationId: stringField(raw, ["locationId", "GHL_LOCATION_ID"], false),
        waterTestCalendarId: stringField(raw, ["waterTestCalendarId", "GHL_WATER_TEST_CALENDAR_ID"], false),
      };
      break;
    case "gmail":
      credentials = {
        user: stringField(raw, ["user", "fromAddress", "GMAIL_USER"])!,
        appPassword: stringField(raw, ["appPassword", "GMAIL_APP_PASSWORD"])!,
      };
      break;
    case "resend":
      credentials = {
        apiKey: stringField(raw, ["apiKey", "RESEND_API_KEY"])!,
        fromAddress: stringField(raw, ["fromAddress", "RESEND_FROM_ADDRESS"], false) ?? "Finnor <notifications@finnorai.com>",
        allowlistOwnerEmail: stringField(raw, ["allowlistOwnerEmail", "RESEND_ALLOWLIST_OWNER_EMAIL"], false),
      };
      break;
    case "meta_ads":
      credentials = {
        accessToken: stringField(raw, ["accessToken", "META_ADS_ACCESS_TOKEN"])!,
        accountId: stringField(raw, ["accountId", "META_ADS_ACCOUNT_ID"])!,
      };
      break;
    case "google_ads":
      credentials = {
        developerToken: stringField(raw, ["developerToken", "GOOGLE_ADS_DEVELOPER_TOKEN"])!,
        refreshToken: stringField(raw, ["refreshToken", "GOOGLE_ADS_REFRESH_TOKEN"])!,
        clientId: stringField(raw, ["clientId", "GOOGLE_ADS_CLIENT_ID"])!,
        clientSecret: stringField(raw, ["clientSecret", "GOOGLE_ADS_CLIENT_SECRET"])!,
        customerId: stringField(raw, ["customerId", "GOOGLE_ADS_CUSTOMER_ID"])!,
      };
      break;
  }
  return Object.freeze(credentials) as TenantCredentialMap[P];
}

function legacyValues(provider: TenantCredentialProvider): Record<string, unknown> {
  const names: Record<TenantCredentialProvider, readonly string[]> = {
    quickbooks: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REFRESH_TOKEN", "QUICKBOOKS_REALM_ID", "QUICKBOOKS_ENVIRONMENT"],
    vapi: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID", "VAPI_ASSISTANT_IDS", "VAPI_WEBHOOK_SECRET"],
    stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PAYMENTS_RETURN_URL_BASE"],
    docusign: ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY", "DOCUSIGN_BASE_URL", "DOCUSIGN_CONNECT_SECRET"],
    ghl: ["GOHIGHLEVEL_API_KEY", "GHL_LOCATION_ID", "GHL_WATER_TEST_CALENDAR_ID"],
    gmail: ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
    resend: ["RESEND_API_KEY", "RESEND_FROM_ADDRESS", "RESEND_ALLOWLIST_OWNER_EMAIL"],
    meta_ads: ["META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID"],
    google_ads: ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_CUSTOMER_ID"],
  };
  return Object.fromEntries(names[provider].map((name) => [name, process.env[name]]));
}

function context<P extends TenantCredentialProvider>(params: {
  tenantId: string;
  provider: P;
  source: TenantCredentialContext<P>["source"];
  integration?: IntegrationReference;
  secretProvider: TenantCredentialContext<P>["reference"]["secretProvider"];
  reference: string;
  version?: string | null;
  credentials: TenantCredentialMap[P];
}): TenantCredentialContext<P> {
  const integration = params.integration;
  return Object.freeze({
    tenantId: params.tenantId,
    provider: params.provider,
    source: params.source,
    integration: Object.freeze({
      id: integration?.id ?? null,
      capability: integration?.capability ?? null,
      binding: integration?.binding ?? params.provider,
      mode: integration?.mode ?? "system",
    }),
    reference: Object.freeze({ secretProvider: params.secretProvider, id: params.reference, version: params.version ?? null }),
    credentials: params.credentials,
    cacheKey: `${params.tenantId}:${params.provider}:${params.secretProvider}:${params.reference}:${params.version ?? "current"}`,
  });
}

async function integrationForProvider(tenantId: string, provider: TenantCredentialProvider): Promise<IntegrationReference | null> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .select({
        id: tenantIntegrations.id,
        capability: tenantIntegrations.capability,
        binding: tenantIntegrations.binding,
        mode: tenantIntegrations.mode,
        config: tenantIntegrations.config,
        credentialProvider: tenantIntegrations.credentialProvider,
        credentialRef: tenantIntegrations.credentialRef,
        credentialVersion: tenantIntegrations.credentialVersion,
        credentialMetadata: tenantIntegrations.credentialMetadata,
      })
      .from(tenantIntegrations)
      .where(eq(tenantIntegrations.tenantId, tenantId)),
  );
  const matches = rows.filter((row) => {
    const binding = row.binding.trim().toLowerCase();
    if (PROVIDER_BINDINGS[provider].includes(binding)) return true;
    return binding === "ads" && (provider === "meta_ads" || provider === "google_ads") && integrationRoutingMetadata(row).adapter === provider;
  });
  if (matches.length === 0) {
    const capabilities = PROVIDER_CAPABILITIES[provider] ?? [];
    if (rows.some((row) => capabilities.includes(row.capability))) {
      // A tenant capability row is authoritative. An emulator/native/different
      // provider override must never fall through to a process-global credential.
      throw new TenantCredentialError("integration_not_bound", provider, tenantId, `${provider} is not bound for this tenant`);
    }
  }
  if (matches.length <= 1) return matches[0] ?? null;
  const identities = new Set(matches.map((row) => `${row.credentialProvider}:${row.credentialRef}:${row.credentialVersion}`));
  if (identities.size > 1) {
    throw new TenantCredentialError("ambiguous_integration", provider, tenantId, `Multiple ${provider} integrations have conflicting credential references`);
  }
  return matches[0]!;
}

function tenantBoundAwsReference(reference: string, tenantId: string): boolean {
  const prefix = (process.env.FINNOR_TENANT_SECRET_PREFIX ?? "finnor/tenants").replace(/^\/+|\/+$/g, "");
  const tenantPath = `${prefix}/${tenantId}/`;
  return reference.startsWith(tenantPath) || reference.includes(`:secret:${tenantPath}`);
}

async function cachedSecret(cacheKey: string, reference: string, version?: string | null): Promise<Record<string, string>> {
  const now = Date.now();
  const cached = secretCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const inflight = secretInflight.get(cacheKey);
  if (inflight) return inflight;
  const read = (secretReaderOverride ?? readAwsSecretReference)(reference, version ?? undefined)
    .then((value) => {
      const configured = Number(process.env.TENANT_CREDENTIAL_CACHE_MS ?? 60_000);
      const ttl = Number.isFinite(configured) && configured >= 0 ? Math.min(configured, 300_000) : 60_000;
      secretCache.set(cacheKey, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => secretInflight.delete(cacheKey));
  secretInflight.set(cacheKey, read);
  return read;
}

function legacyContext<P extends TenantCredentialProvider>(tenantId: string, provider: P, integration?: IntegrationReference): TenantCredentialContext<P> {
  try {
    const credentials = validateCredentials(provider, {
      ...legacyValues(provider),
      ...(integration ? integrationRoutingMetadata(integration) : {}),
    });
    return context({
      tenantId,
      provider,
      source: "legacy-env",
      integration,
      secretProvider: "legacy-env",
      reference: `legacy-env:${provider}`,
      credentials,
    });
  } catch {
    throw new TenantCredentialError("invalid_credentials", provider, tenantId, `${provider} legacy credentials are incomplete or invalid`);
  }
}

export interface GovernedCredentialReference {
  credentialProvider: "aws-secrets-manager" | "legacy-env" | null;
  credentialRef: string | null;
  credentialVersion: string | null;
  /** Public routing/account values such as a Vapi phone-number id or QuickBooks
   * realm id. Secret-shaped keys are rejected before this is merged. */
  publicMetadata?: Record<string, unknown>;
  integration?: {
    id: string;
    capability: string;
    binding: string;
    mode?: string;
  };
}

/** Resolve a governed identity/auth-profile reference through the same secret reader,
 * validation, cache, tenant namespace, and legacy allowlist as tenant integrations.
 * This is runtime-only: callers must not serialize the returned context. */
export async function resolveCredentialReferenceContext<P extends TenantCredentialProvider>(
  tenantId: string,
  provider: P,
  reference: GovernedCredentialReference,
): Promise<TenantCredentialContext<P>> {
  const metadata = reference.publicMetadata ?? {};
  if (hasSensitiveMetadataKey(metadata)) {
    throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} public credential metadata contains a forbidden secret-shaped key`);
  }
  if (!reference.credentialProvider && !reference.credentialRef) {
    // Compatibility is restricted to an explicit tenant integration. The legacy
    // resolver never accepts an unbound process-wide credential. Canonical public
    // routing remains authoritative over the integration's legacy default account.
    const resolved = await resolveTenantCredentialContext(tenantId, provider);
    if (Object.keys(metadata).length === 0) return resolved;
    return context({
      tenantId,
      provider,
      source: resolved.source,
      integration: reference.integration ? {
        id: reference.integration.id,
        capability: reference.integration.capability,
        binding: reference.integration.binding,
        mode: reference.integration.mode ?? "real",
        config: {},
        credentialProvider: null,
        credentialRef: null,
        credentialVersion: null,
        credentialMetadata: metadata,
      } : undefined,
      secretProvider: resolved.reference.secretProvider,
      reference: resolved.reference.id,
      version: resolved.reference.version,
      credentials: validateCredentials(provider, { ...resolved.credentials, ...metadata }),
    });
  }
  if (!reference.credentialProvider || !reference.credentialRef) {
    throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} has a partial governed credential reference`);
  }
  const integration: IntegrationReference | undefined = reference.integration ? {
    id: reference.integration.id,
    capability: reference.integration.capability,
    binding: reference.integration.binding,
    mode: reference.integration.mode ?? "real",
    config: {},
    credentialProvider: reference.credentialProvider,
    credentialRef: reference.credentialRef,
    credentialVersion: reference.credentialVersion,
    credentialMetadata: metadata,
  } : undefined;

  if (reference.credentialProvider === "legacy-env") {
    if (reference.credentialRef !== `legacy-env:${provider}`) {
      throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} has an invalid legacy credential reference`);
    }
    if (!legacyTenantAllowed(tenantId)) {
      throw new TenantCredentialError("legacy_not_allowed", provider, tenantId, `${provider} legacy credentials are not allowed for this tenant`);
    }
    try {
      return context({
        tenantId,
        provider,
        source: "legacy-env",
        integration,
        secretProvider: "legacy-env",
        reference: reference.credentialRef,
        credentials: validateCredentials(provider, { ...legacyValues(provider), ...metadata }),
      });
    } catch (error) {
      if (error instanceof TenantCredentialError) throw error;
      throw new TenantCredentialError("invalid_credentials", provider, tenantId, `${provider} legacy credentials are incomplete or invalid`);
    }
  }

  if (!tenantBoundAwsReference(reference.credentialRef, tenantId)) {
    throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} credential reference is outside the tenant namespace`);
  }
  const cacheKey = `${tenantId}:${provider}:aws-secrets-manager:${reference.credentialRef}:${reference.credentialVersion ?? "current"}`;
  let secret: Record<string, string>;
  try {
    secret = await cachedSecret(cacheKey, reference.credentialRef, reference.credentialVersion);
  } catch {
    throw new TenantCredentialError("secret_unavailable", provider, tenantId, `${provider} credential secret could not be read`);
  }
  try {
    return context({
      tenantId,
      provider,
      source: "tenant-secret",
      integration,
      secretProvider: "aws-secrets-manager",
      reference: reference.credentialRef,
      version: reference.credentialVersion,
      // Public account routing (for example a selected phoneNumberId/realmId) is
      // allowed to override the secret bundle's default account. Secret-shaped keys
      // were rejected above, so this cannot replace authentication material.
      credentials: validateCredentials(provider, { ...secret, ...metadata }),
    });
  } catch {
    throw new TenantCredentialError("invalid_credentials", provider, tenantId, `${provider} credential secret has an invalid shape`);
  }
}

/** Resolve tenant -> active integration -> reference -> secret provider -> typed
 * immutable context. No process.env mutation occurs, and cache/single-flight keys
 * include tenant, provider, reference, and rotation version. */
export async function resolveTenantCredentialContext<P extends TenantCredentialProvider>(
  tenantId: string,
  provider: P,
): Promise<TenantCredentialContext<P>> {
  const integration = await integrationForProvider(tenantId, provider);
  if (!integration) {
    if (legacyTenantAllowed(tenantId) && legacyBindingEnabled(provider)) {
      try {
        return legacyContext(tenantId, provider);
      } catch (error) {
        // The old MARKETING_BINDING=ads switch selected whichever one of Meta or
        // Google was actually configured. Absence of the other provider remains
        // "not bound"; an explicit provider binding still reports invalid creds.
        if ((provider === "meta_ads" || provider === "google_ads") && process.env.MARKETING_BINDING === "ads") {
          throw new TenantCredentialError("integration_not_bound", provider, tenantId, `${provider} is not bound for this tenant`);
        }
        throw error;
      }
    }
    throw new TenantCredentialError("integration_not_bound", provider, tenantId, `${provider} is not bound for this tenant`);
  }

  if (!integration.credentialProvider && !integration.credentialRef) {
    if (legacyTenantAllowed(tenantId)) return legacyContext(tenantId, provider, integration);
    throw new TenantCredentialError("missing_reference", provider, tenantId, `${provider} has no tenant credential reference`);
  }
  if (!integration.credentialProvider || !integration.credentialRef) {
    throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} has a partial credential reference`);
  }

  if (integration.credentialProvider === "legacy-env") {
    if (integration.credentialRef !== `legacy-env:${provider}`) {
      throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} has an invalid legacy credential reference`);
    }
    if (!legacyTenantAllowed(tenantId)) {
      throw new TenantCredentialError("legacy_not_allowed", provider, tenantId, `${provider} legacy credentials are not allowed for this tenant`);
    }
    return legacyContext(tenantId, provider, integration);
  }

  if (!tenantBoundAwsReference(integration.credentialRef, tenantId)) {
    throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} credential reference is outside the tenant namespace`);
  }
  if (hasSensitiveMetadataKey(integration.credentialMetadata)) {
    throw new TenantCredentialError("invalid_reference", provider, tenantId, `${provider} credential metadata contains a forbidden secret-shaped key`);
  }

  const cacheKey = `${tenantId}:${provider}:aws-secrets-manager:${integration.credentialRef}:${integration.credentialVersion ?? "current"}`;
  let secret: Record<string, string>;
  try {
    secret = await cachedSecret(cacheKey, integration.credentialRef, integration.credentialVersion);
  } catch {
    throw new TenantCredentialError("secret_unavailable", provider, tenantId, `${provider} credential secret could not be read`);
  }
  try {
    const credentials = validateCredentials(provider, { ...secret, ...integrationRoutingMetadata(integration) });
    return context({
      tenantId,
      provider,
      source: "tenant-secret",
      integration,
      secretProvider: "aws-secrets-manager",
      reference: integration.credentialRef,
      version: integration.credentialVersion,
      credentials,
    });
  } catch {
    throw new TenantCredentialError("invalid_credentials", provider, tenantId, `${provider} credential secret has an invalid shape`);
  }
}

/** Explicit system-level credential path. Currently Resend is the only safe use:
 * Finnor-owned notification mail may intentionally share one sender account. */
export function resolveSystemCredentialContext(tenantId: string, provider: "resend"): TenantCredentialContext<"resend"> {
  if (!listEnv("FINNOR_SYSTEM_CREDENTIAL_PROVIDERS").has("resend")) {
    throw new TenantCredentialError("system_not_allowed", "resend", tenantId, "resend is not enabled as a system credential");
  }
  try {
    return context({
      tenantId,
      provider: "resend",
      source: "system-env",
      secretProvider: "system-env",
      reference: "system-env:resend",
      credentials: validateCredentials("resend", legacyValues("resend")),
    });
  } catch {
    throw new TenantCredentialError("invalid_credentials", "resend", tenantId, "resend system credentials are incomplete or invalid");
  }
}

/** Test helper: supplies typed values without environment mutation. */
export function createCredentialContextForTesting<P extends TenantCredentialProvider>(
  tenantId: string,
  provider: P,
  values: Record<string, unknown>,
): TenantCredentialContext<P> {
  return context({
    tenantId,
    provider,
    source: "test",
    secretProvider: "test",
    reference: `test:${tenantId}:${provider}`,
    credentials: validateCredentials(provider, values),
  });
}

export function setTenantSecretReaderForTesting(reader: SecretReader | null): void {
  secretReaderOverride = reader;
  secretCache.clear();
  secretInflight.clear();
}

export function clearTenantCredentialCacheForTesting(): void {
  secretCache.clear();
  secretInflight.clear();
}
