import { documents, type Db } from "@finnor/db";
import { recordBusinessEvent } from "./events";

export interface CreateDocumentParams {
  tenantId: string;
  householdId?: string;
  kind: string;
  title: string;
  storageRef?: string;
  provenance?: { sourceSystem: string; externalId?: string; createdBy?: string };
}

export async function createDocument(db: Db, params: CreateDocumentParams): Promise<{ documentId: string }> {
  const [doc] = await db
    .insert(documents)
    .values({
      tenantId: params.tenantId,
      householdId: params.householdId ?? null,
      kind: params.kind,
      title: params.title,
      storageRef: params.storageRef ?? null,
      sourceSystem: params.provenance?.sourceSystem ?? null,
      externalId: params.provenance?.externalId ?? null,
      createdBy: params.provenance?.createdBy ?? null,
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "document",
    entityId: doc!.id,
    eventType: "document_created",
    payload: { kind: params.kind },
  });
  return { documentId: doc!.id };
}
