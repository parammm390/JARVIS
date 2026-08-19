// Dealer Zero compatibility fixture, now intentionally routed through the same
// declarative engine used by real client files. No dealer-specific write path exists.

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { closePool, importEntityRefs, withTenant } from "@finnor/db";
import { parseImportDefinition, runDeclarativeImport } from "@finnor/import-engine";

export interface SyntheticLeadFixture {
  externalId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export const SYNTHETIC_DEALER_LEADS: SyntheticLeadFixture[] = [
  { externalId: "synth-001", name: "Harold Voss", phone: "+13195551001", address: "12 Birchwood Ave, Cedar Falls, IA" },
  { externalId: "synth-002", name: "Harold Voss Jr", phone: "+13195551001", address: "12 Birchwood Ave, Cedar Falls, IA" },
  { externalId: "synth-003", name: "Priya Nandakumar", phone: "+13195551003", email: "priya.n@example.com" },
  { externalId: "synth-004", name: "(unknown caller)" },
  { externalId: "synth-005", name: "Deborah Alt", phone: "+13195551005" },
];

export const SYNTHETIC_LEAD_IMPORT = parseImportDefinition({
  key: "synthetic-dealer-leads",
  format: "json",
  version: 1,
  entity: "lead",
  sourceSystem: "synthetic_dealer_import",
  fields: {
    name: { from: "name", required: true, normalize: ["trim"] },
    phone: { from: "phone", normalize: ["trim", "phone_e164", "empty_to_null"] },
    email: { from: "email", normalize: ["trim", "lowercase", "empty_to_null"] },
    address: { from: "address", normalize: ["trim", "empty_to_null"] },
    notes: { from: "notes", normalize: ["trim", "empty_to_null"] },
  },
  externalId: { from: "externalId", required: true, normalize: ["trim"] },
  identity: [{ fields: ["email"] }, { fields: ["phone"] }],
  updateMode: "fill_missing",
});

export interface ImportResult {
  created: number;
  skipped: number;
  quarantined: number;
  runId: string;
  leadIdsByExternalId: Record<string, string>;
}

export async function importSyntheticDealerData(tenantId: string): Promise<ImportResult> {
  const report = await runDeclarativeImport({
    tenantId,
    definition: SYNTHETIC_LEAD_IMPORT,
    source: { name: "synthetic-dealer-leads.json", content: JSON.stringify(SYNTHETIC_DEALER_LEADS) },
  });
  const refs = await withTenant(tenantId, (db) => db.select().from(importEntityRefs).where(and(
    eq(importEntityRefs.tenantId, tenantId), eq(importEntityRefs.sourceSystem, SYNTHETIC_LEAD_IMPORT.sourceSystem), eq(importEntityRefs.entityType, "lead"),
  )));
  return {
    created: report.created,
    skipped: report.skipped,
    quarantined: report.quarantined,
    runId: report.runId,
    leadIdsByExternalId: Object.fromEntries(refs.map((ref) => [ref.sourceId, ref.canonicalEntityId])),
  };
}

const isMain = process.argv[1]?.endsWith("import-synthetic-dealer.ts") || process.argv[1]?.endsWith("import-synthetic-dealer.js");
if (isMain) {
  const tenantId = process.env.IMPORT_TENANT_ID;
  if (!tenantId) { console.error("Set IMPORT_TENANT_ID to the target tenant."); process.exit(1); }
  importSyntheticDealerData(tenantId)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => closePool());
}
