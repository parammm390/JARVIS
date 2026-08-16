import { z } from "zod";

const SurfaceSchema = z.enum(["home", "work", "customers", "schedule", "money", "agents"]);
const allSurfaces = SurfaceSchema.options;

export const WorkspaceConfigSchema = z.object({
  enabledSurfaces: z.array(SurfaceSchema).min(1).max(allSurfaces.length),
  terminology: z.object({
    home: z.string().trim().min(1).max(24),
    work: z.string().trim().min(1).max(24),
    customers: z.string().trim().min(1).max(24),
    schedule: z.string().trim().min(1).max(24),
    money: z.string().trim().min(1).max(24),
    agents: z.string().trim().min(1).max(24),
  }),
  voiceEnabled: z.boolean(),
  navigationPriority: z.array(SurfaceSchema).length(allSurfaces.length),
  brand: z.object({
    accent: z.enum(["cyan", "teal", "amber", "violet"]),
    radius: z.enum(["precise", "soft"]),
    mark: z.string().trim().min(1).max(3),
  }),
  visibility: z.object({ policy: z.boolean(), authority: z.boolean() }),
}).superRefine((value, ctx) => {
  if (!value.enabledSurfaces.includes("home")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledSurfaces"], message: "Home must remain enabled" });
  if (new Set(value.enabledSurfaces).size !== value.enabledSurfaces.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledSurfaces"], message: "Enabled surfaces must be unique" });
  if (new Set(value.navigationPriority).size !== allSurfaces.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["navigationPriority"], message: "Navigation priority must contain each surface exactly once" });
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  enabledSurfaces: [...allSurfaces],
  terminology: { home: "Home", work: "Work", customers: "Customers", schedule: "Schedule", money: "Money", agents: "Agents" },
  voiceEnabled: true,
  navigationPriority: [...allSurfaces],
  brand: { accent: "cyan", radius: "soft", mark: "F" },
  visibility: { policy: true, authority: true },
};

export function normalizeWorkspaceConfig(value: unknown): WorkspaceConfig {
  const parsed = WorkspaceConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_WORKSPACE_CONFIG;
}
