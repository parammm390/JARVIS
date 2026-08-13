import { employeeRoleAssignments, employeeRoles, users, withTenant } from "@finnor/db";
import { and, asc, eq } from "drizzle-orm";
import { errorResponse, requireContext } from "../../../lib/auth";

/** Tenant-scoped directory for responsibility handoffs. It deliberately exposes no
 * email, phone, or provider identity—only the canonical employee id, display label,
 * status, and active functional roles needed by the Work surface. */
export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const rows = await withTenant(ctx.tenantId, (db) => db.select({
      id: users.id,
      displayName: users.displayName,
      legacyRole: users.role,
      status: users.status,
      roleKey: employeeRoles.key,
    }).from(users)
      .leftJoin(employeeRoleAssignments, and(
        eq(employeeRoleAssignments.tenantId, ctx.tenantId),
        eq(employeeRoleAssignments.employeeId, users.id),
        eq(employeeRoleAssignments.active, true),
      ))
      .leftJoin(employeeRoles, and(
        eq(employeeRoles.tenantId, ctx.tenantId),
        eq(employeeRoles.id, employeeRoleAssignments.roleId),
        eq(employeeRoles.active, true),
      ))
      .where(eq(users.tenantId, ctx.tenantId))
      .orderBy(asc(users.displayName), asc(users.id)));
    const employees = [...new Map(rows.map((row) => [row.id, {
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      roles: [] as string[],
      legacyRole: row.legacyRole,
    }])).values()];
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    for (const row of rows) {
      if (row.roleKey && !byId.get(row.id)!.roles.includes(row.roleKey)) byId.get(row.id)!.roles.push(row.roleKey);
    }
    return Response.json({ employees });
  } catch (error) {
    return errorResponse(error);
  }
}
