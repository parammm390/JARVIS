import { z } from "zod";

export const TENANT_EXPERIENCE_VERSION = 2 as const;

export const WorkspaceSurfaceSchema = z.enum(["home", "work", "customers", "schedule", "money", "agents"]);
export const WORKSPACE_SURFACES = WorkspaceSurfaceSchema.options;
export const ExperienceRoleSchema = z.enum(["owner", "dispatcher", "technician"]);
export const EXPERIENCE_ROLES = ExperienceRoleSchema.options;

export const ExperienceMetricKeySchema = z.enum([
  "pending_approvals",
  "collected_usd",
  "overdue_invoice_value",
  "open_leads",
  "runs_in_flight",
  "stuck_runs",
  "stock_risk_items",
  "technician_load",
  "assigned_work_today",
]);
export const EXPERIENCE_METRIC_KEYS = ExperienceMetricKeySchema.options;

export const ExperienceQuickActionKeySchema = z.enum([
  "review_pending_approvals",
  "review_overdue_invoices",
  "inspect_blocked_work",
  "review_pipeline",
  "review_stock_risk",
  "review_schedule",
  "review_technician_load",
  "open_my_day",
]);
export const EXPERIENCE_QUICK_ACTION_KEYS = ExperienceQuickActionKeySchema.options;

export const ExperienceProjectionKeySchema = z.enum([
  "customer",
  "schedule",
  "money",
  "work",
  "inventory",
  "computer",
  "assigned-day",
]);

export const ExperienceAttentionCategorySchema = z.enum([
  "recovery",
  "approval",
  "schedule",
  "money",
  "customer",
  "work",
]);

export const ExperienceExtensionSlotSchema = z.enum([
  "ready.primary",
  "ready.secondary",
  "plan.context",
  "approval.context",
  "working.visual",
  "outcome.summary",
  "recovery.context",
  "role.owner",
  "role.dispatcher",
  "role.technician",
  "inspector.extra",
]);
export const EXPERIENCE_EXTENSION_SLOTS = ExperienceExtensionSlotSchema.options;

const NorthstarPriorityExtensionSchema = z.object({
  key: z.literal("reference.northstar-service-priority"),
  config: z.object({
    title: z.string().trim().min(1).max(64).default("Service response priorities"),
    emphasis: z.enum(["response", "retention", "cash"]).default("response"),
  }).strict().default({}),
}).strict();

const SummitReadinessExtensionSchema = z.object({
  key: z.literal("reference.summit-installation-readiness"),
  config: z.object({
    title: z.string().trim().min(1).max(64).default("Installation readiness"),
    emphasis: z.enum(["pipeline", "materials", "handoff"]).default("pipeline"),
  }).strict().default({}),
}).strict();

export const ExperienceExtensionSchema = z.discriminatedUnion("key", [
  NorthstarPriorityExtensionSchema,
  SummitReadinessExtensionSchema,
]);
export const EXPERIENCE_EXTENSION_KEYS = [
  "reference.northstar-service-priority",
  "reference.summit-installation-readiness",
] as const;

const EXTENSION_ALLOWED_SLOTS: Record<(typeof EXPERIENCE_EXTENSION_KEYS)[number], ReadonlySet<string>> = {
  "reference.northstar-service-priority": new Set(["ready.primary", "role.owner", "role.dispatcher"]),
  "reference.summit-installation-readiness": new Set(["ready.primary", "ready.secondary", "role.owner", "outcome.summary"]),
};

const VocabularySchema = z.object({
  customer: z.string().trim().min(1).max(32),
  homeowner: z.string().trim().min(1).max(32),
  account: z.string().trim().min(1).max(32),
  technician: z.string().trim().min(1).max(32),
  installer: z.string().trim().min(1).max(32),
  serviceVisit: z.string().trim().min(1).max(32),
  appointment: z.string().trim().min(1).max(32),
  quote: z.string().trim().min(1).max(32),
  proposal: z.string().trim().min(1).max(32),
  invoice: z.string().trim().min(1).max(32),
  job: z.string().trim().min(1).max(32),
  work: z.string().trim().min(1).max(32),
}).strict();

const SurfaceTerminologySchema = z.object({
  home: z.string().trim().min(1).max(24),
  work: z.string().trim().min(1).max(24),
  customers: z.string().trim().min(1).max(24),
  schedule: z.string().trim().min(1).max(24),
  money: z.string().trim().min(1).max(24),
  agents: z.string().trim().min(1).max(24),
}).strict();

const QuickActionSchema = z.object({
  key: ExperienceQuickActionKeySchema,
  label: z.string().trim().min(1).max(48).optional(),
}).strict();

