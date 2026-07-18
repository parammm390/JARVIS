import { describe, it, expect } from "vitest";
import waterTestPlugin from "../../packages/domain-plugins/water-test/index";
import type { DomainPolicy } from "@finnor/shared-types";

const policy: DomainPolicy = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "00000000-0000-4000-8000-000000000001",
  actionType: "schedule_water_test",
  policy: { service_radius_miles: 25, default_duration_minutes: 45, allowed_windows: ["09:00-12:00"] },
  requiresConfirmation: true,
  confirmationTemplate: "Schedule a water test at {{address}} on {{scheduled_at}} with {{technician}}. Approve?",
  version: 1,
};

describe("water-test plugin", () => {
  it("registers its action type", () => {
    expect(waterTestPlugin.actionTypes).toContain("schedule_water_test");
    expect(waterTestPlugin.canHandle("schedule_water_test")).toBe(true);
    expect(waterTestPlugin.canHandle("something_else")).toBe(false);
  });

  it("validates a good payload", () => {
    const res = waterTestPlugin.validate(
      "schedule_water_test",
      { address: "412 Maple Ridge Rd", contactPhone: "+13195550142" },
      policy,
    );
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("rejects a payload missing required fields, with plain-language errors", () => {
    const res = waterTestPlugin.validate("schedule_water_test", { notes: "no address" }, policy);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/address/);
  });

  it("rejects an invalid policy shape", () => {
    const res = waterTestPlugin.validate(
      "schedule_water_test",
      { address: "x", contactPhone: "+13195550142" },
      { ...policy, policy: { service_radius_miles: -4 } },
    );
    expect(res.valid).toBe(false);
  });

  it("drafts a human-readable confirmation from the tenant's template", async () => {
    const draft = await waterTestPlugin.draft(
      "schedule_water_test",
      { address: "412 Maple Ridge Rd", contactPhone: "+13195550142", requestedAt: "2026-07-15T10:00:00Z" },
      policy,
    );
    expect(draft.summary).toContain("412 Maple Ridge Rd");
    expect(draft.summary).toContain("2026-07-15T10:00:00Z");
    expect(draft.requiresConfirmation).toBe(true);
  });
});
