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

const ManifestKeySchema = LocationKeySchema;
const EmailSchema = z.string().trim().email().transform((email) => email.toLowerCase());
const DisplayNameSchema = z.string().trim().min(1).max(160);
const AliasTextSchema = z.string().trim().min(1).max(160);

export const OrgUnitTypeSchema = z.enum(["team", "department"]);
export const TenantRoleSchema = z.enum(["owner", "dispatcher", "technician"]);
export const ExternalOrganizationTypeSchema = z.enum([
  "supplier", "vendor", "distributor", "partner", "contractor", "agency", "other",
]);
export const PartyAliasTypeSchema = z.enum([
  "employee", "team", "location", "external_organization", "external_contact",
]);
export const EmployeeRelationshipTypeSchema = z.enum(["manager", "backup", "assistant"]);

const OrgUnitSchema = z.object({
  key: ManifestKeySchema,
  name: DisplayNameSchema,
  kind: OrgUnitTypeSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  locationKey: ManifestKeySchema.nullable().optional(),
  active: z.boolean().default(true),
}).strict();

const MembershipSchema = z.object({
  employeeEmail: EmailSchema,
  orgUnitKey: ManifestKeySchema,
  membershipRole: z.string().trim().min(1).max(80).nullable().optional(),
  isPrimary: z.boolean().default(false),
  active: z.boolean().default(true),
}).strict();

const EmployeeRelationshipSchema = z.object({
  subjectEmployeeEmail: EmailSchema,
  relatedEmployeeEmail: EmailSchema,
  relationshipType: EmployeeRelationshipTypeSchema,
  active: z.boolean().default(true),
}).strict().superRefine((relationship, ctx) => {
  if (relationship.subjectEmployeeEmail === relationship.relatedEmployeeEmail) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relatedEmployeeEmail"], message: "an employee relationship cannot target the same employee" });
  }
});

const PartyAliasSchema = z.object({
  key: ManifestKeySchema,
  partyType: PartyAliasTypeSchema,
  partyKey: z.string().trim().min(1).max(160),
  alias: AliasTextSchema,
  active: z.boolean().default(true),
}).strict();

const ExternalOrganizationSchema = z.object({
  key: ManifestKeySchema,
  name: DisplayNameSchema,
  kind: ExternalOrganizationTypeSchema.optional(),
  businessEmail: EmailSchema.nullable().optional(),
  businessPhone: z.string().trim().min(1).max(40).nullable().optional(),
  active: z.boolean().default(true),
}).strict();

const ExternalContactSchema = z.object({
  key: ManifestKeySchema,
  name: DisplayNameSchema,
  externalOrganizationKey: ManifestKeySchema.nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  businessEmail: EmailSchema.nullable().optional(),
  businessPhone: z.string().trim().min(1).max(40).nullable().optional(),
  active: z.boolean().default(true),
}).strict();

const ManifestUserSchema = z.object({
  email: EmailSchema,
  role: TenantRoleSchema,
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
  phoneNumber: z.string().trim().min(1).max(40).nullable().optional(),
  status: z.enum(["active", "suspended"]).default("active"),
  orgUnitKeys: z.array(ManifestKeySchema).optional(),
  locationKey: ManifestKeySchema.nullable().optional(),
}).strict();

function containsSecretShapedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretShapedKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => /secret|password|(?:access|refresh)?[\s_-]?token|private[\s_-]?key|api[\s_-]?key|credential/i.test(key) || containsSecretShapedKey(nested),
  );
}

const SafeReferenceSchema = z.string().trim().min(1).max(2048).refine(
  (value) => !/[\s?#]/.test(value) && !/:\/\/[^/]*@/.test(value),
  "references must be opaque names/paths without embedded credentials or URL query material",
);

const SafeSourceRefSchema = z.string().trim().min(1).max(2048).refine(
  (value) => !/[?#]/.test(value) && !/:\/\/[^/]*@/.test(value),
  "sourceRef cannot contain URL credentials, query parameters, or fragments",
);

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
  credentialRefs: z.record(SafeReferenceSchema).default({}),
  credential: z.object({
    provider: z.enum(["aws-secrets-manager", "legacy-env"]),
    ref: SafeReferenceSchema,
    version: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).default({}),
  }).optional(),
});

const ProviderKeySchema = z.string().trim().regex(
  /^[a-z0-9][a-z0-9_-]{0,62}$/,
  "provider/application keys must be lowercase letters, numbers, underscores, or hyphens",
);
const PurposeSchema = z.string().trim().min(1).max(120).default("default");
const CapabilityListSchema = z.array(z.string().trim().min(1).max(120)).default([]);