const RoleReadySchema = z.object({
  primaryFocus: z.enum(["operational_attention", "cash", "dispatch", "pipeline", "service", "inventory", "assigned_work"]),
  heroMetric: ExperienceMetricKeySchema.nullable(),
  pulseMetrics: z.array(ExperienceMetricKeySchema).max(6),
  attentionCategories: z.array(ExperienceAttentionCategorySchema).min(1).max(6),
  quickActions: z.array(QuickActionSchema).max(6),
  primaryProjection: ExperienceProjectionKeySchema,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.pulseMetrics).size !== value.pulseMetrics.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pulseMetrics"], message: "Pulse metrics must be unique" });
  }
  if (new Set(value.quickActions.map((action) => action.key)).size !== value.quickActions.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quickActions"], message: "Quick actions must be unique" });
  }
  if (new Set(value.attentionCategories).size !== value.attentionCategories.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attentionCategories"], message: "Attention categories must be unique" });
  }
});

const RoleExperienceSchema = z.object({
  startView: z.enum(["command", "schedule", "dispatch-map", "my-day"]),
  visibleSurfaces: z.array(WorkspaceSurfaceSchema).min(1).max(WORKSPACE_SURFACES.length),
  ready: RoleReadySchema,
}).strict();

const ScenePreferenceSchema = z.object({
  detail: z.enum(["compact", "balanced", "detailed"]),
  emphasis: z.enum(["presence", "context", "evidence"]),
}).strict();

const ScenePreferencesSchema = z.object({
  ready: ScenePreferenceSchema,
  listening: ScenePreferenceSchema,
  plan: ScenePreferenceSchema,
  approval: ScenePreferenceSchema,
  working: ScenePreferenceSchema,
  outcome: ScenePreferenceSchema,
  recovery: ScenePreferenceSchema,
}).strict();

const ExtensionSlotsSchema = z.object({
  "ready.primary": ExperienceExtensionSchema.optional(),
  "ready.secondary": ExperienceExtensionSchema.optional(),
  "plan.context": ExperienceExtensionSchema.optional(),
  "approval.context": ExperienceExtensionSchema.optional(),
  "working.visual": ExperienceExtensionSchema.optional(),
  "outcome.summary": ExperienceExtensionSchema.optional(),
  "recovery.context": ExperienceExtensionSchema.optional(),
  "role.owner": ExperienceExtensionSchema.optional(),
  "role.dispatcher": ExperienceExtensionSchema.optional(),
  "role.technician": ExperienceExtensionSchema.optional(),
  "inspector.extra": ExperienceExtensionSchema.optional(),
}).strict();

const METRIC_ROLES: Record<z.infer<typeof ExperienceMetricKeySchema>, ReadonlySet<string>> = {
  pending_approvals: new Set(["owner", "dispatcher"]),
  collected_usd: new Set(["owner"]),
  overdue_invoice_value: new Set(["owner"]),
  open_leads: new Set(["owner"]),
  runs_in_flight: new Set(["owner", "dispatcher"]),
  stuck_runs: new Set(["owner", "dispatcher"]),
  stock_risk_items: new Set(["owner"]),
  technician_load: new Set(["owner", "dispatcher"]),
  assigned_work_today: new Set(["owner", "technician"]),
};

const QUICK_ACTION_ROLES: Record<z.infer<typeof ExperienceQuickActionKeySchema>, ReadonlySet<string>> = {
  review_pending_approvals: new Set(["owner", "dispatcher"]),
  review_overdue_invoices: new Set(["owner"]),
  inspect_blocked_work: new Set(["owner", "dispatcher"]),
  review_pipeline: new Set(["owner"]),
  review_stock_risk: new Set(["owner"]),
  review_schedule: new Set(["owner", "dispatcher"]),
  review_technician_load: new Set(["owner", "dispatcher"]),
  open_my_day: new Set(["technician"]),
};

const ROLE_START_VIEWS: Record<string, ReadonlySet<string>> = {
  owner: new Set(["command"]),
  dispatcher: new Set(["schedule", "dispatch-map"]),
  technician: new Set(["my-day"]),
};

const ROLE_PRIMARY_PROJECTIONS: Record<string, ReadonlySet<string>> = {
  owner: new Set(ExperienceProjectionKeySchema.options.filter((value) => value !== "assigned-day")),
  dispatcher: new Set(["schedule", "work", "customer"]),
  technician: new Set(["assigned-day"]),
};

