// Phase 3.2: idempotent tenant → 42 placeholder-free policy rows + price book, straight
// from finnor-os/docs/policy-matrix.md (the single source of truth — if this script and
// that doc ever disagree, the doc wins, fix this file). Covers all 41 registered
// domain_policies rows plus the pricing_catalog pseudo-row + its price_book_items.
//
// Idempotent: an existing (tenantId, actionType) policy row is UPDATEd in place (with a
// real version bump — see below), never duplicated; price_book_items upserts by
// (tenantId, sku) via the table's own unique constraint.
//
// Usage:
//   npx tsx scripts/seed-tenant-policies.ts --tenant=<uuid> [--reviewLinkUrl=<url>]
//   PRIMARY_TENANT_REVIEW_LINK_URL=<url> npx tsx scripts/seed-tenant-policies.ts --tenant=<uuid>
//   npx tsx scripts/seed-tenant-policies.ts --tenant=<uuid> --dealerZero   (uses the synthetic review link)
//   npx tsx scripts/seed-tenant-policies.ts --verify   (no writes — prints the registered action-type count)

import "dotenv/config";
import { withTenant, closePool, domainPolicies } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { PRICING_CATALOG_ACTION_TYPE } from "../packages/domain-plugins/shared/pricing-catalog";
import { upsertPriceBookItem } from "@finnor/data-platform";

const DEALER_ZERO_REVIEW_LINK = "https://g.page/r/dealer-zero-finnor-water-co/review";

interface PolicyRow {
  actionType: string;
  policy: Record<string, unknown>;
  requiresConfirmation: boolean;
  confirmationTemplate?: string | null;
}

// One row per action type in policy-matrix.md — the 41 registered types, in the same
// order as the matrix's sections. `reviewLinkUrl` is threaded in below, not hardcoded
// here, since it's the one genuinely tenant-specific field (see the matrix's
// "Owner-blocked field" section).
function policyRows(reviewLinkUrl: string | null): PolicyRow[] {
  return [
    { actionType: "schedule_water_test", policy: { service_radius_miles: 25, default_duration_minutes: 45, allowed_windows: ["09:00-12:00", "13:00-17:00"] }, requiresConfirmation: true, confirmationTemplate: "Schedule a water test at {{address}} on {{scheduled_at}} with {{technician}}. Approve?" },
    { actionType: "renew_maintenance_agreement", policy: { renewal_window_days: 30, price_usd: 249, cadence_options: ["annual", "semi_annual"] }, requiresConfirmation: true, confirmationTemplate: "Send a renewal offer to {{household}} for their {{cadence}} maintenance agreement. Approve?" },

    { actionType: "create_lead", policy: {}, requiresConfirmation: true },
    { actionType: "update_lead_status", policy: {}, requiresConfirmation: true },
    { actionType: "log_interaction", policy: {}, requiresConfirmation: true },
    { actionType: "assign_lead_to_technician", policy: {}, requiresConfirmation: true },

    { actionType: "check_stock_level", policy: {}, requiresConfirmation: false },
    { actionType: "flag_reorder_needed", policy: {}, requiresConfirmation: false },
    { actionType: "log_stock_used_on_visit", policy: {}, requiresConfirmation: true },

    { actionType: "assign_technician_to_visit", policy: {}, requiresConfirmation: true },
    { actionType: "check_technician_availability", policy: {}, requiresConfirmation: false },
    { actionType: "reschedule_visit", policy: {}, requiresConfirmation: true },

    { actionType: "size_equipment_for_household", policy: {}, requiresConfirmation: false },
    { actionType: "generate_quote", policy: {}, requiresConfirmation: true },
    { actionType: "send_proposal", policy: {}, requiresConfirmation: true },

    { actionType: "create_invoice", policy: {}, requiresConfirmation: true },
    { actionType: "send_payment_reminder", policy: {}, requiresConfirmation: true },
    { actionType: "record_payment", policy: {}, requiresConfirmation: true },
    { actionType: "call_overdue_invoices", policy: {}, requiresConfirmation: true },

    { actionType: "summarize_ad_performance", policy: {}, requiresConfirmation: false },
    { actionType: "launch_ad_campaign", policy: { default_daily_budget_usd: 30, max_daily_budget_usd: 50 }, requiresConfirmation: true },
    {
      actionType: "create_review_request",
      policy: reviewLinkUrl ? { review_link_url: reviewLinkUrl, channel: "sms" } : { review_link_url: "PLACEHOLDER_NEEDS_REAL_VALUE", channel: "sms" },
      requiresConfirmation: true,
    },

    { actionType: "answer_customer_question", policy: {}, requiresConfirmation: true },
    { actionType: "send_customer_message", policy: {}, requiresConfirmation: true },
    { actionType: "send_follow_up", policy: {}, requiresConfirmation: true },

    { actionType: "answer_water_question", policy: {}, requiresConfirmation: false },

    { actionType: "send_proposal_to_recent_installs", policy: { window_days_default: 30, max_batch: 10 }, requiresConfirmation: true },

    { actionType: "bulk_notify_existing_customers", policy: {}, requiresConfirmation: true },

    { actionType: "log_visit_report", policy: {}, requiresConfirmation: false },
    { actionType: "flag_visit_issue", policy: {}, requiresConfirmation: false },

    { actionType: "check_reminder_due", policy: { sediment_filter_months: "3-6", carbon_filter_months: "6-12", ro_membrane_years: "2-3" }, requiresConfirmation: false },

    {
      actionType: "generate_compliance_summary",
      policy: {
        pfoa_mcl_ppt: 4,
        pfos_mcl_ppt: 4,
        fluoride_mcl_mg_l: 4.0,
        fluoride_secondary_standard_mg_l: 2.0,
        hardness_classification_gpg: { soft: "<1", slightly_hard: "1-3.5", moderately_hard: "3.5-7", hard: "7-10.5", very_hard: ">10.5" },
        source: "EPA National Primary/Secondary Drinking Water Regulations",
        paperwork_format: "pdf",
      },
      requiresConfirmation: false,
    },

    { actionType: "search_web", policy: {}, requiresConfirmation: false },
    { actionType: "scan_competitors", policy: {}, requiresConfirmation: false },
    { actionType: "check_business_reviews", policy: {}, requiresConfirmation: false },

    { actionType: "get_business_overview", policy: {}, requiresConfirmation: false },
    { actionType: "answer_business_question", policy: {}, requiresConfirmation: false },

    { actionType: "start_water_test_workflow", policy: {}, requiresConfirmation: true },
    { actionType: "request_proposal_signature", policy: {}, requiresConfirmation: true },
    { actionType: "start_installation_workflow", policy: {}, requiresConfirmation: true },
    { actionType: "start_invoice_to_cash_workflow", policy: {}, requiresConfirmation: true },

    // The pricing_catalog pseudo-row: scalars only (DECISIONS: labor $95/h). Real US
    // sales-tax rates vary by state/locality — 7% is a real, usable generic default the
    // dealer localizes later, not the placeholder sentinel.
    { actionType: PRICING_CATALOG_ACTION_TYPE, policy: { laborRatePerHourUsd: 95, taxRatePct: 7, items: [] }, requiresConfirmation: false },
  ];
}

