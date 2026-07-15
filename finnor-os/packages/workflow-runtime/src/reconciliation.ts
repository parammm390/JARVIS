import { withTenant, reconciliationCases } from "@finnor/db";
import { eq } from "drizzle-orm";

export interface OpenReconciliationCaseParams {
  caseType: "unknown_delivery" | "unmatched_inbox_event";
  relatedOutboxEventId?: string;
  relatedInboxEventId?: string;
  relatedStepId?: string;
  details: Record<string, unknown>;
}

export async function openReconciliationCase(
  tenantId: string,
  params: OpenReconciliationCaseParams,
): Promise<{ caseId: string }> {
  const [row] = await withTenant(tenantId, (db) =>
    db
      .insert(reconciliationCases)
      .values({
        tenantId,
        caseType: params.caseType,
        relatedOutboxEventId: params.relatedOutboxEventId ?? null,
        relatedInboxEventId: params.relatedInboxEventId ?? null,
        relatedStepId: params.relatedStepId ?? null,
        details: params.details,
      })
      .returning(),
  );
  return { caseId: row!.id };
}

export async function resolveReconciliationCase(tenantId: string, caseId: string): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.update(reconciliationCases).set({ status: "resolved", resolvedAt: new Date() }).where(eq(reconciliationCases.id, caseId)),
  );
}
