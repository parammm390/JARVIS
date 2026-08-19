import { readFile } from "node:fs/promises";
import { z } from "zod";
import { WorkspaceConfigSchema } from "../apps/api/lib/workspace-config";
import { DeclarativeImportBodySchema } from "@finnor/import-engine";

export const ClientKeySchema = z.string().trim().regex(
  /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/,
  "clientKey must be 3-64 lowercase letters, numbers, underscores, or hyphens",
);

const LocationKeySchema = z.string().trim().regex(
  /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/,
  "location key must be 3-64 lowercase letters, numbers, underscores, or hyphens",
);

function containsSecretShapedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretShapedKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => /secret|password|access[\s_-]?token|refresh[\s_-]?token|private[\s_-]?key|api[\s_-]?key|credential/i.test(key) || containsSecretShapedKey(nested),
  );
}

export const TenantRoleSchema = z.enum(["owner", "dispatcher", "technician"]);
export const CapabilitySchema = z.enum([
  "scheduling", "documents", "inventory", "crm", "communications",
  "esign", "accounting", "payments", "marketing",
]);

export const DEFAULT_INTEGRATIONS = [
  { capability: "crm", binding: "native", mode: "real" },
  { capability: "scheduling", binding: "native", mode: "real" },
  { capability: "inventory", binding: "native", mode: "real" },
  { capability: "documents", binding: "native", mode: "real" },
  { capability: "communications", binding: "emulator", mode: "emulator" },
  { capability: "esign", binding: "emulator", mode: "emulator" },
  { capability: "accounting", binding: "emulator", mode: "emulator" },
  { capability: "payments", binding: "emulator", mode: "emulator" },
  { capability: "marketing", binding: "emulator", mode: "emulator" },
] as const;

const IntegrationSchema = z.object({
  capability: CapabilitySchema,
  binding: z.string().trim().min(1).max(64),
  mode: z.enum(["real", "sandbox", "emulator"]),
  config: z.record(z.unknown()).default({}),
  // Phase 1 descriptive references remain accepted for manifest compatibility.
  // Phase 2's executable provider reference is the typed `credential` field below.
  credentialRefs: z.record(z.string().trim().min(1)).default({}),
  credential: z.object({
    provider: z.enum(["aws-secrets-manager", "legacy-env"]),
    ref: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).default({}),
  }).optional(),
});

const PolicyOverrideSchema = z.object({
  policy: z.record(z.unknown()).optional(),
  requiresConfirmation: z.boolean().optional(),
  confirmationTemplate: z.string().trim().min(1).nullable().optional(),
});

const ImportDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(64),
  source: z.enum(["csv", "json", "jsonl"]),
  definition: DeclarativeImportBodySchema,
  credentialRef: z.string().trim().min(1).optional(),
});

export const ClientManifestSchema = z.object({
  manifestVersion: z.literal(1).default(1),
  clientKey: ClientKeySchema,
  tenant: z.object({
    name: z.string().trim().min(1).max(160),
    timezone: z.string().trim().min(1).max(80).default("America/Chicago"),
    ownerPhone: z.string().trim().min(1).max(40).nullable().optional(),
    settings: z.object({
      isDealerZero: z.boolean().default(false),
      simulatorEnabled: z.boolean().default(false),
      trainingMode: z.boolean().default(false),
    }).default({}),
  }),
  locations: z.array(z.object({
    key: LocationKeySchema,
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    timezone: z.string().trim().min(1).max(80).nullable().optional(),
    active: z.boolean().default(true),
  })).default([]),
  users: z.array(z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    role: TenantRoleSchema,
    displayName: z.string().trim().min(1).max(160).nullable().optional(),
    phoneNumber: z.string().trim().min(1).max(40).nullable().optional(),
    status: z.enum(["active", "suspended"]).default("active"),
  })).default([]),
  // Omission means preserve an existing tenant_settings.workspace_config. A new
  // tenant receives the existing application default, never a parallel config row.
  workspaceConfig: WorkspaceConfigSchema.optional(),
  policyOverrides: z.record(PolicyOverrideSchema).default({}),
  requiredCapabilities: z.array(CapabilitySchema).default([]),
  integrations: z.array(IntegrationSchema).default(DEFAULT_INTEGRATIONS.map((row) => ({ ...row }))),
  credentialRefs: z.record(z.string().trim().min(1)).default({}),
  imports: z.array(ImportDefinitionSchema).default([]),
}).superRefine((manifest, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(manifest.locations.map((location) => location.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["locations"], message: "location keys must be unique" });
  }
  if (!unique(manifest.users.map((user) => user.email))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["users"], message: "user emails must be unique" });
  }
  if (!unique(manifest.integrations.map((integration) => integration.capability))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["integrations"], message: "integration capabilities must be unique" });
  }
  if (!unique(manifest.imports.map((definition) => definition.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imports"], message: "import keys must be unique" });
  }
  manifest.integrations.forEach((integration, index) => {
    if (containsSecretShapedKey(integration.config)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["integrations", index, "config"], message: "integration config cannot contain secret-shaped keys" });
    }
    if (containsSecretShapedKey(integration.credential?.metadata)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["integrations", index, "credential", "metadata"], message: "credential metadata cannot contain secret-shaped keys" });
    }
  });
  const configured = new Set(manifest.integrations.map((integration) => integration.capability));
  for (const required of manifest.requiredCapabilities) {
    if (!configured.has(required)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredCapabilities"], message: `required capability ${required} has no integration definition` });
    }
  }
});

export type ClientManifest = z.infer<typeof ClientManifestSchema>;

export function parseClientManifest(value: unknown): ClientManifest {
  return ClientManifestSchema.parse(value);
}

export async function loadClientManifest(path: string): Promise<ClientManifest> {
  return parseClientManifest(JSON.parse(await readFile(path, "utf8")));
}

export function directProvisionManifest(input: {
  clientKey: string;
  name: string;
  ownerEmail: string;
  timezone?: string;
  reviewLinkUrl?: string;
  trainingMode?: boolean;
}): ClientManifest {
  return parseClientManifest({
    clientKey: input.clientKey,
    tenant: { name: input.name, timezone: input.timezone, settings: { trainingMode: input.trainingMode ?? false } },
    users: [{ email: input.ownerEmail, role: "owner" }],
    policyOverrides: input.reviewLinkUrl
      ? { create_review_request: { policy: { review_link_url: input.reviewLinkUrl } } }
      : {},
  });
}