export const TenantExperienceManifestV2Schema = z.object({
  version: z.literal(TENANT_EXPERIENCE_VERSION),
  enabledSurfaces: z.array(WorkspaceSurfaceSchema).min(1).max(WORKSPACE_SURFACES.length),
  terminology: SurfaceTerminologySchema,
  vocabulary: VocabularySchema,
  voiceEnabled: z.boolean(),
  navigationPriority: z.array(WorkspaceSurfaceSchema).length(WORKSPACE_SURFACES.length),
  brand: z.object({
    accent: z.enum(["cyan", "teal", "amber", "violet"]),
    surfaceTone: z.enum(["ink", "slate", "sand"]),
    radius: z.enum(["precise", "soft"]),
    density: z.enum(["compact", "balanced", "spacious"]),
    typography: z.enum(["system", "editorial", "technical"]),
    motion: z.enum(["restrained", "standard", "expressive"]),
    mark: z.string().trim().min(1).max(3),
    logoAssetKey: z.enum(["finnor", "reference-northstar", "reference-summit"]),
  }).strict(),
  visibility: z.object({ policy: z.boolean(), authority: z.boolean() }).strict(),
  roles: z.object({
    owner: RoleExperienceSchema,
    dispatcher: RoleExperienceSchema,
    technician: RoleExperienceSchema,
  }).strict(),
  scenes: ScenePreferencesSchema,
  extensions: ExtensionSlotsSchema,
}).strict().superRefine((value, ctx) => {
  if (!value.enabledSurfaces.includes("home")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledSurfaces"], message: "Home must remain enabled" });
  }
  if (new Set(value.enabledSurfaces).size !== value.enabledSurfaces.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledSurfaces"], message: "Enabled surfaces must be unique" });
  }
  if (new Set(value.navigationPriority).size !== WORKSPACE_SURFACES.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["navigationPriority"], message: "Navigation priority must contain each surface exactly once" });
  }
  for (const role of EXPERIENCE_ROLES) {
    const roleConfig = value.roles[role];
    if (!ROLE_START_VIEWS[role]!.has(roleConfig.startView)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roles", role, "startView"], message: `Unsupported ${role} start view` });
    }
    if (!roleConfig.visibleSurfaces.includes("home") || roleConfig.visibleSurfaces.some((surface) => !value.enabledSurfaces.includes(surface))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roles", role, "visibleSurfaces"], message: "Role surfaces must include Home and remain within tenant-enabled surfaces" });
    }
    if (new Set(roleConfig.visibleSurfaces).size !== roleConfig.visibleSurfaces.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roles", role, "visibleSurfaces"], message: "Role surfaces must be unique" });
    }
    const metrics = [roleConfig.ready.heroMetric, ...roleConfig.ready.pulseMetrics].filter((metric): metric is z.infer<typeof ExperienceMetricKeySchema> => metric !== null);
    metrics.forEach((metric) => {
      if (!METRIC_ROLES[metric].has(role)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roles", role, "ready"], message: `Metric ${metric} is not registered for role ${role}` });
    });
    roleConfig.ready.quickActions.forEach((action) => {
      if (!QUICK_ACTION_ROLES[action.key].has(role)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roles", role, "ready", "quickActions"], message: `Quick action ${action.key} is not registered for role ${role}` });
    });
    if (!ROLE_PRIMARY_PROJECTIONS[role]!.has(roleConfig.ready.primaryProjection)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roles", role, "ready", "primaryProjection"], message: `Projection ${roleConfig.ready.primaryProjection} is not available to role ${role}` });
    }
  }
  for (const [slot, extension] of Object.entries(value.extensions)) {
    if (!extension) continue;
    if (!EXTENSION_ALLOWED_SLOTS[extension.key].has(slot)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["extensions", slot], message: `Extension ${extension.key} is not registered for slot ${slot}` });
    }
  }
});

