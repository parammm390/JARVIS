import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { importEntityRefs, importRows, importRuns, withTenant } from "@finnor/db";
import { CanonicalImportError, writeCanonicalImportRow } from "@finnor/data-platform";
import { DeclarativeImportDefinitionSchema, parseImportDefinition, type DeclarativeImportDefinition, type ImportEntity } from "./definition";
import { mapSourceRow, type ImportIssue } from "./mapping";
import { parseSource } from "./parser";
import { validateCanonicalRow } from "./validation";

export * from "./definition";
export * from "./mapping";
export * from "./parser";
export * from "./validation";

const refEntityType = (entity: ImportEntity): string => entity === "customer" ? "household" : entity;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
};

export interface RunImportInput {
  tenantId: string;
  definition: DeclarativeImportDefinition;
  source: { name: string; content: string };
  dryRun?: boolean;
}

export interface ImportReport {
  runId: string;
  dryRun: boolean;
  status: "completed" | "completed_with_errors";
  total: number;
  created: number;
  updated: number;
  skipped: number;
  planned: number;
  quarantined: number;
  sourceSha256: string;
  definitionSha256: string;
}

async function recordQuarantine(tenantId: string, runId: string, rowNumber: number, normalizedData: Record<string, unknown>, sourceId: string | undefined, identityKey: string | undefined, issues: ImportIssue[]): Promise<void> {
  await withTenant(tenantId, (db) => db.insert(importRows).values({ tenantId, runId, rowNumber, sourceId: sourceId ?? null, identityKey: identityKey ?? null, status: "quarantined", reasons: issues, normalizedData }));
}

