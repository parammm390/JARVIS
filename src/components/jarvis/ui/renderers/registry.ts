// D3.T1 — the renderer registry: all 41 action types -> flagship/standard tier +
// fixture, per plan spec ("renderers/registry.ts: all 41 types -> renderer +
// fixture. Tiers: flagship / standard (schema-driven designed card, plugin-family
// styling) / designed fallback"). Field lists for the 30 standard-tier types are
// hand-authored from each plugin's real zod schema (packages/domain-plugins/*, read
// file-by-file this session) — never guessed, never a generic "dump all keys" mode.
//
// Zero raw-JSON default surfaces: getRendererEntry() always resolves to a tier;
// FallbackRenderer.tsx (a designed, debug-gated backstop) is the only path that can
// ever show raw JSON, and only for a genuinely unregistered type — none of the 41
// real ones hit it.

import type { ComponentType } from "react"
import { WaterTestScene } from "./flagships/WaterTestScene"
import { QuotationScene } from "./flagships/QuotationScene"
import { InventoryScene } from "./flagships/InventoryScene"
import { SchedulingScene } from "./flagships/SchedulingScene"
import { InvoiceToCashScene } from "./flagships/InvoiceToCashScene"
import { BulkNotifyScene } from "./flagships/BulkNotifyScene"
import { LeadToWaterTestScene } from "./flagships/LeadToWaterTestScene"
import { ACTION_FIXTURES } from "./fixtures"
import type { ActionRendererProps, FieldSpec, RegistryEntry } from "./types"

const f = (key: string, label: string, kind: FieldSpec["kind"]): FieldSpec => ({ key, label, kind })

// ---------------------------------------------------------------------------
// The 11 flagship-tier action types (7 non-voice-call flagship scenes; VoiceCallScene
// is wired separately, keyed on `calls` rows not an action type — see its own header).
// ---------------------------------------------------------------------------
const FLAGSHIP_COMPONENT: Record<string, ComponentType<ActionRendererProps>> = {
  schedule_water_test: WaterTestScene,
  generate_quote: QuotationScene,
  check_stock_level: InventoryScene,
  flag_reorder_needed: InventoryScene,
  log_stock_used_on_visit: InventoryScene,
  assign_technician_to_visit: SchedulingScene,
  check_technician_availability: SchedulingScene,
  reschedule_visit: SchedulingScene,
  start_invoice_to_cash_workflow: InvoiceToCashScene,
  bulk_notify_existing_customers: BulkNotifyScene,
  start_water_test_workflow: LeadToWaterTestScene,
}