export const CredentialReferenceSchema = z.object({
  provider: z.enum(["aws-secrets-manager", "legacy-env"]),
  ref: SafeReferenceSchema,
  version: z.string().trim().min(1).optional(),
}).strict();

const AuthProfileCredentialReferenceSchema = z.object({
  provider: z.enum(["aws-secrets-manager", "os-keychain", "legacy-env"]),
  ref: SafeReferenceSchema,
  version: z.string().trim().min(1).optional(),
}).strict();

export const IdentityPrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("employee"), employeeEmail: EmailSchema }).strict(),
  z.object({ type: z.literal("team"), orgUnitKey: ManifestKeySchema }).strict(),
  z.object({ type: z.literal("location"), locationKey: ManifestKeySchema }).strict(),
  z.object({ type: z.literal("tenant") }).strict(),
]);

const CommunicationIdentitySchema = z.object({
  key: ManifestKeySchema,
  provider: ProviderKeySchema,
  channel: z.enum(["email", "sms", "voice", "chat", "calendar"]),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  providerIdentityRef: SafeReferenceSchema.nullable().optional(),
  status: z.enum(["active", "disabled", "suspended"]).default("active"),
  capabilities: CapabilityListSchema,
  credential: CredentialReferenceSchema.optional(),
  authProfileRef: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,126}[a-z0-9]$/).optional(),
}).strict().refine(
  (identity) => Boolean(identity.address || identity.providerIdentityRef),
  { message: "communication identity requires an address or providerIdentityRef" },
);

const CommunicationIdentityBindingSchema = z.object({
  identityKey: ManifestKeySchema,
  principal: IdentityPrincipalSchema,
  purpose: PurposeSchema,
  priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  status: z.enum(["active", "disabled"]).default("active"),
}).strict();

const ApplicationAccountSchema = z.object({
  key: ManifestKeySchema,
  application: ProviderKeySchema,
  provider: ProviderKeySchema,
  displayName: DisplayNameSchema,
  providerAccountRef: SafeReferenceSchema.nullable().optional(),
  status: z.enum(["active", "disabled", "suspended"]).default("active"),
  capabilities: CapabilityListSchema,
  metadata: z.record(z.unknown()).default({}),
}).strict();

const AuthProfileSchema = z.object({
  ref: z.string().trim().regex(
    /^[a-z0-9][a-z0-9_-]{1,126}[a-z0-9]$/,
    "auth profile refs must be 3-128 lowercase letters, numbers, underscores, or hyphens",
  ),
  principal: IdentityPrincipalSchema,
  applicationAccountKey: ManifestKeySchema,
  purpose: PurposeSchema,
  priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  scope: z.record(z.unknown()).default({}),
  credential: AuthProfileCredentialReferenceSchema.optional(),
  authMethod: z.enum(["managed_secret", "oauth2", "browser_profile"]).default("managed_secret"),
  connectionRequired: z.boolean().default(true),
  requiredScopes: z.array(z.string().trim().min(1).max(500)).max(64).default([]),
  status: z.enum(["active", "disabled", "suspended"]).default("active"),
  capabilities: CapabilityListSchema,
  restrictions: z.record(z.unknown()).default({}),
}).strict();

const PolicyOverrideSchema = z.object({
  policy: z.record(z.unknown()).optional(),
  requiresConfirmation: z.boolean().optional(),
  confirmationTemplate: z.string().trim().min(1).nullable().optional(),
});

const ImportDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(64),
  source: z.enum(["csv", "json", "jsonl"]),
  // A durable locator, not source contents. The default factory resolver accepts a
  // local path or file:// URL; deployments may inject a resolver for object storage.
  sourceRef: SafeSourceRefSchema.optional(),
  definition: DeclarativeImportBodySchema,
  credentialRef: SafeReferenceSchema.optional(),
});

export const DEFAULT_UNIVERSAL_ACTION_CONFIG = {
  communication: { allowedChannels: ["internal", "email", "sms", "voice"] as const, allowChannelFallback: false, maxGroupRecipients: 50 },
  acknowledgements: { defaultDeadlineMinutes: 240 },
  delegations: { defaultAckDeadlineMinutes: 240, defaultCompletionHours: 24 },
  scheduling: { externalCalendarMode: "internal_only" as const },
  documentSharing: { allowExternal: false },
};