const LegacyWorkspaceConfigSchema = z.object({
  enabledSurfaces: z.array(WorkspaceSurfaceSchema).min(1).max(WORKSPACE_SURFACES.length),
  terminology: SurfaceTerminologySchema,
  voiceEnabled: z.boolean(),
  navigationPriority: z.array(WorkspaceSurfaceSchema).length(WORKSPACE_SURFACES.length),
  brand: z.object({
    accent: z.enum(["cyan", "teal", "amber", "violet"]),
    radius: z.enum(["precise", "soft"]),
    mark: z.string().trim().min(1).max(3),
  }).strict(),
  visibility: z.object({ policy: z.boolean(), authority: z.boolean() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (!value.enabledSurfaces.includes("home")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledSurfaces"], message: "Home must remain enabled" });
  if (new Set(value.enabledSurfaces).size !== value.enabledSurfaces.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledSurfaces"], message: "Enabled surfaces must be unique" });
  if (new Set(value.navigationPriority).size !== WORKSPACE_SURFACES.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["navigationPriority"], message: "Navigation priority must contain each surface exactly once" });
});

export type TenantExperienceManifestV2 = z.infer<typeof TenantExperienceManifestV2Schema>;
export type WorkspaceConfig = TenantExperienceManifestV2;
export type ExperienceMetricKey = z.infer<typeof ExperienceMetricKeySchema>;
export type ExperienceQuickActionKey = z.infer<typeof ExperienceQuickActionKeySchema>;
export type ExperienceRole = z.infer<typeof ExperienceRoleSchema>;

export const DEFAULT_WORKSPACE_CONFIG: TenantExperienceManifestV2 = {
  version: 2,
  enabledSurfaces: [...WORKSPACE_SURFACES],
  terminology: { home: "Home", work: "Work", customers: "Customers", schedule: "Schedule", money: "Money", agents: "Agents" },
  vocabulary: {
    customer: "Customer", homeowner: "Homeowner", account: "Account", technician: "Technician", installer: "Installer",
    serviceVisit: "Service Visit", appointment: "Appointment", quote: "Quote", proposal: "Proposal", invoice: "Invoice", job: "Job", work: "Work",
  },
  voiceEnabled: true,
  navigationPriority: [...WORKSPACE_SURFACES],
  brand: {
    accent: "cyan", surfaceTone: "ink", radius: "soft", density: "balanced", typography: "system", motion: "standard", mark: "F", logoAssetKey: "finnor",
  },
  visibility: { policy: true, authority: true },
  roles: {
    owner: {
      startView: "command",
      visibleSurfaces: [...WORKSPACE_SURFACES],
      ready: {
        primaryFocus: "operational_attention", heroMetric: "pending_approvals",
        pulseMetrics: ["pending_approvals", "collected_usd", "overdue_invoice_value", "open_leads", "runs_in_flight"],
        attentionCategories: ["recovery", "approval", "schedule", "money", "customer", "work"],
        quickActions: [{ key: "inspect_blocked_work" }, { key: "review_overdue_invoices" }, { key: "review_pending_approvals" }],
        primaryProjection: "work",
      },
    },
    dispatcher: {
      startView: "schedule",
      visibleSurfaces: ["home", "work", "customers", "schedule", "agents"],
      ready: {
        primaryFocus: "dispatch", heroMetric: "technician_load", pulseMetrics: ["technician_load", "pending_approvals", "runs_in_flight", "stuck_runs"],
        attentionCategories: ["recovery", "approval", "schedule", "customer", "work"],
        quickActions: [{ key: "review_schedule" }, { key: "review_technician_load" }, { key: "inspect_blocked_work" }],
        primaryProjection: "schedule",
      },
    },
    technician: {
      startView: "my-day",
      visibleSurfaces: ["home", "work", "customers", "schedule"],
      ready: {
        primaryFocus: "assigned_work", heroMetric: "assigned_work_today", pulseMetrics: ["assigned_work_today"],
        attentionCategories: ["recovery", "schedule", "customer", "work"],
        quickActions: [{ key: "open_my_day" }], primaryProjection: "assigned-day",
      },
    },
  },
  scenes: {
    ready: { detail: "balanced", emphasis: "presence" },
    listening: { detail: "compact", emphasis: "presence" },
    plan: { detail: "balanced", emphasis: "context" },
    approval: { detail: "detailed", emphasis: "evidence" },
    working: { detail: "balanced", emphasis: "evidence" },
    outcome: { detail: "detailed", emphasis: "evidence" },
    recovery: { detail: "detailed", emphasis: "context" },
  },
  extensions: {},
};

function legacyToV2(legacy: z.infer<typeof LegacyWorkspaceConfigSchema>): TenantExperienceManifestV2 {
  return TenantExperienceManifestV2Schema.parse({
    ...DEFAULT_WORKSPACE_CONFIG,
    enabledSurfaces: legacy.enabledSurfaces,
    terminology: legacy.terminology,
    voiceEnabled: legacy.voiceEnabled,
    navigationPriority: legacy.navigationPriority,
    brand: { ...DEFAULT_WORKSPACE_CONFIG.brand, ...legacy.brand },
    visibility: legacy.visibility,
    roles: Object.fromEntries(EXPERIENCE_ROLES.map((role) => [role, {
      ...DEFAULT_WORKSPACE_CONFIG.roles[role],
      visibleSurfaces: DEFAULT_WORKSPACE_CONFIG.roles[role].visibleSurfaces.filter((surface) => legacy.enabledSurfaces.includes(surface)),
    }])),
  });
}

/** Canonical input boundary. Legacy workspace manifests are accepted and
 * deterministically upgraded; all callers receive only the V2 shape. */
export const WorkspaceConfigSchema = z.union([
  TenantExperienceManifestV2Schema,
  LegacyWorkspaceConfigSchema.transform(legacyToV2),
]);

export function normalizeWorkspaceConfig(value: unknown): TenantExperienceManifestV2 {
  const parsed = WorkspaceConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_WORKSPACE_CONFIG;
}
