// B2.T1 planner DAG dispatch. The domain_actions rows remain the durable source of
// truth and each eventual execution still creates its ordinary runtime receipt. This
// module only decides which draft is eligible to enter that existing gated path.

import { and, eq, inArray } from "drizzle-orm";
import { domainActions, withTenant } from "@finnor/db";
import type { DomainAction } from "@finnor/shared-types";

export interface PlannerActionDependency {
  /** Indexes into the returned plan, not model-invented database ids. */
  dependsOn?: number[];
}

/** Backward-only edges make the submitted action list a topological order and make
 * cycles or arbitrary cross-tenant ids structurally impossible. */
export function validateDependencyIndexes(actions: PlannerActionDependency[]): number[][] {
  return actions.map((action, index) => {
    const dependencies = action.dependsOn ?? [];
    if (new Set(dependencies).size !== dependencies.length) throw new Error(`Plan action ${index} repeats a dependency index`);
    for (const dependency of dependencies) {
      if (!Number.isInteger(dependency) || dependency < 0 || dependency >= index) {
        throw new Error(`Plan action ${index} has invalid dependency index ${dependency}; dependencies must reference an earlier action`);
      }
    }
    return dependencies;
  });
}

function toDomainAction(row: typeof domainActions.$inferSelect): DomainAction {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actionType: row.actionType,
    payload: row.payload as Record<string, unknown>,
    policyId: row.policyId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Returns only same-tenant draft nodes whose every prerequisite completed. */
export async function readyPlanActions(tenantId: string, planId: string): Promise<DomainAction[]> {
  const rows = await withTenant(tenantId, (db) =>
    db.select().from(domainActions).where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.planId, planId))),
  );
  const completed = new Set(rows.filter((row) => row.status === "completed").map((row) => row.id));
  return rows
    .filter((row) => row.status === "draft" && row.dependsOn.every((dependency) => completed.has(dependency)))
    .map(toDomainAction);
}

/** Defensive readiness check before a plan action reaches the normal executor. */
export async function isPlanActionReady(tenantId: string, actionId: string): Promise<boolean> {
  const [row] = await withTenant(tenantId, (db) =>
    db.select().from(domainActions).where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.id, actionId))),
  );
  if (!row || !row.planId || row.dependsOn.length === 0) return Boolean(row);
  const prerequisiteRows = await withTenant(tenantId, (db) =>
    db.select({ id: domainActions.id, status: domainActions.status }).from(domainActions).where(
      and(eq(domainActions.tenantId, tenantId), inArray(domainActions.id, row.dependsOn)),
    ),
  );
  return prerequisiteRows.length === row.dependsOn.length && prerequisiteRows.every((dependency) => dependency.status === "completed");
}

export async function planIdForAction(tenantId: string, actionId: string): Promise<string | null> {
  const [row] = await withTenant(tenantId, (db) =>
    db.select({ planId: domainActions.planId }).from(domainActions).where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.id, actionId))),
  );
  return row?.planId ?? null;
}
