import type { CausalReplayProjection, ExecutionProjection } from "@finnor/shared-types";
import { describe, expect, it } from "vitest";
import { sourceBundleFromCausalReplay, sourceBundleFromExecutionProjection } from "./adapters";
import { compileProcedureCandidateFromBundles } from "./compiler";
import { normalizeExecutionTrace } from "./normalize";
import { P6_OPTIONS, reminderBundle } from "../fixtures/locked-corpus";

const now = "2026-08-01T10:00:00.000Z";

describe("existing governed evidence adapters", () => {
  it("compiles adapted governed evidence through one pure offline entry point", () => {
    const result = compileProcedureCandidateFromBundles([
      reminderBundle({ suffix: "offline-entry-a" }),
      reminderBundle({ suffix: "offline-entry-b" }),
    ], P6_OPTIONS);
    expect(result.candidate).toMatchObject({
      executionStatus: "NON_EXECUTABLE_HYPOTHESIS",
      certificationStatus: "UNCERTIFIED_P6_HYPOTHESIS",
    });
    expect(result.traceValidation.every((row) => row.validation.realSuccess)).toBe(true);
  });
  it("normalizes an ExecutionProjection without creating a replacement event ledger", () => {
    const projection: ExecutionProjection = {
      version: 1,
      work: {
        id: "work-projection",
        status: "completed",
        executionModel: "atomic_action",
        objective: "Send verified reminder",
        objectiveState: "completed",
        successCondition: null,
        successVerification: { version: 1, state: "verified", checkedAt: now, conditionHash: "condition", results: [], evidence: [], queryExecutionIds: [] },
        successVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
        finalOutcome: { status: "done" },
        failure: null,
      },
      targets: [],
      nodes: [{
        id: "action-projection",
        planId: "plan-projection",
        actionType: "send_reminder",
        businessVerb: "communicate.reminder",
        summary: "Send reminder",
        sourceStatus: "completed",
        status: "succeeded",
        semanticPayload: { customerId: "customer-private" },
        businessEffect: null,
        targets: [],
        dependencyIds: [],
        dependentIds: [],
        blockedBy: [],
        actor: null,
        route: { application: "communications", provider: "provider", identity: null, route: "api", source: "persisted_execution", sourceRef: "application_account:one" },
        authority: { state: "allowed", decisionId: "authority-one", revision: 2, operation: "execution", outcome: "allowed", risk: "medium", reasonCode: "ALLOWED", employeeId: "employee", sourceRef: "authority_decision:one" },
        approval: { required: true, status: "approved", requestId: "approval-one", currentStep: 1, totalSteps: 1, decidedBy: null, decidedAt: now, consequence: "Customer receives reminder", sourceRef: "approval_request:one" },
        intent: { expectedResult: { delivered: true }, source: "receipt" },
        observation: { actualResult: { delivered: true }, evidence: [{ source: "provider_event", ref: "delivery-one", timestamp: now, restricted: false }], verification: "verified", basis: "provider delivery observed" },
        externalEffect: "confirmed",
        failure: null,
        workflowRunIds: [],
        receiptIds: ["receipt-one"],
        computer: null,
        controls: [],
        timestamps: { createdAt: now, executionStartedAt: now, lastChangedAt: now },
        sourceRefs: ["domain_action:action-projection"],
      }],
      edges: [],
      workflows: [],
      receipts: [],
      viewer: { role: "owner", evidenceVisibility: "full" },
      limits: { actions: 10, workflowSteps: 10, computerStepsPerRun: 10, evidencePerReceipt: 10 },
      truncated: { actions: false, workflowSteps: false, computerSteps: false, evidence: false },
      asOf: now,
    };
    const trace = normalizeExecutionTrace(sourceBundleFromExecutionProjection({ tenantId: "tenant-one", projection }), P6_OPTIONS);
    expect(trace.outcome).toBe("SUCCESS");
    expect(trace.provenance.sourceIdentities.workIds).toEqual(["work-projection"]);
    expect(trace.nodes.some((node) => node.semanticKind === "AUTHORITY_GATE")).toBe(true);
    expect(trace.nodes.some((node) => node.semanticKind === "APPROVAL_GATE")).toBe(true);
    expect(trace.nodes.some((node) => node.semanticKind === "VERIFICATION" && node.observations.some((observation) => observation.externalRealityRequired))).toBe(true);
  });

  it("preserves missing causal edges and provider ambiguity from CausalReplay", () => {
    const replay: CausalReplayProjection = {
      version: 1,
      mode: "read_only",
      work: { id: "work-replay", status: "running", executionModel: "objective", objective: "Observe payment", objectiveState: "running", successCondition: null, successVerification: null, createdAt: now, updatedAt: now },
      nodes: [{ id: "provider-ack", stage: "provider", title: "Provider acknowledged", summary: "ACK", status: "unknown", occurredAt: now, sourceRefs: ["provider_operation:one"], evidence: [], facts: { acknowledgement: true }, entityRefs: [] }],
      edges: [{ id: "missing-edge", from: "missing-action", to: "provider-ack", relation: "caused", certainty: "missing", evidenceRefs: [], explanation: "legacy gap" }],
      moments: [],
      explanation: { trigger: "", context: "", plan: "", governance: "", execution: "", verification: "", outcome: "", gaps: ["missing action"] },
      completeness: { status: "partial", provenEdges: 0, missingEdges: 1, missing: ["action"] },
      viewer: { role: "owner", evidenceVisibility: "full" },
      readOnlyGuarantee: { source: "durable_projection", method: "GET", mutationControlsIncluded: false, sideEffectsPossible: false },
      limits: { nodes: 10, edges: 10, actionEvents: 10, computerArtifacts: 10 },
      truncated: { nodes: false, edges: false, actionEvents: false, computerArtifacts: false },
      asOf: now,
    };
    const trace = normalizeExecutionTrace(sourceBundleFromCausalReplay({ tenantId: "tenant-one", replay }), P6_OPTIONS);
    expect(trace.outcome).toBe("CORRUPT");
    expect(trace.provenance.uncertainty).toContain("EDGE_ENDPOINT_MISSING");
    expect(trace.provenance.uncertainty).toContain("MISSING_CAUSAL_EDGE:missing-edge");
  });
});
