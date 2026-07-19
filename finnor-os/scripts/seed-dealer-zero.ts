// Phase 3.2: Dealer Zero — a permanent, real, in-house tenant ("Finnor Water Co.") that
// runs a realistic water-treatment business through the real inbox continuously,
// forever (§3 DECISIONS). Real metro (Cedar Falls / Waterloo, IA — the same real metro
// this codebase's existing synthetic fixtures already use, e.g. packages/db/seed.ts),
// synthetic people: reserved-range phones (+1319555xxxx, the North American fictional
// exchange), @dealerzero.finnorai.com emails. Labeled dealer-zero everywhere via the
// real tenant_settings.is_dealer_zero flag (migration 0024) — never presented as
// customer traffic.
//
// Determinism, done the way that's actually safe for an idempotent script: every random
// value is derived from a PURE hash of (fixed seed, entity kind, index, slot) via
// rngFor() below — never a single shared, sequentially-mutating generator. A shared
// sequence seems deterministic but isn't idempotency-safe the moment any draw is
// conditioned on database state (e.g. "only count this toward a running total if the
// row didn't already exist") — that conditional silently changes how many draws happen
// before the next entity's turn, desyncing every entity after it on a rerun. Per-entity
// hashed generators can't drift: entity i's values depend only on i, never on what ran
// before it or what's already in the database. (Caught this the hard way on the first
// two-runs-in-a-row test of this script — see the commit message.)
//
// Usage: npx tsx scripts/seed-dealer-zero.ts

import "dotenv/config";
import {
  withTenant,
  adminDb,
  closePool,
  tenants,
  tenantSettings,
  households,
  technicians,
  equipment,
  maintenanceAgreements,
  serviceVisits,
  communicationsLog,
  leads,
} from "@finnor/db";
import { createLead } from "@finnor/data-platform";
import { and, eq, sql } from "drizzle-orm";
import {
  DEALER_ZERO_TENANT_ID,
  DEALER_ZERO_TENANT_NAME,
  DEALER_ZERO_AREA_CODE as AREA_CODE,
  DEALER_ZERO_FIRST_NAMES as FIRST_NAMES,
  DEALER_ZERO_LAST_NAMES as LAST_NAMES,
  DEALER_ZERO_EQUIPMENT_TYPES as EQUIPMENT_TYPES,
  rngFor,
  pick,
  intBetween,
  generateHousehold,
} from "@finnor/shared-types";

export { DEALER_ZERO_TENANT_ID, DEALER_ZERO_TENANT_NAME };

const ESTABLISHED_HOUSEHOLD_COUNT = 105;
const OPEN_LEAD_COUNT = 15; // 105 + 15 = 120 households total, per DECISIONS.
const TARGET_AMC_FRACTION = 40 / 105; // "~40" per DECISIONS — an independent per-household draw, not an exact counted target.
const TECHNICIAN_COUNT = 3;

async function ensureDealerZeroTenant(): Promise<void> {
  await adminDb().insert(tenants).values({ id: DEALER_ZERO_TENANT_ID, name: DEALER_ZERO_TENANT_NAME, timezone: "America/Chicago" }).onConflictDoNothing();
  await adminDb()
    .insert(tenantSettings)
    .values({ tenantId: DEALER_ZERO_TENANT_ID, isDealerZero: true, simulatorEnabled: true })
    .onConflictDoUpdate({ target: tenantSettings.tenantId, set: { isDealerZero: true, updatedAt: new Date() } });
}

async function ensureTechnicians(): Promise<string[]> {
  const names = Array.from({ length: TECHNICIAN_COUNT }, (_, i) => {
    const rng = rngFor("technician", i);
    return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
  });
  const ids: string[] = [];
  await withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
    for (let i = 0; i < names.length; i++) {
      const [existing] = await db.select().from(technicians).where(and(eq(technicians.tenantId, DEALER_ZERO_TENANT_ID), eq(technicians.name, names[i]!)));
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const [created] = await db
        .insert(technicians)
        .values({
          tenantId: DEALER_ZERO_TENANT_ID,
          name: names[i]!,
          contactInfo: { phone: `+1${AREA_CODE}5559${String(100 + i).padStart(3, "0")}` },
          availability: { mon_fri: "08:00-17:00" },
        })
        .returning();
      ids.push(created!.id);
    }
  });
  return ids;
}