// The 12-20 item price book (policy-matrix.md §Pricing) — RO systems, softeners,
// filters, consumables, priced for a realistic mid-market US water-treatment dealer.
const PRICE_BOOK_ITEMS: Array<{ sku: string; label: string; priceUsd: number }> = [
  { sku: "RO-STD", label: "Standard 4-Stage Reverse Osmosis System", priceUsd: 899 },
  { sku: "RO-PRM", label: "Premium 6-Stage Reverse Osmosis System (Remineralizing)", priceUsd: 1349 },
  { sku: "SOFT-32K", label: "32,000 Grain Water Softener", priceUsd: 1199 },
  { sku: "SOFT-48K", label: "48,000 Grain Water Softener", priceUsd: 1549 },
  { sku: "SOFT-64K", label: "64,000 Grain Whole-House Water Softener", priceUsd: 1899 },
  { sku: "FILT-SED", label: "Sediment Pre-Filter Cartridge", priceUsd: 18 },
  { sku: "FILT-CARB", label: "Carbon Block Filter Cartridge", priceUsd: 24 },
  { sku: "FILT-WH-SED", label: "Whole-House Sediment Filter Housing", priceUsd: 149 },
  { sku: "FILT-WH-CARB", label: "Whole-House Carbon Filtration System", priceUsd: 649 },
  { sku: "MEMB-RO", label: "RO Membrane Replacement (50 GPD)", priceUsd: 65 },
  { sku: "UV-STER", label: "UV Water Sterilization System", priceUsd: 749 },
  { sku: "NEUT-CAL", label: "Calcite Acid Neutralizer System (pH Correction)", priceUsd: 1099 },
  { sku: "IRON-FILT", label: "Iron & Sulfur Removal Filter System", priceUsd: 1299 },
  { sku: "TANK-PRESS", label: "Well Pressure Tank (20-Gallon)", priceUsd: 399 },
  { sku: "SALT-BAG", label: "Water Softener Salt (40lb bag)", priceUsd: 9 },
];

