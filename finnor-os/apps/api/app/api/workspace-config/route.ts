import { tenantSettings, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { errorResponse, requireContext } from "../../../lib/auth";
import { WorkspaceConfigSchema, normalizeWorkspaceConfig } from "../../../lib/workspace-config";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const [settings] = await withTenant(ctx.tenantId, (db) => db.select({ workspaceConfig: tenantSettings.workspaceConfig }).from(tenantSettings).where(eq(tenantSettings.tenantId, ctx.tenantId)).limit(1));
    return Response.json({ config: normalizeWorkspaceConfig(settings?.workspaceConfig), editable: ctx.role === "owner" });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner") return Response.json({ error: "Only owners can edit the tenant workspace" }, { status: 403 });
    const parsed = WorkspaceConfigSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, { status: 400 });
    const [saved] = await withTenant(ctx.tenantId, (db) => db.insert(tenantSettings)
      .values({ tenantId: ctx.tenantId, workspaceConfig: parsed.data })
      .onConflictDoUpdate({ target: tenantSettings.tenantId, set: { workspaceConfig: parsed.data, updatedAt: new Date() } })
      .returning({ workspaceConfig: tenantSettings.workspaceConfig }));
    return Response.json({ config: normalizeWorkspaceConfig(saved?.workspaceConfig), editable: true });
  } catch (err) {
    return errorResponse(err);
  }
}