// ---------------------------------------------------------------------------
// Standard-tier field specs, one entry per remaining action type, grouped by plugin
// (comment headers match packages/domain-plugins/<name> exactly).
// ---------------------------------------------------------------------------
const STANDARD_FIELDS: Record<string, { plugin: string; label: string; fields: FieldSpec[] }> = {
  // maintenance-agreement
  renew_maintenance_agreement: {
    plugin: "maintenance-agreement",
    label: "Renew Maintenance Agreement",
    fields: [f("householdLabel", "household", "text"), f("contactPhone", "phone", "phone"), f("cadence", "cadence", "enum"), f("message", "message", "longtext")],
  },
  // crm
  create_lead: {
    plugin: "crm",
    label: "Create Lead",
    fields: [f("name", "name", "text"), f("phone", "phone", "phone"), f("address", "address", "text"), f("email", "email", "email"), f("notes", "notes", "longtext")],
  },
  update_lead_status: {
    plugin: "crm",
    label: "Update Lead Status",
    fields: [f("householdId", "household", "uuid"), f("phone", "phone", "phone"), f("status", "status", "enum")],
  },
  log_interaction: {
    plugin: "crm",
    label: "Log Interaction",
    fields: [f("phone", "phone", "phone"), f("channel", "channel", "enum"), f("direction", "direction", "enum"), f("content", "content", "longtext")],
  },
  assign_lead_to_technician: {
    plugin: "crm",
    label: "Assign Lead to Technician",
    fields: [f("phone", "phone", "phone"), f("technicianName", "technician", "text")],
  },
  // quotation (non-flagship)
  size_equipment_for_household: {
    plugin: "quotation",
    label: "Size Equipment",
    fields: [
      f("hardnessGpg", "hardness (gpg)", "number"),
      f("ironPpm", "iron (ppm)", "number"),
      f("peopleInHousehold", "household size", "number"),
      f("gallonsPerPersonPerDay", "gal/person/day", "number"),
    ],
  },
  send_proposal: {
    plugin: "quotation",
    label: "Send Proposal",
    fields: [f("proposalId", "proposal", "uuid"), f("channel", "channel", "enum"), f("email", "email", "email"), f("phone", "phone", "phone")],
  },
  // accounting
  create_invoice: {
    plugin: "accounting",
    label: "Create Invoice",
    fields: [
      f("customerName", "customer", "text"),
      f("amountUsd", "amount", "currency"),
      f("memo", "memo", "text"),
      f("dueDate", "due date", "date"),
    ],
  },
  send_payment_reminder: { plugin: "accounting", label: "Payment Reminder", fields: [f("invoiceId", "invoice", "uuid"), f("channel", "channel", "enum")] },
  record_payment: { plugin: "accounting", label: "Record Payment", fields: [f("invoiceId", "invoice", "uuid")] },
  call_overdue_invoices: { plugin: "accounting", label: "Call Overdue Invoices", fields: [] },
  // marketing
  summarize_ad_performance: { plugin: "marketing", label: "Summarize Ad Performance", fields: [f("windowDays", "window (days)", "number")] },
  launch_ad_campaign: {
    plugin: "marketing",
    label: "Launch Ad Campaign",
    fields: [f("name", "name", "text"), f("dailyBudgetUsd", "daily budget", "currency"), f("objective", "objective", "text"), f("targetZip", "target zip", "text")],
  },
  create_review_request: {
    plugin: "marketing",
    label: "Create Review Request",
    fields: [f("contactName", "contact", "text"), f("phone", "phone", "phone"), f("email", "email", "email")],
  },
  // customer-comm
  answer_customer_question: { plugin: "customer-comm", label: "Answer Customer Question", fields: [f("question", "question", "longtext")] },
  send_customer_message: {
    plugin: "customer-comm",
    label: "Send Customer Message",
    fields: [f("phone", "phone", "phone"), f("email", "email", "email"), f("message", "message", "longtext"), f("channel", "channel", "enum")],
  },
  send_follow_up: { plugin: "customer-comm", label: "Send Follow-Up", fields: [f("phone", "phone", "phone"), f("context", "context", "text")] },
  // water-domain-knowledge
  answer_water_question: { plugin: "water-domain-knowledge", label: "Answer Water Question", fields: [f("topic", "topic", "text")] },
  // proposal-batch
  send_proposal_to_recent_installs: {
    plugin: "proposal-batch",
    label: "Proposal Batch — Recent Installs",
    fields: [f("windowDays", "window (days)", "number"), f("limit", "limit", "number"), f("offerNote", "offer note", "text")],
  },
  // technician-reports
  log_visit_report: {
    plugin: "technician-reports",
    label: "Log Visit Report",
    fields: [f("report", "report", "longtext"), f("markCompleted", "mark completed", "boolean")],
  },
  flag_visit_issue: { plugin: "technician-reports", label: "Flag Visit Issue", fields: [f("issue", "issue", "longtext")] },
  // service-reminders
  check_reminder_due: {
    plugin: "service-reminders",
    label: "Check Reminder Due",
    fields: [f("equipmentType", "equipment", "enum"), f("lastServicedAt", "last serviced", "date")],
  },
  // compliance-documentation
  generate_compliance_summary: {
    plugin: "compliance-documentation",
    label: "Compliance Summary",
    fields: [f("householdLabel", "household", "text")],
  },
  // web-research
  search_web: { plugin: "web-research", label: "Search Web", fields: [f("query", "query", "text"), f("numResults", "results", "number")] },
  scan_competitors: { plugin: "web-research", label: "Scan Competitors", fields: [f("area", "area", "text"), f("focus", "focus", "text")] },
  check_business_reviews: { plugin: "web-research", label: "Check Business Reviews", fields: [f("businessName", "business", "text"), f("area", "area", "text")] },
  // ops-overview
  get_business_overview: { plugin: "ops-overview", label: "Business Overview", fields: [f("focus", "focus", "enum")] },
  answer_business_question: { plugin: "ops-overview", label: "Answer Business Question", fields: [f("question", "question", "longtext")] },
  // proposal-signature
  request_proposal_signature: {
    plugin: "proposal-signature",
    label: "Request Proposal Signature",
    fields: [f("proposalId", "proposal", "uuid"), f("signerName", "signer", "text"), f("signerEmail", "signer email", "email")],
  },
  // proposal-to-installation
  start_installation_workflow: {
    plugin: "proposal-to-installation",
    label: "Start Installation",
    fields: [f("quoteId", "quote", "uuid"), f("sku", "sku", "text"), f("quantity", "quantity", "number"), f("depositAmountUsd", "deposit", "currency")],
  },
}

// ---------------------------------------------------------------------------
// Plugin ownership of every flagship-tier action type (needed for StandardRenderer's
// sibling accent even though flagships render their own chrome — kept here so one
// table, not two, maps action type -> plugin).
// ---------------------------------------------------------------------------
const FLAGSHIP_PLUGIN: Record<string, string> = {
  schedule_water_test: "water-test",
  generate_quote: "quotation",
  check_stock_level: "inventory",
  flag_reorder_needed: "inventory",
  log_stock_used_on_visit: "inventory",
  assign_technician_to_visit: "scheduling",
  check_technician_availability: "scheduling",
  reschedule_visit: "scheduling",
  start_invoice_to_cash_workflow: "invoice-to-cash",
  bulk_notify_existing_customers: "bulk-notify",
  start_water_test_workflow: "lead-to-water-test",
}

function buildRegistry(): Record<string, RegistryEntry> {
  const registry: Record<string, RegistryEntry> = {}
  for (const [actionType, Component] of Object.entries(FLAGSHIP_COMPONENT)) {
    registry[actionType] = {
      tier: "flagship",
      plugin: FLAGSHIP_PLUGIN[actionType]!,
      label: actionType.replaceAll("_", " "),
      Component,
      fixture: ACTION_FIXTURES[actionType],
    }
  }
  for (const [actionType, spec] of Object.entries(STANDARD_FIELDS)) {
    registry[actionType] = {
      tier: "standard",
      plugin: spec.plugin,
      label: spec.label,
      fields: spec.fields,
      fixture: ACTION_FIXTURES[actionType],
    }
  }
  return registry
}

export const ACTION_RENDERERS: Record<string, RegistryEntry> = buildRegistry()

export function getRendererEntry(actionType: string): RegistryEntry | undefined {
  return ACTION_RENDERERS[actionType]
}

/** All 41 real action types this registry covers — used by the Stage catalog and by
 *  tests/verification, never re-derived from a different source (single source of
 *  truth, matches §1's "41 action types" count exactly). */
export const REGISTERED_ACTION_TYPES: string[] = Object.keys(ACTION_RENDERERS)
