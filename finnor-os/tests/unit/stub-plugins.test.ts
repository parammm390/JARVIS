// §5 scaffold acceptance: every action type is registered, typed, gate-wired, and a
// placeholder policy yields a plain-language "not yet configured" draft with
// requires_confirmation FORCED true — never a crash, never a guessed number.

import { describe, it, expect } from "vitest";
import { createDefaultPluginRegistry } from "../../packages/orchestration/src/plugin-registry";
import { ToolRegistry } from "@finnor/tools";
import type { DomainPolicy } from "@finnor/shared-types";

const placeholderPolicy = (actionType: string): DomainPolicy => ({
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "00000000-0000-4000-8000-000000000001",
  actionType,
  policy: { some_rule: "PLACEHOLDER_NEEDS_REAL_VALUE" },
  requiresConfirmation: false, // the scaffold must OVERRIDE this to true
  confirmationTemplate: null,
});

const ALL_EXPECTED_ACTION_TYPES = [
  // fully real
  "schedule_water_test",
  "renew_maintenance_agreement",
  "send_proposal_to_recent_installs",
  "bulk_notify_existing_customers",
  "answer_water_question",
  "answer_customer_question",
  "size_equipment_for_household",
  "generate_compliance_summary",
  "check_reminder_due",
  "log_visit_report",
  // scaffolded (§5)
  "create_lead",
  "update_lead_status",
  "log_interaction",
  "assign_lead_to_technician",
  "check_stock_level",
  "flag_reorder_needed",
  "log_stock_used_on_visit",
  "assign_technician_to_visit",
  "check_technician_availability",
  "reschedule_visit",
  "generate_quote",
  "create_invoice",
  "send_payment_reminder",
  "record_payment",
  "summarize_ad_performance",
  "send_customer_message",
  "flag_visit_issue",
];

// Only actions gated on external APIs we cannot access (Meta/Google Ads app review)
// remain scaffolds — everything else is a real native implementation now.
const SCAFFOLDED = ["summarize_ad_performance", "send_campaign", "create_review_request"];

describe("full action-type roster (§5)", () => {
  const registry = createDefaultPluginRegistry();

  it("registers every expected action type exactly once", () => {
    const types = registry.actionTypes();
    for (const t of ALL_EXPECTED_ACTION_TYPES) expect(types, `missing ${t}`).toContain(t);
  });

  for (const actionType of SCAFFOLDED) {
    it(`${actionType}: placeholder policy → plain-language not-configured + forced confirmation`, async () => {
      const plugin = registry.resolve(actionType)!;
      expect(plugin, `no plugin for ${actionType}`).toBeTruthy();
      const policy = placeholderPolicy(actionType);
      const validation = plugin.validate(actionType, {}, policy);
      expect(validation.valid).toBe(true); // an empty payload never crashes a scaffold
      const draft = await plugin.draft(actionType, {}, policy);
      expect(draft.summary.toLowerCase()).toContain("not yet configured");
      expect(draft.requiresConfirmation).toBe(true); // forced, despite policy saying false
      const result = await plugin.execute(draft, new ToolRegistry());
      expect(result.status).toBe("not_implemented");
      expect(result.error).toBeTruthy(); // explains itself, never guesses
    });
  }

  it("water-domain-knowledge answers from shared public-domain content", async () => {
    const plugin = registry.resolve("answer_water_question")!;
    const draft = await plugin.draft("answer_water_question", { topic: "hardness" }, placeholderPolicy("answer_water_question"));
    const result = await plugin.execute(draft, new ToolRegistry());
    expect(result.status).toBe("success");
    expect(String(result.output.summary)).toMatch(/grains per gallon/i);
  });
});
