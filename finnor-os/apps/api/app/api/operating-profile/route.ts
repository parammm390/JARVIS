import { tenantOperatingProfiles, userOperatingProfiles, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { errorResponse, requireContext } from "../../../lib/auth";

const SAFE_PROFILE_KEY = /^(?!.*(?:password|secret|token|api.?key|credential|authorization))[A-Za-z][A-Za-z0-9_. -]{0,79}$/i;

function profileRecordAudit(value: unknown, depth = 0): { unsafe: boolean; tooDeep: boolean; fields: number } {
  if (depth > 8) return { unsafe: false, tooDeep: true, fields: 0 };
  if (Array.isArray(value)) {
    return value.reduce((result, item) => {
      const nested = profileRecordAudit(item, depth + 1);
      return { unsafe: result.unsafe || nested.unsafe, tooDeep: result.tooDeep || nested.tooDeep, fields: result.fields + nested.fields };
    }, { unsafe: false, tooDeep: false, fields: 0 });
  }
  if (!value || typeof value !== "object") return { unsafe: false, tooDeep: false, fields: 0 };
  return Object.entries(value as Record<string, unknown>).reduce<{ unsafe: boolean; tooDeep: boolean; fields: number }>((result, [key, nestedValue]) => {
    const nested = profileRecordAudit(nestedValue, depth + 1);
    return {
      unsafe: result.unsafe || !SAFE_PROFILE_KEY.test(key) || nested.unsafe,
      tooDeep: result.tooDeep || nested.tooDeep,
      fields: result.fields + 1 + nested.fields,
    };
  }, { unsafe: false, tooDeep: false, fields: 0 });
}

const BoundedRecord = z.record(z.unknown()).superRefine((value, ctx) => {
  const audit = profileRecordAudit(value);
  if (audit.fields > 200) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "profile record may contain at most 200 fields" });
  if (audit.unsafe) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "profile record contains an unsafe field name" });
  if (audit.tooDeep) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "profile record nesting is too deep" });
  if (JSON.stringify(value).length > 20_000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "profile record is too large" });
});

const CompanyProfileSchema = z.object({
  industry: z.string().trim().min(1).max(160).nullable(),
  niche: z.string().trim().min(1).max(200).nullable(),
  description: z.string().trim().min(1).max(2_000).nullable(),
  primaryGeographies: z.array(z.string().trim().min(1).max(120)).max(20),
  foundedYear: z.number().int().min(1800).max(2200).nullable(),
  idealCustomerProfile: BoundedRecord,
  businessFacts: BoundedRecord,
  comparisonDefaults: z.object({
    scaleMetric: z.string().trim().min(1).max(100).optional(),
    performanceMetric: z.string().trim().min(1).max(120).optional(),
  }),
});

const EmployeeProfileSchema = z.object({
  title: z.string().trim().min(1).max(160).nullable(),
  profileFacts: BoundedRecord,
});

const UpdateSchema = z.object({
  company: CompanyProfileSchema.optional(),
  employee: EmployeeProfileSchema.optional(),
}).refine((value) => Boolean(value.company || value.employee), "company or employee profile is required");

function companyResponse(row: typeof tenantOperatingProfiles.$inferSelect | undefined) {
  return {
    industry: row?.industry ?? null,
    niche: row?.niche ?? null,
    description: row?.description ?? null,
    primaryGeographies: Array.isArray(row?.primaryGeographies) ? row.primaryGeographies : [],
    foundedYear: row?.foundedYear ?? null,
    idealCustomerProfile: row?.idealCustomerProfile ?? {},
    businessFacts: row?.businessFacts ?? {},
    comparisonDefaults: row?.comparisonDefaults ?? {},
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

function employeeResponse(row: typeof userOperatingProfiles.$inferSelect | undefined) {
  return {
    title: row?.title ?? null,
    profileFacts: row?.profileFacts ?? {},
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const result = await withTenant(ctx.tenantId, async (db) => {
      const [company] = await db.select().from(tenantOperatingProfiles).where(eq(tenantOperatingProfiles.tenantId, ctx.tenantId)).limit(1);
      const [employee] = await db.select().from(userOperatingProfiles).where(eq(userOperatingProfiles.userId, ctx.userId)).limit(1);
      return { company, employee };
    }, ctx.userId);
    return Response.json({ company: companyResponse(result.company), employee: employeeResponse(result.employee), companyEditable: ctx.role === "owner" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, { status: 400 });
    if (parsed.data.company && ctx.role !== "owner") return Response.json({ error: "Only owners can edit the company operating profile" }, { status: 403 });
    const result = await withTenant(ctx.tenantId, async (db) => {
      let company: typeof tenantOperatingProfiles.$inferSelect | undefined;
      let employee: typeof userOperatingProfiles.$inferSelect | undefined;
      if (parsed.data.company) {
        [company] = await db.insert(tenantOperatingProfiles)
          .values({ tenantId: ctx.tenantId, ...parsed.data.company, updatedAt: new Date() })
          .onConflictDoUpdate({ target: tenantOperatingProfiles.tenantId, set: { ...parsed.data.company, updatedAt: new Date() } })
          .returning();
      } else {
        [company] = await db.select().from(tenantOperatingProfiles).where(eq(tenantOperatingProfiles.tenantId, ctx.tenantId)).limit(1);
      }
      if (parsed.data.employee) {
        [employee] = await db.insert(userOperatingProfiles)
          .values({ userId: ctx.userId, tenantId: ctx.tenantId, ...parsed.data.employee, updatedAt: new Date() })
          .onConflictDoUpdate({ target: userOperatingProfiles.userId, set: { ...parsed.data.employee, updatedAt: new Date() } })
          .returning();
      } else {
        [employee] = await db.select().from(userOperatingProfiles).where(eq(userOperatingProfiles.userId, ctx.userId)).limit(1);
      }
      return { company, employee };
    }, ctx.userId);
    return Response.json({ company: companyResponse(result.company), employee: employeeResponse(result.employee), companyEditable: ctx.role === "owner" });
  } catch (error) {
    return errorResponse(error);
  }
}
