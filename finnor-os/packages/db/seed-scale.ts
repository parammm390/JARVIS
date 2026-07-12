// Scale-up seed: generates a large, realistic book of business (100+ households) on
// top of the base seed() — real names, real address variety, real spread across every
// lifecycle stage, real invoice states, real communications history with actual
// experience-quality notes. This is what makes "customer lifecycles," "win-back
// candidates," and "business overview" answer with genuine variety instead of two or
// three hand-placed examples. Idempotent: guarded by a `source = 'seed_scale'` marker
// in contact_info so re-runs never duplicate.
//
// Not part of seed()/tests on purpose — this is bulk demo-realistic volume, not the
// small fixed dataset integration tests assert exact counts against.

import pg from "pg";
import { pgConnectionConfig } from "./index";
import { fileURLToPath } from "node:url";
import { SEED_TENANT_ID } from "./seed";

const FIRST_NAMES = [
  "James", "Maria", "Robert", "Linda", "Michael", "Susan", "William", "Karen", "David", "Nancy",
  "Richard", "Betty", "Joseph", "Sandra", "Thomas", "Ashley", "Charles", "Dorothy", "Christopher", "Lisa",
  "Daniel", "Emily", "Matthew", "Kimberly", "Anthony", "Donna", "Mark", "Michelle", "Paul", "Carol",
  "Steven", "Amanda", "Andrew", "Melissa", "Kenneth", "Deborah", "George", "Stephanie", "Joshua", "Rebecca",
  "Kevin", "Sharon", "Brian", "Laura", "Edward", "Cynthia", "Ronald", "Kathleen", "Timothy", "Amy",
];
const LAST_NAMES = [
  "Novak", "Hendricks", "Beckman", "Ostrander", "Kowalski", "Pruitt", "Delgado", "Whitfield", "Mercer", "Larsen",
  "Boone", "Castellano", "Voss", "Iverson", "Salazar", "Winslow", "Habermann", "Reyes", "Duchamp", "Krueger",
  "Falkner", "Osei", "Bellweather", "Nakamura", "Torres", "Higgins", "Vance", "Okafor", "Radcliffe", "Sundberg",
  "Petrov", "Grissom", "Ferreira", "Lindqvist", "Bianchi", "Okonkwo", "Mabry", "Suzuki", "Halvorsen", "Cortez",
  "Ashworth", "Doyle", "Kimball", "Renner", "Aoki", "Blackwood", "Sorensen", "Tavares", "Whitaker", "Ngo",
];
const STREETS = [
  "Maple Ridge Rd", "Birchwood Ln", "Cypress Ct", "Fieldstone Dr", "Prairie View Ave", "Willow Bend Rd",
  "Timber Ridge Rd", "Sable Creek Ln", "Hawthorne St", "Redwood Ct", "Sunset Meadow Dr", "Elm Grove Ave",
  "Cottonwood Ln", "Bluestem Trail", "Rolling Hills Rd", "Meadowlark Dr", "Autumn Ridge Ct", "Spruce St",
  "Heritage Oaks Dr", "Silver Birch Ln", "Windsor Ct", "Foxrun Trail", "Kestrel Way", "Amberly Rd",
  "Northgate Dr", "Pheasant Run", "Blackhawk Trail", "Cedar Bluff Rd", "Orchard View Ln", "Stonecrest Dr",
];
const TOWNS = ["Cedar Falls, IA", "Waterloo, IA", "Denver, IA", "La Porte City, IA", "Evansdale, IA", "Hudson, IA", "Dike, IA"];

const GOOD_NOTES = [
  "Very happy with the install, mentioned she'd recommend us to her neighbor.",
  "Resolved same day, no complaints, texted a thank-you after the visit.",
  "Extremely satisfied — asked about a referral discount for a friend.",
  "Routine check-in, everything running fine, no issues raised.",
  "Asked detailed questions about PFAS treatment, left satisfied with the answers.",
  "Complimented the technician's punctuality and cleanup after the job.",
  "Confirmed the softener has noticeably improved water taste, very pleased.",
];
const NEUTRAL_NOTES = [
  "No answer, left a voicemail with the callback number.",
  "Asked to reschedule the appointment, new time confirmed.",
  "Quick check-in call, customer said everything's fine, kept it short.",
  "Requested a text instead of calls going forward — noted on file.",
];
const ROUGH_NOTES = [
  "Frustrated about a 2-hour arrival window, technician apologized and gave a discount code.",
  "Filed a minor complaint about a missed appointment — rescheduled and resolved.",
  "Mentioned the salt delivery was late last month; flagged to dispatch.",
  "Asked twice about the invoice before it was corrected — apologized for the confusion.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function phoneFor(i: number): string {
  return `+1319${String(6000000 + i).padStart(7, "0")}`;
}

