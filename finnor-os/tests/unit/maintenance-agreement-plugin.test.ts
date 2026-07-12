import { describe, it, expect } from "vitest";
import maintenanceAgreementPlugin from "../../packages/domain-plugins/maintenance-agreement/index";
import type { DomainPolicy } from "@finnor/shared-types";

const policy: DomainPolicy = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: "00000000-0000-4000-8000-000000000001",
  actionType: "renew_maintenance_agreement",
  policy: { renewal_window_days: 30, price_usd: 199, cadence_options: ["annual"] },
  requiresConfirmation: true,
  confirmationTemplate: "Send a renewal offer to {{household}} for their {{cadence}} maintenance agreement. Approve?",
};

describe("maintenance-agreement plugin", () => {
  it("validates a good renewal payload", () => {
    const res = maintenanceAgreementPlugin.validate(
      "renew_maintenance_agreement",
      { householdLabel: "The Hendersons", contactPhone: "+13195550142", cadence: "annual" },
      policy,
    );
    expect(res.valid).toBe(true);
  });

  it("rejects a cadence the dealer does not offer (policy-driven, not hardcoded)", () => {
    const res = maintenanceAgreementPlugin.validate(
      "renew_maintenance_agreement",
      { householdLabel: "The Hendersons", contactPhone: "+13195550142", cadence: "quarterly" },
      policy,
    );
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/quarterly/);
  });

  it("drafts the renewal summary and default SMS copy", async () => {
    const draft = await maintenanceAgreementPlugin.draft(
      "renew_maintenance_agreement",
      { householdLabel: "The Hendersons", contactPhone: "+13195550142", cadence: "annual" },
      policy,
    );
    expect(draft.summary).toContain("The Hendersons");
    expect(String(draft.payload.message)).toMatch(/renewal/i);
  });
});