async function ensureEstablishedHouseholds(technicianIds: string[]): Promise<string[]> {
  const householdIds: string[] = [];
  const now = Date.now();

  await withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
    for (let i = 0; i < ESTABLISHED_HOUSEHOLD_COUNT; i++) {
      const f = generateHousehold("hh", i);
      const [existing] = await db
        .select()
        .from(households)
        .where(and(eq(households.tenantId, DEALER_ZERO_TENANT_ID), sql`${households.contactInfo}->>'dealerZeroKey' = ${f.key}`));
      let householdId: string;
      if (existing) {
        householdId = existing.id;
      } else {
        const [created] = await db
          .insert(households)
          .values({
            tenantId: DEALER_ZERO_TENANT_ID,
            address: f.address,
            contactInfo: { name: f.name, phone: f.phone, email: f.email, dealerZeroKey: f.key },
            waterProfile: { hardness_gpg: f.hardnessGpg, iron_ppm: f.ironPpm, source: f.source },
            marketingConsent: f.marketingConsent,
          })
          .returning();
        householdId = created!.id;
      }
      householdIds.push(householdId);

      // Equipment: 1-2 real items per household, install dates within the last 18mo-5yr
      // window. eqCount and each slot's type/install-date are independently hashed —
      // never dependent on how many prior slots already existed in the database.
      const eqCount = rngFor("equipment-count", i)() < 0.3 ? 2 : 1;
      for (let e = 0; e < eqCount; e++) {
        const slotRng = rngFor("equipment", i, e);
        const spec = pick(slotRng, EQUIPMENT_TYPES);
        const [existingEq] = await db
          .select()
          .from(equipment)
          .where(and(eq(equipment.householdId, householdId), eq(equipment.type, spec.type)));
        if (!existingEq) {
          const installDaysAgo = intBetween(slotRng, 30, 1800);
          await db.insert(equipment).values({
            householdId,
            type: spec.type,
            model: spec.model,
            installDate: new Date(now - installDaysAgo * 24 * 3600 * 1000),
            source: "finnor",
          });
        }
      }

      // 18 months of service history: 1-4 completed visits spread across the window,
      // each slot independently hashed (see equipment above for why that matters).
      const visitCount = intBetween(rngFor("visit-count", i), 1, 4);
      for (let v = 0; v < visitCount; v++) {
        const slotRng = rngFor("visit", i, v);
        const daysAgo = intBetween(slotRng, 1, 545); // ~18 months
        const scheduledAt = new Date(now - daysAgo * 24 * 3600 * 1000);
        const [existingVisit] = await db
          .select()
          .from(serviceVisits)
          .where(and(eq(serviceVisits.householdId, householdId), eq(serviceVisits.type, "maintenance"), sql`date_trunc('day', ${serviceVisits.scheduledAt}) = date_trunc('day', ${scheduledAt.toISOString()}::timestamptz)`));
        if (!existingVisit) {
          await db.insert(serviceVisits).values({
            householdId,
            technicianId: pick(slotRng, technicianIds),
            type: "maintenance",
            scheduledAt,
            completedAt: scheduledAt,
            notes: "Routine maintenance visit — filters/salt checked, readings within normal range.",
          });
        }
      }

      // A light communications trail — one inbound + one outbound per household, dated
      // within the 18-month window, so household-360's merged timeline has something
      // real to show beyond visits/agreements.
      const [existingComm] = await db.select().from(communicationsLog).where(eq(communicationsLog.householdId, householdId));
      if (!existingComm) {
        const commDaysAgo = intBetween(rngFor("comm", i), 1, 500);
        await db.insert(communicationsLog).values([
          { householdId, channel: "sms", direction: "outbound", content: "Hi! This is a reminder your annual water system check-up is coming up. Reply YES to schedule.", timestamp: new Date(now - commDaysAgo * 24 * 3600 * 1000) },
          { householdId, channel: "sms", direction: "inbound", content: "Yes please, thanks!", timestamp: new Date(now - commDaysAgo * 24 * 3600 * 1000 + 3600_000) },
        ]);
      }

      // ~40 of the 105 established households get an AMC (per DECISIONS), renewal
      // dates spread across the year (past and future) so the renewal-scan/reminder
      // machinery has real, varied cases to find. An independent per-household draw,
      // not a running counted target — a counted target would (and, in the first draft
      // of this script, did) desync every household after it the moment a rerun found
      // some agreements already existing and some not.
      if (rngFor("amc-eligible", i)() < TARGET_AMC_FRACTION) {
        const [existingAmc] = await db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.householdId, householdId));
        if (!existingAmc) {
          const renewalOffsetDays = intBetween(rngFor("amc", i), -180, 180);
          await db.insert(maintenanceAgreements).values({
            householdId,
            cadence: "annual",
            terms: { plan: "standard", price_usd: 249 },
            status: "active",
            renewalDate: new Date(now + renewalOffsetDays * 24 * 3600 * 1000),
          });
        }
      }
    }
  });
  return householdIds;
}

async function ensureOpenLeads(): Promise<void> {
  const statuses: Array<"new" | "contacted" | "qualified"> = ["new", "contacted", "qualified"];
  await withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
    for (let i = 0; i < OPEN_LEAD_COUNT; i++) {
      const f = generateHousehold("lead", i);
      const result = await createLead(db, {
        tenantId: DEALER_ZERO_TENANT_ID,
        name: f.name,
        phone: f.phone,
        email: f.email,
        address: f.address,
        source: "voice",
        provenance: { sourceSystem: "dealer_zero_seed", externalId: f.key },
      });
      // createLead defaults status to "new" — vary it deterministically (a pure
      // function of i, so idempotent regardless of alreadyExisted) so the lead
      // pipeline has real cases at every stage, not 15 identical fresh leads.
      const status = pick(rngFor("lead-status", i), statuses);
      if (status !== "new") {
        await db.update(leads).set({ status }).where(eq(leads.id, result.leadId));
      }
    }
  });
}

export interface SeedDealerZeroResult {
  tenantId: string;
  technicianCount: number;
  establishedHouseholdCount: number;
  openLeadCount: number;
}

export async function seedDealerZero(): Promise<SeedDealerZeroResult> {
  await ensureDealerZeroTenant();
  const technicianIds = await ensureTechnicians();
  const householdIds = await ensureEstablishedHouseholds(technicianIds);
  await ensureOpenLeads();
  return {
    tenantId: DEALER_ZERO_TENANT_ID,
    technicianCount: technicianIds.length,
    establishedHouseholdCount: householdIds.length,
    openLeadCount: OPEN_LEAD_COUNT,
  };
}

const isMain = process.argv[1]?.endsWith("seed-dealer-zero.ts") || process.argv[1]?.endsWith("seed-dealer-zero.js");
if (isMain) {
  seedDealerZero()
    .then(async (result) => {
      console.log(`Dealer Zero tenant: ${result.tenantId}`);
      console.log(`Technicians: ${result.technicianCount}, established households: ${result.establishedHouseholdCount}, open leads: ${result.openLeadCount}`);
      console.log(`Total households: ${result.establishedHouseholdCount + result.openLeadCount}`);
      await closePool();
    })
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}
