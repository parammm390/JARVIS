// Seeds one test tenant with realistic fake data shaped like the real Culligan-derived
// schema (§29 scaffolding table). Used by local dev and integration tests. Idempotent.

import pg from "pg";
import { pgConnectionConfig } from "./index";
import { PLACEHOLDER_NEEDS_REAL_VALUE } from "@finnor/shared-types";
import { fileURLToPath } from "node:url";

export const SEED_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_OWNER_EMAIL = "owner@test-dealer.finnor.local";

export async function seed(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client(pgConnectionConfig(databaseUrl));
  await client.connect();
  try {
    // Seed SQL is unqualified — resolve it into the finnor_os schema explicitly.
    await client.query("SET search_path = finnor_os, public");
    await client.query("BEGIN");
    // RLS is FORCEd even for the table owner — establish the tenant context first.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [SEED_TENANT_ID]);

    await client.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'Test Dealer Water Co')
       ON CONFLICT (id) DO NOTHING`,
      [SEED_TENANT_ID],
    );

    await client.query(
      `INSERT INTO users (tenant_id, email, role) VALUES
        ($1, $2, 'owner'),
        ($1, 'dispatch@test-dealer.finnor.local', 'dispatcher'),
        ($1, 'tech@test-dealer.finnor.local', 'technician')
       ON CONFLICT (email) DO NOTHING`,
      [SEED_TENANT_ID, SEED_OWNER_EMAIL],
    );

    // households has no natural unique key — guard idempotency explicitly, or every
    // seed run would mint duplicate households (and downstream visits/proposals).
    const { rows: households } = await client.query(
      `INSERT INTO households (tenant_id, address, contact_info, water_profile)
       SELECT v.* FROM (VALUES
        ($1::uuid, '412 Maple Ridge Rd, Cedar Falls, IA', '{"name":"The Hendersons","phone":"+13195550142"}'::jsonb,
         '{"hardness_gpg": 18, "iron_ppm": 0.4, "source": "well"}'::jsonb),
        ($1::uuid, '88 Birchwood Ln, Cedar Falls, IA', '{"name":"Ruth Alvarez","phone":"+13195550177"}'::jsonb,
         '{"hardness_gpg": 11, "iron_ppm": 0.1, "source": "municipal"}'::jsonb)
       ) AS v(tenant_id, address, contact_info, water_profile)
       WHERE NOT EXISTS (SELECT 1 FROM households h WHERE h.tenant_id = $1 AND h.address = v.address)
       RETURNING id`,
      [SEED_TENANT_ID],
    );

    if (households.length > 0) {
      const h1 = households[0].id;
      await client.query(
        `INSERT INTO equipment (household_id, type, model, source)
         VALUES ($1, 'water_softener', 'HE Softener 45k', 'finnor') ON CONFLICT DO NOTHING`,
        [h1],
      );
      await client.query(
        `INSERT INTO maintenance_agreements (household_id, cadence, terms, status, renewal_date)
         VALUES ($1, 'annual', '{"plan":"standard","price_usd":"${PLACEHOLDER_NEEDS_REAL_VALUE}"}', 'renewal_window', now() + interval '21 days')
         ON CONFLICT DO NOTHING`,
        [h1],
      );
    }

    await client.query(
      `INSERT INTO technicians (tenant_id, name, contact_info, availability)
       VALUES ($1, 'Dale Brooks', '{"phone":"+13195550190"}', '{"mon_fri":"08:00-17:00"}')
       ON CONFLICT DO NOTHING`,
      [SEED_TENANT_ID],
    );

    // Evidence-backed policies for the two proven action types (§8 acceptance criteria).
    // Policy VALUES that need real dealer input are placeholder-marked, never guessed.
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'schedule_water_test',
        '{"service_radius_miles":"${PLACEHOLDER_NEEDS_REAL_VALUE}","default_duration_minutes":45,"allowed_windows":["09:00-12:00","13:00-17:00"]}',
        true,
        'Schedule a water test at {{address}} on {{scheduled_at}} with {{technician}}. Approve?'
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='schedule_water_test')`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'renew_maintenance_agreement',
        '{"renewal_window_days":30,"price_usd":"${PLACEHOLDER_NEEDS_REAL_VALUE}","cadence_options":["annual","semi_annual"]}',
        true,
        'Send a renewal offer to {{household}} for their {{cadence}} maintenance agreement. Approve?'
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='renew_maintenance_agreement')`,
      [SEED_TENANT_ID],
    );

    // ---- Real public/standard policy data (extension §6) — safe to fill, not a guess ----
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'generate_compliance_summary',
        '{"pfoa_mcl_ppt":4,"pfos_mcl_ppt":4,"fluoride_mcl_mg_l":4.0,"fluoride_secondary_standard_mg_l":2.0,"hardness_classification_gpg":{"soft":"<1","slightly_hard":"1-3.5","moderately_hard":"3.5-7","hard":"7-10.5","very_hard":">10.5"},"source":"EPA National Primary/Secondary Drinking Water Regulations","paperwork_format":"${PLACEHOLDER_NEEDS_REAL_VALUE}"}',
        false, null
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='generate_compliance_summary')`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'check_reminder_due',
        '{"sediment_filter_months":"3-6","carbon_filter_months":"6-12","ro_membrane_years":"2-3"}',
        false, null
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='check_reminder_due')`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'send_proposal_to_recent_installs',
        '{"pricing_tier":"${PLACEHOLDER_NEEDS_REAL_VALUE}","window_days_default":30,"max_batch":10}',
        true, null
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='send_proposal_to_recent_installs')`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'bulk_notify_existing_customers',
        '{"consent_required":true}',
        true, null
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='bulk_notify_existing_customers')`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, 'answer_customer_question', '{"grounding":"semantic_memory"}', true, null
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type='answer_customer_question')`,
      [SEED_TENANT_ID],
    );

    // Owner phone for voice confirmations + a consented household + a recent install,
    // so voice/batch flows are demonstrable out of the box.
    await client.query(
      `UPDATE tenants SET owner_phone = COALESCE(owner_phone, '${PLACEHOLDER_NEEDS_REAL_VALUE}') WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `UPDATE households SET marketing_consent = true
       WHERE tenant_id = $1 AND address LIKE '412 Maple Ridge%'`,
      [SEED_TENANT_ID],
    );
    await client.query(
      `INSERT INTO service_visits (household_id, type, completed_at, notes)
       SELECT h.id, 'install', now() - interval '10 days', 'HE Softener 45k installed'
       FROM households h
       WHERE h.tenant_id = $1 AND h.address LIKE '412 Maple Ridge%'
         AND NOT EXISTS (
           SELECT 1 FROM service_visits sv WHERE sv.household_id = h.id AND sv.type = 'install'
         )`,
      [SEED_TENANT_ID],
    );

    // Native inventory ledger starting stock (typical dealer consumables).
    await client.query(
      `INSERT INTO inventory_items (tenant_id, sku, name, quantity, reorder_threshold)
       VALUES
        ($1, 'SED-FILT-10', '10" Sediment Filter Cartridge', 24, 10),
        ($1, 'CARB-FILT-10', '10" Carbon Filter Cartridge', 18, 8),
        ($1, 'RO-MEM-75', 'RO Membrane 75 GPD', 6, 3),
        ($1, 'RESIN-CUFT', 'Softener Resin (cu ft)', 12, 4)
       ON CONFLICT (tenant_id, sku) DO NOTHING`,
      [SEED_TENANT_ID],
    );

    // Read-only actions (web research, stock/availability checks, knowledge lookups)
    // answer instantly without a confirmation stop — they change nothing.
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, t.action_type, '{"provider":"exa"}', false, null
       FROM (VALUES ('search_web'), ('scan_competitors'), ('check_business_reviews'), ('check_stock_level'), ('flag_reorder_needed'), ('check_technician_availability'), ('answer_water_question'), ('get_business_overview')) AS t(action_type)
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type=t.action_type)`,
      [SEED_TENANT_ID],
    );

    // RBAC matrix: owners approve everything; dispatchers approve scheduling only.
    await client.query(
      `INSERT INTO role_permissions (tenant_id, role, action_type, can_approve)
       SELECT $1, r.role, r.action_type, r.can_approve FROM (VALUES
         ('owner','*', true),
         ('dispatcher','schedule_water_test', true),
         ('technician','*', false)
       ) AS r(role, action_type, can_approve)
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE tenant_id=$1)`,
      [SEED_TENANT_ID],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => {
      console.log("Seeded test tenant", SEED_TENANT_ID);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