const UniversalActionConfigSchema = z.object({
  communication: z.object({
    allowedChannels: z.array(z.enum(["internal", "email", "sms", "voice"])).min(1).max(4).default([...DEFAULT_UNIVERSAL_ACTION_CONFIG.communication.allowedChannels]),
    allowChannelFallback: z.boolean().default(false),
    maxGroupRecipients: z.number().int().min(1).max(500).default(50),
  }).strict().default({}),
  acknowledgements: z.object({ defaultDeadlineMinutes: z.number().int().min(1).max(43_200).default(240) }).strict().default({}),
  delegations: z.object({
    defaultAckDeadlineMinutes: z.number().int().min(1).max(43_200).default(240),
    defaultCompletionHours: z.number().int().min(1).max(8_760).default(24),
  }).strict().default({}),
  scheduling: z.object({ externalCalendarMode: z.enum(["internal_only", "when_available"]).default("internal_only") }).strict().default({}),
  documentSharing: z.object({ allowExternal: z.boolean().default(false) }).strict().default({}),
}).strict();

const ConnectionRequirementSchema = z.object({
  authProfileRef: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,126}[a-z0-9]$/),
  provider: ProviderKeySchema,
  required: z.boolean().default(true),
  purposes: z.array(z.string().trim().min(1).max(120)).max(64).default([]),
}).strict();

const ConnectionPolicySchema = z.object({
  failClosedStatuses: z.array(z.enum(["disconnected", "connecting", "expired", "reauth_required", "revoked", "disabled", "misconfigured", "provider_unavailable"]))
    .default(["disconnected", "connecting", "expired", "reauth_required", "revoked", "disabled", "misconfigured", "provider_unavailable"]),
  healthCheckMinutes: z.number().int().min(1).max(1440).default(15),
}).strict();

const ComputerManifestSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.literal("steel").default("steel"),
  allowedOrigins: z.array(z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }, "computer origins must be credential-free HTTPS origins")).max(64).default([]),
  maxSteps: z.number().int().min(1).max(200).default(30),
  timeoutMs: z.number().int().min(10_000).max(1_800_000).default(300_000),
  maxProviderCredits: z.number().int().min(1).max(10_000).default(10),
  maxScreenshots: z.number().int().min(0).max(100).default(10),
  maxArtifacts: z.number().int().min(0).max(500).default(20),
  maxDownloadBytes: z.number().int().min(0).max(1_073_741_824).default(10_485_760),
  maxUploadBytes: z.number().int().min(0).max(1_073_741_824).default(0),
  maxOutputBytes: z.number().int().min(1_024).max(16_777_216).default(131_072),
}).strict();

const DurableLimitSchema = z.object({
  provider: ProviderKeySchema,
  action: z.string().trim().min(1).max(120),
  perMinute: z.number().int().min(1).max(1_000_000),
}).strict();

const RetentionPolicySchema = z.object({
  dataClass: z.enum(["messages", "job_payloads", "computer_artifact_content", "model_records"]),
  retentionDays: z.number().int().min(1).max(3650),
  legalHold: z.boolean().default(false),
}).strict();