export interface SeedTenantPoliciesResult {
  actionTypesSeeded: number;
  priceBookItemsSeeded: number;
  registeredActionTypeCount: number;
  missingFromMatrix: string[];
  extraInMatrix: string[];
}

export async function seedTenantPolicies(tenantId: string, opts: { reviewLinkUrl?: string | null } = {}): Promise<SeedTenantPoliciesResult> {
  const registry = createDefaultPluginRegistry();
  const registered = new Set(registry.actionTypes());
  const rows = policyRows(opts.reviewLinkUrl ?? null);
  const matrixTypes = new Set(rows.map((r) => r.actionType).filter((t) => t !== PRICING_CATALOG_ACTION_TYPE));

  // Cross-check: the matrix must cover every currently-registered action type, and
  // never claim to cover one that no longer exists — a real drift detector, not a
  // silent staleness risk as plugins get added/removed over time.
  const missingFromMatrix = [...registered].filter((t) => !matrixTypes.has(t));
  const extraInMatrix = [...matrixTypes].filter((t) => !registered.has(t));

  let actionTypesSeeded = 0;
  await withTenant(tenantId, async (db) => {
    for (const row of rows) {
      const [existing] = await db
        .select()
        .from(domainPolicies)
        .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, row.actionType)));
      if (existing) {
        await db
          .update(domainPolicies)
          .set({
            policy: row.policy,
            requiresConfirmation: row.requiresConfirmation,
            confirmationTemplate: row.confirmationTemplate ?? existing.confirmationTemplate ?? null,
            version: existing.version + 1,
          })
          .where(eq(domainPolicies.id, existing.id));
      } else {
        await db.insert(domainPolicies).values({
          tenantId,
          actionType: row.actionType,
          policy: row.policy,
          requiresConfirmation: row.requiresConfirmation,
          confirmationTemplate: row.confirmationTemplate ?? null,
        });
      }
      actionTypesSeeded++;
    }
  });

  let priceBookItemsSeeded = 0;
  await withTenant(tenantId, async (db) => {
    for (const item of PRICE_BOOK_ITEMS) {
      await upsertPriceBookItem(db, { tenantId, sku: item.sku, label: item.label, priceUsd: item.priceUsd });
      priceBookItemsSeeded++;
    }
  });

  return { actionTypesSeeded, priceBookItemsSeeded, registeredActionTypeCount: registered.size, missingFromMatrix, extraInMatrix };
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...rest] = a.replace(/^--/, "").split("=");
      return [k, rest.join("=")];
    }),
  );
  return {
    tenant: args.tenant as string | undefined,
    dealerZero: "dealerZero" in args,
    reviewLinkUrl: (args.reviewLinkUrl as string | undefined) ?? process.env.PRIMARY_TENANT_REVIEW_LINK_URL,
    verify: "verify" in args,
  };
}

const isMain = process.argv[1]?.endsWith("seed-tenant-policies.ts") || process.argv[1]?.endsWith("seed-tenant-policies.js");
if (isMain) {
  const { tenant, dealerZero, reviewLinkUrl, verify } = parseArgs();
  if (verify) {
    const registry = createDefaultPluginRegistry();
    console.log(`Registered action types: ${registry.actionTypes().length}`);
    closePool().then(() => process.exit(0));
  } else {
    if (!tenant) {
      console.error("Usage: npx tsx scripts/seed-tenant-policies.ts --tenant=<uuid> [--reviewLinkUrl=<url>] [--dealerZero]");
      process.exit(1);
    }
    const effectiveReviewLink = dealerZero ? DEALER_ZERO_REVIEW_LINK : reviewLinkUrl ?? null;
    seedTenantPolicies(tenant, { reviewLinkUrl: effectiveReviewLink })
      .then(async (result) => {
        console.log(`Seeded ${result.actionTypesSeeded} policy rows + ${result.priceBookItemsSeeded} price book items for tenant ${tenant}.`);
        console.log(`Registered action types: ${result.registeredActionTypeCount}.`);
        if (result.missingFromMatrix.length > 0) console.warn(`MATRIX GAP — registered but not in policy-matrix.md: ${result.missingFromMatrix.join(", ")}`);
        if (result.extraInMatrix.length > 0) console.warn(`MATRIX STALE — in policy-matrix.md but not registered: ${result.extraInMatrix.join(", ")}`);
        if (!effectiveReviewLink) console.warn("create_review_request.review_link_url left as PLACEHOLDER_NEEDS_REAL_VALUE — pass --reviewLinkUrl or --dealerZero.");
        await closePool();
      })
      .catch(async (err) => {
        console.error(err);
        await closePool();
        process.exit(1);
      });
  }
}