// Lead-to-install funnel shape: most volume early, tapering toward the end — a real
// dealer's book of business always looks like a funnel, not a flat distribution.
const STAGE_WEIGHTS: Array<{ state: string; weight: number }> = [
  { state: "lead", weight: 22 },
  { state: "water_test_scheduled", weight: 20 },
  { state: "test_completed", weight: 16 },
  { state: "quote_sent", weight: 16 },
  { state: "installed", weight: 14 },
  { state: "follow_up_sent", weight: 12 },
];
function pickStage(): string {
  const total = STAGE_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of STAGE_WEIGHTS) {
    if (r < w.weight) return w.state;
    r -= w.weight;
  }
  return "lead";
}

export async function seedAtScale(databaseUrl = process.env.DATABASE_URL, count = 110): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client(pgConnectionConfig(databaseUrl));
  await client.connect();
  try {
    await client.query("SET search_path = finnor_os, public");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [SEED_TENANT_ID]);

    const [already] = (
      await client.query(
        `SELECT count(*)::int AS n FROM households WHERE tenant_id = $1 AND contact_info ->> 'seedSource' = 'seed_scale'`,
        [SEED_TENANT_ID],
      )
    ).rows;
    if (already.n > 0) {
      console.log(`seed-scale already applied (${already.n} households) — skipping. Delete them manually to re-run.`);
      return;
    }

    const usedNames = new Set<string>();
    const rows: Array<{
      name: string;
      address: string;
      phone: string;
      consent: boolean;
      hardness: number;
      iron: number;
      source: "well" | "municipal";
      stage: string;
    }> = [];
    for (let i = 0; i < count; i++) {
      let name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      let tries = 0;
      while (usedNames.has(name) && tries < 10) {
        name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        tries++;
      }
      usedNames.add(name);
      rows.push({
        name,
        // House number derived from the loop index, not pure random — guarantees every
        // address is unique (downstream code correlates rows back to a household by
        // address, so a collision would silently misfile one customer's history under
        // another's record).
        address: `${100 + i} ${pick(STREETS)}, ${pick(TOWNS)}`,
        phone: phoneFor(i),
        consent: Math.random() < 0.72,
        hardness: randInt(6, 24),
        iron: Math.round((Math.random() * 1.1 + 0.05) * 10) / 10,
        source: Math.random() < 0.55 ? "well" : "municipal",
        stage: pickStage(),
      });
    }

    await client.query("BEGIN");

    const householdsPayload = rows.map((r) => ({
      tenant_id: SEED_TENANT_ID,
      address: r.address,
      contact_info: { name: r.name, phone: r.phone, seedSource: "seed_scale" },
      water_profile: { hardness_gpg: r.hardness, iron_ppm: r.iron, source: r.source },
      marketing_consent: r.consent,
    }));
    const { rows: inserted } = await client.query(
      `INSERT INTO households (tenant_id, address, contact_info, water_profile, marketing_consent)
       SELECT tenant_id, address, contact_info, water_profile, marketing_consent
       FROM jsonb_to_recordset($1::jsonb)
         AS x(tenant_id uuid, address text, contact_info jsonb, water_profile jsonb, marketing_consent boolean)
       RETURNING id, address`,
      [JSON.stringify(householdsPayload)],
    );
    // Correlate returned ids back to the generated rows via address (unique per row here).
    const idByAddress = new Map(inserted.map((r: { id: string; address: string }) => [r.address, r.id]));

    const technicianRows = (await client.query(`SELECT id FROM technicians WHERE tenant_id = $1`, [SEED_TENANT_ID])).rows;
    const techIds: string[] = technicianRows.map((t: { id: string }) => t.id);

    let visitsBatch: string[] = [];
    let visitsParams: unknown[] = [];
    let commsBatch: string[] = [];
    let commsParams: unknown[] = [];
    let invoicesBatch: string[] = [];
    let invoicesParams: unknown[] = [];
    let equipmentBatch: string[] = [];
    let equipmentParams: unknown[] = [];
    let wsBatch: string[] = [];
    let wsParams: unknown[] = [];

    const STAGE_TO_VISIT: Record<string, string | null> = {
      lead: null,
      water_test_scheduled: "water_test",
      test_completed: "water_test",
      quote_sent: "water_test",
      installed: "install",
      follow_up_sent: "install",
    };

    let vp = 1,
      cp = 1,
      ip = 1,
      ep = 1,
      wp = 1;

    for (const r of rows) {
      const hhId = idByAddress.get(r.address);
      if (!hhId) continue;
      const visitType = STAGE_TO_VISIT[r.stage];
      const daysAgo = randInt(1, 240);
      const techId = techIds.length > 0 ? pick(techIds) : null;

      if (visitType) {
        const completed = r.stage !== "water_test_scheduled"; // that one stage means SCHEDULED, not completed yet
        visitsBatch.push(
          `($${vp++}, $${vp++}, $${vp++}, ${completed ? `now() - interval '${daysAgo} days'` : "NULL"}, ${completed ? "NULL" : `now() + interval '${randInt(1, 14)} days'`}, $${vp++})`,
        );
        visitsParams.push(hhId, techId, visitType, `${visitType === "install" ? "System installed" : "Water test"} — ${r.hardness} gpg hardness, ${r.iron} ppm iron`);
      }

      // Communications history: everyone gets at least one entry; more for
      // further-along customers, spread across a wide, realistic time range.
      const commCount = r.stage === "lead" ? 1 : randInt(1, 3);
      for (let c = 0; c < commCount; c++) {
        const ago = randInt(2, 260);
        const note = ago > 90 ? pick([...NEUTRAL_NOTES, ...ROUGH_NOTES]) : pick([...GOOD_NOTES, ...NEUTRAL_NOTES]);
        commsBatch.push(`($${cp++}, $${cp++}, $${cp++}, $${cp++}, now() - interval '${ago} days')`);
        commsParams.push(hhId, pick(["call", "sms", "email"]), pick(["inbound", "outbound"]), note);
      }

      if (r.stage === "installed" || r.stage === "follow_up_sent") {
        const amount = randInt(890, 3200);
        const status = Math.random() < 0.72 ? "paid" : Math.random() < 0.6 ? "overdue" : "sent";
        const dueDaysAgo = status === "overdue" ? randInt(3, 45) : -randInt(3, 30);
        invoicesBatch.push(`($${ip++}, $${ip++}, $${ip++}, $${ip++}, $${ip++}, now() - interval '${dueDaysAgo} days')`);
        invoicesParams.push(SEED_TENANT_ID, hhId, amount.toFixed(2), status, "Water treatment system — install");

        equipmentBatch.push(`($${ep++}, $${ep++}, $${ep++}, $${ep++}, now() - interval '${daysAgo} days')`);
        equipmentParams.push(hhId, "water_softener", pick(["HE Softener 32k", "HE Softener 45k", "Standard Softener 24k"]), "finnor");
      }

      wsBatch.push(`($${wp++}, $${wp++}, 'household', $${wp++}, $${wp++}, $${wp++}::jsonb)`);
      wsParams.push(
        SEED_TENANT_ID,
        "lead_to_install",
        hhId,
        r.stage,
        JSON.stringify([{ from: null, to: r.stage, cause: "seed_scale", at: new Date(Date.now() - daysAgo * 86400000).toISOString() }]),
      );
    }

    if (visitsBatch.length > 0) {
      await client.query(
        `INSERT INTO service_visits (household_id, technician_id, type, completed_at, scheduled_at, notes) VALUES ${visitsBatch.join(",")}`,
        visitsParams,
      );
    }
    if (commsBatch.length > 0) {
      await client.query(
        `INSERT INTO communications_log (household_id, channel, direction, content, timestamp) VALUES ${commsBatch.join(",")}`,
        commsParams,
      );
    }
    if (invoicesBatch.length > 0) {
      await client.query(
        `INSERT INTO invoices (tenant_id, household_id, amount_usd, status, memo, due_date) VALUES ${invoicesBatch.join(",")}`,
        invoicesParams,
      );
    }
    if (equipmentBatch.length > 0) {
      await client.query(
        `INSERT INTO equipment (household_id, type, model, source, install_date) VALUES ${equipmentBatch.join(",")}`,
        equipmentParams,
      );
    }
    if (wsBatch.length > 0) {
      await client.query(
        `INSERT INTO workflow_states (tenant_id, workflow, subject_type, subject_id, state, history) VALUES ${wsBatch.join(",")}`,
        wsParams,
      );
    }

    await client.query("COMMIT");
    console.log(`seed-scale: added ${inserted.length} households (${count} generated) with visits/comms/invoices/workflow states.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedAtScale()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
