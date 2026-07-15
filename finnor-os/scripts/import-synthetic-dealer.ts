// Blueprint's required Phase 1 proof (docs/jarvis-90-execution-blueprint.md §1):
// "import synthetic dealer data, replay the import twice with no duplicates, and
// produce quality findings for malformed or ambiguous data." Real fixture data run
// through the real repository layer (@finnor/data-platform) against a real tenant —
// see tests/integration/canonical-data-import.test.ts for the actual proof assertions.

import "dotenv/config";
import { withTenant, closePool } from "@finnor/db";
import { createLead } from "@finnor/data-platform";

export interface SyntheticLeadFixture {
  externalId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

// Deliberately includes:
//  - synth-001/synth-002: a duplicate candidate pair (same phone, near-identical name,
//    different external_id — two import rows for what's probably the same customer).
//  - synth-004: a malformed row (no phone, no email — nothing to reach them by).
//  - synth-005: a stale-data candidate (see the test, which backdates its activity).
export const SYNTHETIC_DEALER_LEADS: SyntheticLeadFixture[] = [
  { externalId: "synth-001", name: "Harold Voss", phone: "+13195551001", address: "12 Birchwood Ave, Cedar Falls, IA" },
  { externalId: "synth-002", name: "Harold Voss Jr", phone: "+13195551001", address: "12 Birchwood Ave, Cedar Falls, IA" },
  { externalId: "synth-003", name: "Priya Nandakumar", phone: "+13195551003", email: "priya.n@example.com" },
  { externalId: "synth-004", name: "(unknown caller)" },
  { externalId: "synth-005", name: "Deborah Alt", phone: "+13195551005" },
];

export interface ImportResult {
  created: number;
  skipped: number;
  leadIdsByExternalId: Record<string, string>;
}

export async function importSyntheticDealerData(tenantId: string): Promise<ImportResult> {
  let created = 0;
  let skipped = 0;
  const leadIdsByExternalId: Record<string, string> = {};

  for (const fixture of SYNTHETIC_DEALER_LEADS) {
    const result = await withTenant(tenantId, (db) =>
      createLead(db, {
        tenantId,
        name: fixture.name,
        phone: fixture.phone,
        email: fixture.email,
        address: fixture.address,
        notes: fixture.notes,
        provenance: { sourceSystem: "synthetic_dealer_import", externalId: fixture.externalId },
      }),
    );
    leadIdsByExternalId[fixture.externalId] = result.leadId;
    if (result.alreadyExisted) skipped++;
    else created++;
  }

  return { created, skipped, leadIdsByExternalId };
}

const isMain = process.argv[1]?.endsWith("import-synthetic-dealer.ts") || process.argv[1]?.endsWith("import-synthetic-dealer.js");
if (isMain) {
  const tenantId = process.env.IMPORT_TENANT_ID;
  if (!tenantId) {
    console.error("Set IMPORT_TENANT_ID to the target tenant.");
    process.exit(1);
  }
  importSyntheticDealerData(tenantId)
    .then((result) => {
      console.log(`Imported: ${result.created} created, ${result.skipped} skipped (already existed).`);
      return closePool();
    })
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}