export async function runDeclarativeImport(input: RunImportInput): Promise<ImportReport> {
  const definition = DeclarativeImportDefinitionSchema.parse(input.definition);
  const rows = parseSource(input.source.content, definition.format, definition.delimiter);
  const sourceSha256 = sha256(input.source.content);
  const definitionSha256 = sha256(stable(definition));
  const [run] = await withTenant(input.tenantId, (db) => db.insert(importRuns).values({
    tenantId: input.tenantId, definitionKey: definition.key, definitionVersion: definition.version,
    sourceSystem: definition.sourceSystem, sourceName: input.source.name, sourceSha256, definitionSha256, dryRun: input.dryRun ?? false,
  }).returning());
  if (!run) throw new Error("failed to create import run");

  const counts = { created: 0, updated: 0, skipped: 0, planned: 0, quarantined: 0 };
  for (let offset = 0; offset < rows.length; offset += definition.batchSize) {
    for (const parsed of rows.slice(offset, offset + definition.batchSize)) {
      if (!parsed.value) {
        counts.quarantined++;
        await recordQuarantine(input.tenantId, run.id, parsed.rowNumber, {}, undefined, undefined, [{ stage: "parse", code: "invalid_source_row", message: parsed.error ?? "invalid source row" }]);
        continue;
      }
      const mapped = mapSourceRow(parsed.value, definition);
      mapped.issues.push(...validateCanonicalRow(definition.entity, mapped.data));
      if (mapped.issues.length) {
        counts.quarantined++;
        await recordQuarantine(input.tenantId, run.id, parsed.rowNumber, mapped.data, mapped.sourceId, mapped.identityKey, mapped.issues);
        continue;
      }
      try {
        const outcome = await withTenant(input.tenantId, async (db) => {
          const [sourceRef] = await db.select().from(importEntityRefs).where(and(
            eq(importEntityRefs.tenantId, input.tenantId), eq(importEntityRefs.sourceSystem, definition.sourceSystem),
            eq(importEntityRefs.entityType, refEntityType(definition.entity)), eq(importEntityRefs.sourceId, mapped.sourceId!),
          ));
          let resolvedRef = sourceRef;
          if (!resolvedRef && mapped.identityKey) {
            const identityRefs = await db.select().from(importEntityRefs).where(and(
              eq(importEntityRefs.tenantId, input.tenantId), eq(importEntityRefs.sourceSystem, definition.sourceSystem),
              eq(importEntityRefs.entityType, refEntityType(definition.entity)), eq(importEntityRefs.identityKey, mapped.identityKey),
            ));
            const canonicalIds = [...new Set(identityRefs.map((ref) => ref.canonicalEntityId))];
            if (canonicalIds.length > 1) throw new CanonicalImportError("ambiguous_match", "deterministic identity maps to multiple canonical records");
            resolvedRef = identityRefs[0];
          }
          const relationships: Record<string, string> = {};
          for (const [field, relationship] of Object.entries(mapped.relationshipSourceIds)) {
            const [ref] = await db.select().from(importEntityRefs).where(and(
              eq(importEntityRefs.tenantId, input.tenantId), eq(importEntityRefs.sourceSystem, relationship.sourceSystem),
              eq(importEntityRefs.entityType, refEntityType(relationship.entity)), eq(importEntityRefs.sourceId, relationship.sourceId),
            ));
            if (!ref && relationship.required) throw new CanonicalImportError("invalid_relationship", `${field} source id ${relationship.sourceId} was not imported for this tenant/source`, field);
            if (ref) relationships[field] = ref.canonicalEntityId;
          }

          if (input.dryRun) {
            await db.insert(importRows).values({ tenantId: input.tenantId, runId: run.id, rowNumber: parsed.rowNumber, sourceId: mapped.sourceId, identityKey: mapped.identityKey ?? null, status: "planned", canonicalEntityType: resolvedRef?.entityType ?? null, canonicalEntityId: resolvedRef?.canonicalEntityId ?? null, normalizedData: mapped.data });
            return "planned" as const;
          }

          const write = await writeCanonicalImportRow(db, {
            tenantId: input.tenantId, entity: definition.entity, data: mapped.data, relationships,
            existingId: resolvedRef?.canonicalEntityId, sourceOwned: Boolean(resolvedRef), updateMode: definition.updateMode,
            provenance: { sourceSystem: definition.sourceSystem, sourceId: mapped.sourceId! },
          });
          if (sourceRef) {
            await db.update(importEntityRefs).set({ lastRunId: run.id, lastSeenAt: new Date(), identityKey: mapped.identityKey ?? sourceRef.identityKey }).where(eq(importEntityRefs.id, sourceRef.id));
          } else {
            const inserted = await db.insert(importEntityRefs).values({
              tenantId: input.tenantId, sourceSystem: definition.sourceSystem, entityType: write.entityType,
              sourceId: mapped.sourceId!, canonicalEntityId: write.entityId, identityKey: mapped.identityKey ?? null, firstRunId: run.id, lastRunId: run.id,
            }).onConflictDoNothing().returning({ id: importEntityRefs.id });
            if (!inserted.length) throw new Error("source identity was concurrently claimed; retry this row");
          }
          await db.insert(importRows).values({
            tenantId: input.tenantId, runId: run.id, rowNumber: parsed.rowNumber, sourceId: mapped.sourceId,
            identityKey: mapped.identityKey ?? null, status: write.action, canonicalEntityType: write.entityType,
            canonicalEntityId: write.entityId, normalizedData: mapped.data,
          });
          return write.action;
        });
        counts[outcome]++;
      } catch (error) {
        counts.quarantined++;
        const issue: ImportIssue = error instanceof CanonicalImportError
          ? { stage: error.code === "invalid_relationship" ? "relationship" : "write", code: error.code, message: error.message, field: error.field }
          : { stage: "write", code: "canonical_write_failed", message: (error as Error).message };
        await recordQuarantine(input.tenantId, run.id, parsed.rowNumber, mapped.data, mapped.sourceId, mapped.identityKey, [issue]);
      }
    }
  }
  const status = counts.quarantined ? "completed_with_errors" : "completed";
  const report: ImportReport = { runId: run.id, dryRun: input.dryRun ?? false, status, total: rows.length, ...counts, sourceSha256, definitionSha256 };
  await withTenant(input.tenantId, (db) => db.update(importRuns).set({
    status, totalRows: rows.length, createdRows: counts.created, updatedRows: counts.updated,
    skippedRows: counts.skipped, quarantinedRows: counts.quarantined, report, finishedAt: new Date(),
  }).where(eq(importRuns.id, run.id)));
  return report;
}
