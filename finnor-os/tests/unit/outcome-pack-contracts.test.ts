import { describe, expect, it } from "vitest";
import { OUTCOME_PACK_IDS } from "@finnor/shared-types";
import { bindOutcomePack, OUTCOME_PACK_DEFINITIONS, outcomePackFingerprint } from "@finnor/orchestration";
import { createOutcomePackCertification, gateResult, OUTCOME_PACK_GATE_KEYS } from "../../scripts/release/certification-model";

const ids = {
  household: "11111111-1111-4111-8111-111111111111",
  workOrder: "22222222-2222-4222-8222-222222222222",
  invoice: "33333333-3333-4333-8333-333333333333",
};

describe("Phase 5 certified Outcome Pack contracts", () => {
  it("defines exactly the five requested business outcomes with stable v1 identities", () => {
    expect(Object.keys(OUTCOME_PACK_DEFINITIONS).sort()).toEqual([...OUTCOME_PACK_IDS].sort());
    for (const pack of Object.values(OUTCOME_PACK_DEFINITIONS)) {
      expect(pack).toMatchObject({ contractVersion: 1, version: 1 });
      expect(pack.supportedTenantPrerequisites.length).toBeGreaterThan(0);
      expect(pack.allowedEffectClasses.length).toBeGreaterThan(0);
      expect(pack.evidenceRequirements.length).toBeGreaterThan(0);
      expect(pack.verificationRules.length).toBeGreaterThan(0);
      expect(pack.terminalBlockedConditions.length).toBeGreaterThan(0);
    }
  });

  it("ties every fingerprint to narrow material dependencies", () => {
    const fingerprints = OUTCOME_PACK_IDS.map(outcomePackFingerprint);
    expect(new Set(fingerprints).size).toBe(OUTCOME_PACK_IDS.length);
    for (const fingerprint of fingerprints) expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const changed = structuredClone(OUTCOME_PACK_DEFINITIONS.lead_to_verified_water_test_booking);
    changed.dependencyVersions.effectCompiler += 1;
    expect(outcomePackFingerprint(changed)).not.toBe(outcomePackFingerprint("lead_to_verified_water_test_booking"));
  });

  it("makes critical safety SLOs zero-valued invariants for all packs", () => {
    for (const pack of Object.values(OUTCOME_PACK_DEFINITIONS)) {
      for (const metric of ["cross_tenant_effects", "unapproved_effects_outside_grant", "duplicate_consequential_effects", "false_verified_success", "secret_exposure"]) {
        expect(pack.slos).toContainEqual(expect.objectContaining({ metric, comparison: "eq", threshold: 0, critical: true }));
      }
    }
  });

  it("keeps financial and irreversible effect classes permanently approval-bound", () => {
    const receivables = OUTCOME_PACK_DEFINITIONS.overdue_receivable_collection;
    expect(receivables.permanentlyApprovalRequiredEffectClasses).toContain("financial_write");
    expect(receivables.approvalBoundaries.join(" ")).toMatch(/charge|refund|amount/i);
    expect(OUTCOME_PACK_DEFINITIONS.general_operator_objective.permanentlyApprovalRequiredEffectClasses).toEqual(expect.arrayContaining(["financial_write", "external_spend", "batch_external"]));
  });

  it("binds Lead to a canonical confirmed-appointment assertion", () => {
    const pack = bindOutcomePack("lead_to_verified_water_test_booking", { householdId: ids.household, mode: "approval" });
    expect(pack.subjectRefs).toEqual([{ entityType: "household", entityId: ids.household }]);
    expect(pack.successCondition.criteria).toContainEqual(expect.objectContaining({
      kind: "canonical_query",
      request: { intent: "company_context", anchor: { entityType: "household", entityId: ids.household } },
      assertion: { path: ["context", "nodes"], operator: "array_contains", expected: { entityType: "appointment", status: "confirmed" } },
    }));
  });

  it("binds stuck operational work to exact canonical completion", () => {
    const pack = bindOutcomePack("stuck_installation_service_resolution", { target: { entityType: "work_order", entityId: ids.workOrder }, mode: "approval" });
    expect(pack.successCondition.criteria).toContainEqual(expect.objectContaining({
      kind: "canonical_query",
      assertion: expect.objectContaining({ expected: { entityType: "work_order", entityId: ids.workOrder, status: "completed" } }),
    }));
  });

  it("binds receivables to paid invoice truth rather than message delivery", () => {
    const pack = bindOutcomePack("overdue_receivable_collection", { invoiceId: ids.invoice, mode: "approval" });
    expect(pack.successCondition.criteria).toContainEqual(expect.objectContaining({
      kind: "canonical_query",
      assertion: expect.objectContaining({ expected: { entityType: "invoice", entityId: ids.invoice, status: "paid" } }),
    }));
    expect(OUTCOME_PACK_DEFINITIONS.overdue_receivable_collection.verificationRules.join(" ")).toMatch(/message delivery is not collection success/i);
  });

  it("binds service lifecycle to booked or completed truth explicitly", () => {
    const booked = bindOutcomePack("service_due_lifecycle", { householdId: ids.household, desiredOutcome: "booked", mode: "shadow" });
    const completed = bindOutcomePack("service_due_lifecycle", { householdId: ids.household, desiredOutcome: "completed", mode: "approval" });
    expect(JSON.stringify(booked.successCondition)).toContain('"entityType":"appointment"');
    expect(JSON.stringify(completed.successCondition)).toContain('"entityType":"service_visit"');
  });

  it("requires an explicit bounded success contract for the general operator pack", () => {
    expect(() => bindOutcomePack("general_operator_objective", { objective: "Resolve it", subjectRefs: [{ entityType: "household", entityId: ids.household }], mode: "approval" })).toThrow();
    const pack = bindOutcomePack("general_operator_objective", {
      objective: "Resolve this exact customer issue without expanding scope.",
      subjectRefs: [{ entityType: "household", entityId: ids.household }],
      mode: "approval",
      successCondition: {
        version: 1, statement: "Exact operator verified state", mode: "all", source: "explicit",
        criteria: [{ kind: "canonical_query", request: { intent: "customer_lookup", householdId: ids.household }, assertion: { path: ["resolution"], operator: "eq", expected: "exact" } }],
      },
    });
    expect(pack.successCondition.source).toBe("explicit");
  });

  it("rejects unsupported target shapes and unknown modes before Work exists", () => {
    expect(() => bindOutcomePack("stuck_installation_service_resolution", { target: { entityType: "invoice", entityId: ids.invoice }, mode: "approval" })).toThrow(/work_order or service_visit/);
    expect(() => bindOutcomePack("lead_to_verified_water_test_booking", { householdId: ids.household, mode: "anything" })).toThrow();
  });

  it("creates content-addressed certification artifacts with the complete gate set", () => {
    const gates = OUTCOME_PACK_GATE_KEYS.map((gate) => gateResult(gate, "PASS", { proven: true }));
    const artifact = createOutcomePackCertification({
      tenantId: ids.household,
      packId: "lead_to_verified_water_test_booking",
      packVersion: 1,
      fingerprint: outcomePackFingerprint("lead_to_verified_water_test_booking"),
      level: "live_provider",
      status: "LIVE_TEST_PASS",
      gates,
      sampleSize: 20,
      criticalViolations: 0,
      certifiedAt: "2026-08-24T00:00:00.000Z",
      validUntil: "2026-11-22T00:00:00.000Z",
    });
    expect(artifact.certificationId).toMatch(/^outcomecert-[0-9a-f]{64}$/);
    expect(artifact.gates).toHaveLength(7);
  });

  it("refuses a passing certification with critical violations", () => {
    expect(() => createOutcomePackCertification({
      tenantId: ids.household,
      packId: "lead_to_verified_water_test_booking",
      packVersion: 1,
      fingerprint: outcomePackFingerprint("lead_to_verified_water_test_booking"),
      level: "production",
      status: "LIVE_TEST_PASS",
      gates: OUTCOME_PACK_GATE_KEYS.map((gate) => gateResult(gate, "PASS")),
      sampleSize: 20,
      criticalViolations: 1,
      validUntil: "2027-01-01T00:00:00.000Z",
    })).toThrow(/critical violations/);
  });

  it("refuses a passing label when any required gate failed", () => {
    const gates = OUTCOME_PACK_GATE_KEYS.map((gate) => gateResult(gate, gate === "acceptance_journeys" ? "FAIL" : "PASS"));
    expect(() => createOutcomePackCertification({
      tenantId: ids.household,
      packId: "lead_to_verified_water_test_booking",
      packVersion: 1,
      fingerprint: outcomePackFingerprint("lead_to_verified_water_test_booking"),
      level: "live_provider",
      status: "LIVE_TEST_PASS",
      gates,
      sampleSize: 20,
      criticalViolations: 0,
      validUntil: "2027-01-01T00:00:00.000Z",
    })).toThrow(/every certification gate/);
  });
});
