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
    // Maps the seed tenant's registered Vapi line to VAPI_PHONE_NUMBER_ID (the real
    // Vapi assistant's dialed-number id) when the env var is present, so the tenant
    // resolver's preferred match key (vapi_phone_number_id) works out of the box in
    // any environment carrying that env var — single-tenant deploys don't need this
    // row (resolveTenantFromCall falls back to VAPI_DEFAULT_TENANT_ID).
    if (process.env.VAPI_PHONE_NUMBER_ID) {
      await client.query(
        `INSERT INTO tenant_phone_numbers (tenant_id, phone_number, vapi_phone_number_id, label)
         SELECT $1, '${PLACEHOLDER_NEEDS_REAL_VALUE}', $2, 'seed default line'
         WHERE NOT EXISTS (SELECT 1 FROM tenant_phone_numbers WHERE vapi_phone_number_id = $2)
         ON CONFLICT DO NOTHING`,
        [SEED_TENANT_ID, process.env.VAPI_PHONE_NUMBER_ID],
      );
    }
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

    // Native inventory ledger starting stock (typical dealer consumables). One item
    // (UV bulbs) is seeded BELOW its reorder threshold on purpose — a real dealer's
    // inventory always has at least one thing running low, and the reorder-alert path
    // (flag_reorder_needed, get_business_overview) needs a real case to demonstrate,
    // not just "everything's fine" every time.
    await client.query(
      `INSERT INTO inventory_items (tenant_id, sku, name, quantity, reorder_threshold)
       VALUES
        ($1, 'SED-FILT-10', '10" Sediment Filter Cartridge', 24, 10),
        ($1, 'CARB-FILT-10', '10" Carbon Filter Cartridge', 18, 8),
        ($1, 'RO-MEM-75', 'RO Membrane 75 GPD', 6, 3),
        ($1, 'RESIN-CUFT', 'Softener Resin (cu ft)', 12, 4),
        ($1, 'UV-BULB-STD', 'UV Sterilizer Replacement Bulb', 2, 5),
        ($1, 'PREFILT-HSG', 'Pre-Filter Housing Assembly', 9, 3)
       ON CONFLICT (tenant_id, sku) DO NOTHING`,
      [SEED_TENANT_ID],
    );

    // ---- Additional technicians (varied specialties/coverage, not just one) ----
    await client.query(
      `INSERT INTO technicians (tenant_id, name, contact_info, availability)
       SELECT $1, v.name, v.contact::jsonb, v.avail::jsonb FROM (VALUES
         ('Priya Nair', '{"phone":"+13195550212","specialty":"RO/UV systems"}', '{"tue_sat":"07:30-16:00"}'),
         ('Sam Okonkwo', '{"phone":"+13195550233","specialty":"softener install"}', '{"mon_fri":"09:00-18:00"}')
       ) AS v(name, contact, avail)
       WHERE NOT EXISTS (SELECT 1 FROM technicians t WHERE t.tenant_id = $1 AND t.name = v.name)`,
      [SEED_TENANT_ID],
    );

    // ---- Full customer roster across every lifecycle stage — this is the point:
    // a real dealer's book of business is never all in one state. Six new households,
    // each seeded with the service history and workflow state that stage implies, so
    // "customer lifecycles" and "win-back candidates" both have real, varied answers
    // instead of two households stuck at the same stage forever. ----
    const { rows: newHouseholds } = await client.query(
      `INSERT INTO households (tenant_id, address, contact_info, water_profile, marketing_consent)
       SELECT v.* FROM (VALUES
        ($1::uuid, '215 Cypress Ct, Cedar Falls, IA', '{"name":"Marcus Webb","phone":"+13195550301"}'::jsonb, '{"hardness_gpg": 14, "iron_ppm": 0.6, "source": "well"}'::jsonb, true),
        ($1::uuid, '77 Fieldstone Dr, Cedar Falls, IA', '{"name":"The Okafors","phone":"+13195550322"}'::jsonb, '{"hardness_gpg": 9, "iron_ppm": 0.2, "source": "municipal"}'::jsonb, true),
        ($1::uuid, '340 Prairie View Ave, Cedar Falls, IA', '{"name":"Linda Chen","phone":"+13195550344"}'::jsonb, '{"hardness_gpg": 16, "iron_ppm": 0.3, "source": "well"}'::jsonb, true),
        ($1::uuid, '19 Willow Bend Rd, Cedar Falls, IA', '{"name":"The Petersons","phone":"+13195550366"}'::jsonb, '{"hardness_gpg": 13, "iron_ppm": 0.5, "source": "well"}'::jsonb, true),
        ($1::uuid, '502 Timber Ridge Rd, Waterloo, IA', '{"name":"Angela Ruiz","phone":"+13195550388"}'::jsonb, '{"hardness_gpg": 12, "iron_ppm": 0.4, "source": "municipal"}'::jsonb, true),
        ($1::uuid, '88 Sable Creek Ln, Waterloo, IA', '{"name":"The Whitfields","phone":"+13195550399"}'::jsonb, '{"hardness_gpg": 15, "iron_ppm": 0.7, "source": "well"}'::jsonb, true)
       ) AS v(tenant_id, address, contact_info, water_profile, marketing_consent)
       WHERE NOT EXISTS (SELECT 1 FROM households h WHERE h.tenant_id = $1 AND h.address = v.address)
       RETURNING id, address`,
      [SEED_TENANT_ID],
    );
    const byAddr = (needle: string) => newHouseholds.find((r) => r.address.startsWith(needle))?.id as string | undefined;
    const marcus = byAddr("215 Cypress");
    const okafors = byAddr("77 Fieldstone");
    const lindaChen = byAddr("340 Prairie");
    const petersons = byAddr("19 Willow");
    const angela = byAddr("502 Timber");
    const whitfields = byAddr("88 Sable");

    if (marcus) {
      // Test completed, no quote yet — the exact case that lets a live call demo
      // "generate a quote for Marcus" end to end.
      await client.query(
        `INSERT INTO service_visits (household_id, type, completed_at, notes)
         VALUES ($1, 'water_test', now() - interval '4 days', 'Hardness 14 gpg, iron 0.6 ppm — softener + iron filter recommended')
         ON CONFLICT DO NOTHING`,
        [marcus],
      );
      await client.query(
        `INSERT INTO workflow_states (tenant_id, workflow, subject_type, subject_id, state, history)
         SELECT $1, 'lead_to_install', 'household', $2, 'test_completed',
           jsonb_build_array(
             jsonb_build_object('from','lead','to','water_test_scheduled','cause','schedule_water_test','at',(now() - interval '9 days')::text),
             jsonb_build_object('from','water_test_scheduled','to','test_completed','cause','log_visit_report','at',(now() - interval '4 days')::text)
           )
         WHERE NOT EXISTS (SELECT 1 FROM workflow_states WHERE tenant_id = $1 AND subject_id = $2)`,
        [SEED_TENANT_ID, marcus],
      );
    }
    if (okafors) {
      await client.query(
        `INSERT INTO service_visits (household_id, type, completed_at, notes)
         VALUES ($1, 'water_test', now() - interval '11 days', 'Municipal supply, moderate hardness — softener only')
         ON CONFLICT DO NOTHING`,
        [okafors],
      );
      await client.query(
        `INSERT INTO proposals (household_id, content, status, sent_at)
         SELECT $1, '{"summary":"HE Softener 32k package","price_note":"per current price sheet"}'::jsonb, 'sent', now() - interval '3 days'
         WHERE NOT EXISTS (SELECT 1 FROM proposals WHERE household_id = $1)`,
        [okafors],
      );
      await client.query(
        `INSERT INTO workflow_states (tenant_id, workflow, subject_type, subject_id, state, history)
         SELECT $1, 'lead_to_install', 'household', $2, 'quote_sent',
           jsonb_build_array(
             jsonb_build_object('from','lead','to','water_test_scheduled','cause','schedule_water_test'),
             jsonb_build_object('from','water_test_scheduled','to','test_completed','cause','log_visit_report'),
             jsonb_build_object('from','test_completed','to','quote_sent','cause','generate_quote','at',(now() - interval '3 days')::text)
           )
         WHERE NOT EXISTS (SELECT 1 FROM workflow_states WHERE tenant_id = $1 AND subject_id = $2)`,
        [SEED_TENANT_ID, okafors],
      );
    }
    if (lindaChen) {
      await client.query(
        `INSERT INTO equipment (household_id, type, model, source, install_date)
         VALUES ($1, 'water_softener', 'HE Softener 45k', 'finnor', now() - interval '6 days') ON CONFLICT DO NOTHING`,
        [lindaChen],
      );
      await client.query(
        `INSERT INTO service_visits (household_id, type, completed_at, notes)
         VALUES ($1, 'install', now() - interval '6 days', 'HE Softener 45k installed, system tested and running')
         ON CONFLICT DO NOTHING`,
        [lindaChen],
      );
      await client.query(
        `INSERT INTO maintenance_agreements (household_id, cadence, terms, status, renewal_date)
         VALUES ($1, 'annual', '{"plan":"standard","price_usd":"${PLACEHOLDER_NEEDS_REAL_VALUE}"}', 'active', now() + interval '359 days')
         ON CONFLICT DO NOTHING`,
        [lindaChen],
      );
      await client.query(
        `INSERT INTO invoices (tenant_id, household_id, amount_usd, status, memo, due_date)
         SELECT $1, $2, '2450.00', 'paid', 'HE Softener 45k — install', now() - interval '5 days'
         WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE household_id = $2)`,
        [SEED_TENANT_ID, lindaChen],
      );
      await client.query(
        `INSERT INTO workflow_states (tenant_id, workflow, subject_type, subject_id, state, history)
         SELECT $1, 'lead_to_install', 'household', $2, 'installed',
           jsonb_build_array(
             jsonb_build_object('from','lead','to','water_test_scheduled','cause','schedule_water_test'),
             jsonb_build_object('from','water_test_scheduled','to','test_completed','cause','log_visit_report'),
             jsonb_build_object('from','test_completed','to','quote_sent','cause','generate_quote'),
             jsonb_build_object('from','quote_sent','to','installed','cause','log_visit_report','at',(now() - interval '6 days')::text)
           )
         WHERE NOT EXISTS (SELECT 1 FROM workflow_states WHERE tenant_id = $1 AND subject_id = $2)`,
        [SEED_TENANT_ID, lindaChen],
      );
    }
    if (petersons) {
      // Fully closed loop, AND the one overdue invoice — the exact case for
      // "call the people who haven't paid" to have something real to find.
      await client.query(
        `INSERT INTO equipment (household_id, type, model, source, install_date)
         VALUES ($1, 'water_softener', 'HE Softener 32k', 'finnor', now() - interval '35 days') ON CONFLICT DO NOTHING`,
        [petersons],
      );
      await client.query(
        `INSERT INTO service_visits (household_id, type, completed_at, notes)
         VALUES ($1, 'install', now() - interval '35 days', 'HE Softener 32k installed')
         ON CONFLICT DO NOTHING`,
        [petersons],
      );
      await client.query(
        `INSERT INTO invoices (tenant_id, household_id, amount_usd, status, memo, due_date)
         SELECT $1, $2, '1890.00', 'overdue', 'HE Softener 32k — install', now() - interval '14 days'
         WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE household_id = $2)`,
        [SEED_TENANT_ID, petersons],
      );
      await client.query(
        `INSERT INTO communications_log (household_id, channel, direction, content, timestamp)
         SELECT $1, 'call', 'outbound', 'Post-install follow-up — customer satisfied, mentioned invoice would be paid "this week"', now() - interval '20 days'
         WHERE NOT EXISTS (SELECT 1 FROM communications_log WHERE household_id = $1)`,
        [petersons],
      );
      await client.query(
        `INSERT INTO workflow_states (tenant_id, workflow, subject_type, subject_id, state, history)
         SELECT $1, 'lead_to_install', 'household', $2, 'follow_up_sent',
           jsonb_build_array(
             jsonb_build_object('from','lead','to','water_test_scheduled','cause','schedule_water_test'),
             jsonb_build_object('from','water_test_scheduled','to','test_completed','cause','log_visit_report'),
             jsonb_build_object('from','test_completed','to','quote_sent','cause','generate_quote'),
             jsonb_build_object('from','quote_sent','to','installed','cause','log_visit_report'),
             jsonb_build_object('from','installed','to','follow_up_sent','cause','send_proposal_to_recent_installs','at',(now() - interval '20 days')::text)
           )
         WHERE NOT EXISTS (SELECT 1 FROM workflow_states WHERE tenant_id = $1 AND subject_id = $2)`,
        [SEED_TENANT_ID, petersons],
      );
    }
    // Angela Ruiz + the Whitfields: real past customers with NO recent contact —
    // genuine win-back candidates (3-6 months inactive), not fabricated on the fly.
    if (angela) {
      await client.query(
        `INSERT INTO equipment (household_id, type, model, source, install_date)
         VALUES ($1, 'water_softener', 'Standard Softener 32k', 'finnor', now() - interval '210 days') ON CONFLICT DO NOTHING`,
        [angela],
      );
      await client.query(
        `INSERT INTO communications_log (household_id, channel, direction, content, timestamp)
         SELECT $1, 'call', 'outbound', 'Annual service reminder call — no answer, left voicemail', now() - interval '152 days'
         WHERE NOT EXISTS (SELECT 1 FROM communications_log WHERE household_id = $1)`,
        [angela],
      );
      await client.query(
        `INSERT INTO maintenance_agreements (household_id, cadence, terms, status, renewal_date)
         VALUES ($1, 'annual', '{"plan":"standard","price_usd":"${PLACEHOLDER_NEEDS_REAL_VALUE}"}', 'lapsed', now() - interval '60 days')
         ON CONFLICT DO NOTHING`,
        [angela],
      );
    }
    if (whitfields) {
      await client.query(
        `INSERT INTO equipment (household_id, type, model, source, install_date)
         VALUES ($1, 'water_softener', 'HE Softener 45k', 'finnor', now() - interval '180 days') ON CONFLICT DO NOTHING`,
        [whitfields],
      );
      await client.query(
        `INSERT INTO communications_log (household_id, channel, direction, content, timestamp)
         SELECT $1, 'sms', 'outbound', 'Filter change reminder texted', now() - interval '128 days'
         WHERE NOT EXISTS (SELECT 1 FROM communications_log WHERE household_id = $1)`,
        [whitfields],
      );
    }

    // Read-only actions (web research, stock/availability checks, knowledge lookups)
    // answer instantly without a confirmation stop — they change nothing.
    await client.query(
      `INSERT INTO domain_policies (tenant_id, action_type, policy, requires_confirmation, confirmation_template)
       SELECT $1, t.action_type, '{"provider":"exa"}', false, null
       FROM (VALUES ('search_web'), ('scan_competitors'), ('check_business_reviews'), ('check_stock_level'), ('flag_reorder_needed'), ('check_technician_availability'), ('answer_water_question'), ('get_business_overview'), ('summarize_ad_performance'), ('answer_business_question')) AS t(action_type)
       WHERE NOT EXISTS (SELECT 1 FROM domain_policies WHERE tenant_id=$1 AND action_type=t.action_type)`,
      [SEED_TENANT_ID],
    );

    // RBAC matrix (Phase 16d): owners approve everything; dispatchers approve
    // scheduling/communication action types only (the ones a dispatcher's job
    // actually touches — never invoicing, never anything with money); technicians
    // approve nothing. No-rows-for-a-tenant falls back to owner-only (canApprove's
    // safe default) — this baseline exists so a real tenant isn't relying on that
    // fallback alone.
    await client.query(
      `INSERT INTO role_permissions (tenant_id, role, action_type, can_approve)
       SELECT $1, r.role, r.action_type, r.can_approve FROM (VALUES
         ('owner','*', true),
         ('dispatcher','schedule_water_test', true),
         ('dispatcher','reschedule_visit', true),
         ('dispatcher','assign_technician_to_visit', true),
         ('dispatcher','send_customer_message', true),
         ('dispatcher','send_follow_up', true),
         ('dispatcher','start_water_test_workflow', true),
         ('technician','*', false)
       ) AS r(role, action_type, can_approve)
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE tenant_id=$1)`,
      [SEED_TENANT_ID],
    );

    // A3.T1: tenant_integrations rows for the seed/Dealer Zero tenant, matching A1's
    // audited reality (not aspirational) — crm/scheduling/inventory/documents run
    // native (Finnor's own tables, no external SaaS behind them), communications runs
    // real Vapi, and esign/accounting/payments/marketing stay emulator until a real
    // vendor account is wired (A3.T5 does email; DocuSign/QuickBooks/Stripe/ad-platform
    // write-scope remain future work per §3/§8). A tenant with no row here still
    // resolves correctly via env/default (binding-resolution.ts) — this just lets
    // setup/status show a "tenant" source for the one tenant that actually exists today.
    await client.query(
      `INSERT INTO tenant_integrations (tenant_id, capability, binding, mode)
       SELECT $1, t.capability, t.binding, t.mode FROM (VALUES
         ('crm', 'native', 'real'),
         ('scheduling', 'native', 'real'),
         ('inventory', 'native', 'real'),
         ('documents', 'native', 'real'),
         ('communications', 'vapi', 'real'),
         ('esign', 'emulator', 'emulator'),
         ('accounting', 'emulator', 'emulator'),
         ('payments', 'emulator', 'emulator'),
         ('marketing', 'emulator', 'emulator')
       ) AS t(capability, binding, mode)
       ON CONFLICT (tenant_id, capability) DO NOTHING`,
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