export const ClientManifestSchema = z.object({
  manifestVersion: z.union([z.literal(1), z.literal(2)]).default(1),
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
  users: z.array(ManifestUserSchema).default([]),
  // Company World V1 additions. These arrays intentionally remain optional so
  // omission preserves rows managed by an earlier manifest, while an explicit
  // empty array converges that manifest-owned collection inactive.
  orgUnits: z.array(OrgUnitSchema).optional(),
  orgUnitMemberships: z.array(MembershipSchema).optional(),
  employeeRelationships: z.array(EmployeeRelationshipSchema).optional(),
  aliases: z.array(PartyAliasSchema).optional(),
  externalOrganizations: z.array(ExternalOrganizationSchema).optional(),
  externalContacts: z.array(ExternalContactSchema).optional(),
  // Identity/access collections follow the same omission contract as Company World:
  // omitted preserves manifest-owned rows, while an explicit empty array disables
  // the corresponding bindings/profiles safely. Logical keys remain stable across
  // credential rotations.
  communicationIdentities: z.array(CommunicationIdentitySchema).optional(),
  communicationIdentityBindings: z.array(CommunicationIdentityBindingSchema).optional(),
  applicationAccounts: z.array(ApplicationAccountSchema).optional(),
  authProfiles: z.array(AuthProfileSchema).optional(),
  // Phase 5 additions are safe declarative requirements only. Runtime tokens,
  // cookies, passwords, and browser state remain in managed tenant secrets.
  connectionRequirements: z.array(ConnectionRequirementSchema).optional(),
  connectionPolicy: ConnectionPolicySchema.optional(),
  computer: ComputerManifestSchema.optional(),
  durableLimits: z.array(DurableLimitSchema).optional(),
  retentionPolicies: z.array(RetentionPolicySchema).optional(),
  // Tenant Experience Manifest V2 lives in the existing workspace-config aggregate.
  // Omission preserves an existing tenant value; legacy values normalize forward;
  // a new tenant receives the application default, never a parallel config row.
  workspaceConfig: WorkspaceConfigSchema.optional(),
  // Omission preserves an existing tenant's configuration. A new tenant receives
  // DEFAULT_UNIVERSAL_ACTION_CONFIG; this object can never carry provider secrets.
  universalActions: UniversalActionConfigSchema.optional(),
  policyOverrides: z.record(PolicyOverrideSchema).default({}),
  requiredCapabilities: z.array(CapabilitySchema).default([]),
  integrations: z.array(IntegrationSchema).default(DEFAULT_INTEGRATIONS.map((row) => ({ ...row }))),
  credentialRefs: z.record(SafeReferenceSchema).default({}),
  imports: z.array(ImportDefinitionSchema).default([]),
}).strict().superRefine((manifest, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (manifest.manifestVersion === 1 && [
    manifest.connectionRequirements,
    manifest.connectionPolicy,
    manifest.computer,
    manifest.durableLimits,
    manifest.retentionPolicies,
  ].some((value) => value !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manifestVersion"], message: "Phase 5 connection/computer/limit/retention fields require manifestVersion 2" });
  }
  if (manifest.manifestVersion === 1 && (manifest.authProfiles ?? []).some((profile) =>
    profile.authMethod !== "managed_secret" || profile.requiredScopes.length > 0 || profile.connectionRequired !== true)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manifestVersion"], message: "OAuth/browser connection profiles require manifestVersion 2" });
  }
  const orgUnits = manifest.orgUnits ?? [];
  const memberships = manifest.orgUnitMemberships ?? [];
  const relationships = manifest.employeeRelationships ?? [];
  if (!unique(manifest.locations.map((location) => location.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["locations"], message: "location keys must be unique" });
  }
  if (!unique(manifest.users.map((user) => user.email))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["users"], message: "user emails must be unique" });
  }
  if (manifest.orgUnits && !unique(orgUnits.map((unit) => unit.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orgUnits"], message: "org unit keys must be unique" });
  }
  if (manifest.orgUnitMemberships && !unique(memberships.map((membership) => `${membership.orgUnitKey}:${membership.employeeEmail}`))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orgUnitMemberships"], message: "membership identities must be unique" });
  }
  if (manifest.employeeRelationships && !unique(relationships.map((relationship) => `${relationship.subjectEmployeeEmail}:${relationship.relationshipType}:${relationship.relatedEmployeeEmail}`))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["employeeRelationships"], message: "relationship keys must be unique" });
  }
  if (manifest.aliases && !unique(manifest.aliases.map((alias) => alias.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aliases"], message: "alias keys must be unique" });
  }
  if (manifest.externalOrganizations && !unique(manifest.externalOrganizations.map((organization) => organization.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalOrganizations"], message: "external organization keys must be unique" });
  }
  if (manifest.externalContacts && !unique(manifest.externalContacts.map((contact) => contact.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalContacts"], message: "external contact keys must be unique" });
  }
  if (manifest.communicationIdentities && !unique(manifest.communicationIdentities.map((identity) => identity.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationIdentities"], message: "communication identity keys must be unique" });
  }
  if (manifest.communicationIdentityBindings && !unique(manifest.communicationIdentityBindings.map((binding) => `${binding.identityKey}:${JSON.stringify(binding.principal)}:${binding.purpose}`))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationIdentityBindings"], message: "communication identity bindings must be unique" });
  }
  if (manifest.applicationAccounts && !unique(manifest.applicationAccounts.map((account) => account.key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["applicationAccounts"], message: "application account keys must be unique" });
  }
  if (manifest.authProfiles && !unique(manifest.authProfiles.map((profile) => profile.ref))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authProfiles"], message: "auth profile refs must be unique" });
  }
  if (manifest.connectionRequirements && !unique(manifest.connectionRequirements.map((requirement) => requirement.authProfileRef))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["connectionRequirements"], message: "connection requirements must have unique authProfileRefs" });
  }
  if (manifest.durableLimits && !unique(manifest.durableLimits.map((limit) => `${limit.provider}:${limit.action}`))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durableLimits"], message: "durable provider/action limits must be unique" });
  }
  if (manifest.retentionPolicies && !unique(manifest.retentionPolicies.map((policy) => policy.dataClass))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["retentionPolicies"], message: "retention data classes must be unique" });
  }
  if (manifest.authProfiles && !unique(manifest.authProfiles.map((profile) => `${profile.applicationAccountKey}:${JSON.stringify(profile.principal)}:${profile.purpose}`))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authProfiles"], message: "application account/principal/purpose bindings must be unique" });
  }
  const userOrgUnitKeys = manifest.users.flatMap((user) => user.orgUnitKeys ?? []);
  if (!userOrgUnitKeys.every((key) => orgUnits.some((unit) => unit.key === key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["users"], message: "user orgUnitKeys references must resolve to manifest org units" });
  }
  const referencedLocationKeys = [
    ...manifest.users.flatMap((user) => [
      ...(user.locationKey ? [user.locationKey] : []),
    ]),
    ...orgUnits.flatMap((unit) => unit.locationKey ? [unit.locationKey] : []),
  ];
  if (!referencedLocationKeys.every((key) => manifest.locations.some((location) => location.key === key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["users"], message: "user and org unit location references must resolve to manifest locations" });
  }
  if (!memberships.every((membership) => manifest.users.some((user) => user.email === membership.employeeEmail)
    && orgUnits.some((unit) => unit.key === membership.orgUnitKey))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orgUnitMemberships"], message: "memberships must reference manifest users and org units" });
  }
  if (!relationships.every((relationship) => manifest.users.some((user) => user.email === relationship.subjectEmployeeEmail)
    && manifest.users.some((user) => user.email === relationship.relatedEmployeeEmail))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["employeeRelationships"], message: "employee relationships must reference manifest users" });
  }
  const externalOrganizationKeys = new Set((manifest.externalOrganizations ?? []).map((organization) => organization.key));
  if (!(manifest.externalContacts ?? []).every((contact) => !contact.externalOrganizationKey || externalOrganizationKeys.has(contact.externalOrganizationKey))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalContacts"], message: "external contacts must reference manifest external organizations" });
  }
  for (const [index, alias] of (manifest.aliases ?? []).entries()) {
    const valid = alias.partyType === "employee"
      ? manifest.users.some((user) => user.email === alias.partyKey)
      : alias.partyType === "team"
        ? orgUnits.some((unit) => unit.key === alias.partyKey)
        : alias.partyType === "location"
          ? manifest.locations.some((location) => location.key === alias.partyKey)
          : alias.partyType === "external_organization"
            ? externalOrganizationKeys.has(alias.partyKey)
            : (manifest.externalContacts ?? []).some((contact) => contact.key === alias.partyKey);
    if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aliases", index, "partyKey"], message: "alias party reference is not declared in this manifest" });
  }
  const validatePrincipal = (
    principal: z.infer<typeof IdentityPrincipalSchema>,
    path: Array<string | number>,
  ): void => {
    const valid = principal.type === "employee"
      ? manifest.users.some((user) => user.email === principal.employeeEmail)
      : principal.type === "team"
        ? orgUnits.some((unit) => unit.key === principal.orgUnitKey)
        : principal.type === "location"
          ? manifest.locations.some((location) => location.key === principal.locationKey)
          : true;
    if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: "identity principal reference is not declared in this manifest" });
  };
  const identityKeys = new Set((manifest.communicationIdentities ?? []).map((identity) => identity.key));
  for (const [index, binding] of (manifest.communicationIdentityBindings ?? []).entries()) {
    if (!identityKeys.has(binding.identityKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationIdentityBindings", index, "identityKey"], message: "binding must reference a declared communication identity" });
    }
    validatePrincipal(binding.principal, ["communicationIdentityBindings", index, "principal"]);
  }
  const applicationAccountKeys = new Set((manifest.applicationAccounts ?? []).map((account) => account.key));
  const authProfileRefs = new Set((manifest.authProfiles ?? []).map((profile) => profile.ref));
  for (const [index, identity] of (manifest.communicationIdentities ?? []).entries()) {
    if (identity.authProfileRef && !authProfileRefs.has(identity.authProfileRef)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationIdentities", index, "authProfileRef"], message: "communication identity authProfileRef must resolve in this manifest" });
    }
  }
  for (const [index, requirement] of (manifest.connectionRequirements ?? []).entries()) {
    if (!authProfileRefs.has(requirement.authProfileRef)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["connectionRequirements", index, "authProfileRef"], message: "connection requirement must reference a declared auth profile" });
    }
    const profile = (manifest.authProfiles ?? []).find((candidate) => candidate.ref === requirement.authProfileRef);
    const account = (manifest.applicationAccounts ?? []).find((candidate) => candidate.key === profile?.applicationAccountKey);
    if (account && account.provider !== requirement.provider) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["connectionRequirements", index, "provider"], message: "connection requirement provider must match its application account" });
    }
  }
  for (const [index, profile] of (manifest.authProfiles ?? []).entries()) {
    if (!applicationAccountKeys.has(profile.applicationAccountKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authProfiles", index, "applicationAccountKey"], message: "auth profile must reference a declared application account" });
    }
    validatePrincipal(profile.principal, ["authProfiles", index, "principal"]);
  }
  const validateCredential = (
    credential: z.infer<typeof CredentialReferenceSchema> | z.infer<typeof AuthProfileCredentialReferenceSchema> | undefined,
    expectedLegacyProvider: string | null,
    path: Array<string | number>,
  ): void => {
    if (!credential) return;
    if (credential.provider === "legacy-env") {
      if (credential.version !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "version"], message: "legacy-env credential references cannot specify a version" });
      }
      const allowed = /^legacy-env:(quickbooks|vapi|stripe|docusign|ghl|gmail|resend|meta_ads|google_ads)$/.test(credential.ref);
      if (!allowed || (expectedLegacyProvider && credential.ref !== `legacy-env:${expectedLegacyProvider}`)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "ref"], message: "legacy-env credential reference is not allowlisted for this provider" });
      }
      return;
    }
    if (credential.provider === "os-keychain" && credential.version !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "version"], message: "os-keychain credential references cannot specify a version" });
    }
    const namespaced = credential.ref.startsWith("finnor/tenants/{tenantId}/")
      || (credential.ref.startsWith("arn:aws:secretsmanager:") && credential.ref.includes("{tenantId}"));
    if (!namespaced) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "ref"], message: "identity credential references must use the finnor/tenants/{tenantId}/ namespace" });
    }
  };
  for (const [index, identity] of (manifest.communicationIdentities ?? []).entries()) {
    validateCredential(identity.credential, identity.provider, ["communicationIdentities", index, "credential"]);
  }
  for (const [index, account] of (manifest.applicationAccounts ?? []).entries()) {
    if (containsSecretShapedKey(account.metadata)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["applicationAccounts", index, "metadata"], message: "application account metadata cannot contain secret-shaped keys" });
    }
  }
  for (const [index, profile] of (manifest.authProfiles ?? []).entries()) {
    if (containsSecretShapedKey(profile.scope) || containsSecretShapedKey(profile.restrictions)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authProfiles", index], message: "auth profile scope/restrictions cannot contain secret-shaped keys" });
    }
    const account = (manifest.applicationAccounts ?? []).find((candidate) => candidate.key === profile.applicationAccountKey);
    if (profile.authMethod === "oauth2" && account && !["gmail", "google"].includes(account.provider)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authProfiles", index, "authMethod"], message: "OAuth 2.0 is currently implemented only for discovered Google/Gmail providers" });
    }
    if (profile.authMethod === "oauth2" && profile.credential?.provider === "legacy-env") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["authProfiles", index, "credential"], message: "OAuth profiles cannot use legacy environment credentials" });
    }
    validateCredential(profile.credential, account?.provider ?? null, ["authProfiles", index, "credential"]);
  }
  if (!unique(manifest.integrations.map((integration) => integration.capability))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["integrations"], message: "integration capabilities must be unique" });
  }
  if (containsSecretShapedKey(manifest.universalActions)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["universalActions"], message: "universal action configuration cannot contain secret-shaped keys" });
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
    if (integration.credential?.provider === "legacy-env" && !/^legacy-env:(quickbooks|vapi|stripe|docusign|ghl|gmail|resend|meta_ads|google_ads)$/.test(integration.credential.ref)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["integrations", index, "credential", "ref"], message: "legacy-env credential reference is not allowlisted" });
    }
    if (integration.credential?.provider === "aws-secrets-manager" && !(
      integration.credential.ref.startsWith("arn:aws:secretsmanager:")
      || integration.credential.ref.startsWith("finnor/tenants/")
    )) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["integrations", index, "credential", "ref"], message: "AWS credential reference must be a Secrets Manager ARN or finnor/tenants path" });
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
