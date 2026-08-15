import { describe, expect, it } from "vitest"
import { destinationForEntity, filterMatches, groupWorkCases, readWorkSurfaceQuery, stageFor, workCaseMatchesQuery, WORK_CHAPTERS } from "./work-surface-model"
import type { WorkCaseProjection } from "@/lib/jarvis-client"

function workCase(overrides: Partial<WorkCaseProjection> = {}): WorkCaseProjection {
  return {
    id: "instruction:case-1",
    root: { kind: "instruction", id: "case-1" },
    title: "Prepare the service",
    status: "Waiting",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    source: { kind: "instruction", id: "case-1", channel: "typed" },
    instruction: { id: "case-1", text: "Prepare the service", source: "typed", createdAt: "2026-08-08T00:00:00.000Z", lastPhase: "action_created" },
    actions: [],
    approvals: [],
    workflows: [],
    receipts: [],
    linkedEntities: [],
    businessEvents: [],
    calls: [],
    relatedActionIds: [],
    provenance: [],
    ...overrides,
  }
}

describe("P2.T2 Work surface contract", () => {
  it("keeps the exact seven Causal Spine chapters", () => {
    expect(WORK_CHAPTERS).toEqual(["WHY", "PLAN", "OWNER", "APPROVAL", "EXECUTION", "EVIDENCE & OUTCOME", "NEXT ACTION"])
  })

  it("keeps Open and Done as explicit status lanes", () => {
    expect(filterMatches(workCase({ status: "Working" }), "Open")).toBe(true)
    expect(filterMatches(workCase({ status: "Completed" }), "Open")).toBe(false)
    expect(filterMatches(workCase({ status: "Completed" }), "Done")).toBe(true)
    expect(filterMatches(workCase({ status: "Failed" }), "Failed")).toBe(true)
  })

  it("derives the current chapter from exact observed records", () => {
    expect(stageFor(workCase({ actions: [{ id: "a", actionType: "send_message", status: "pending", summary: "Ask", instructionId: "case-1", planId: null, dependsOn: [], payload: {}, createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" }] }))).toBe("Plan")
    expect(stageFor(workCase({ status: "Needs you", approvals: [{ actionId: "a", status: "pending", decidedBy: null, decidedAt: null, pendingConfirmationId: "c" }] }))).toBe("Approval")
    expect(stageFor(workCase({ status: "Completed", receipts: [{ id: "r", workflowRunId: null, workflowStepId: null, domainActionId: null, objective: "Done", evidence: [], approval: {}, expectedResult: null, actualResult: null, failure: null, correlationId: null, createdAt: "2026-08-08T00:00:00.000Z", finalizedAt: "2026-08-08T00:00:00.000Z" }] }))).toBe("Evidence & outcome")
  })

  it("round-trips only exact deep-link identifiers across operational surfaces", () => {
    const linked = workCase({
      id: "case-exact",
      linkedEntities: [
        { entityType: "household", entityId: "hh-1", via: "action.payload.householdId" },
        { entityType: "invoice", entityId: "invoice-1", via: "action.payload.invoiceId" },
        { entityType: "service_visit", entityId: "visit-1", via: "action.payload.serviceVisitId" },
      ],
    })
    const query = readWorkSurfaceQuery("?workCaseId=case-exact&invoiceId=invoice-1&householdId=hh-1&serviceVisitId=visit-1")
    expect(workCaseMatchesQuery(linked, readWorkSurfaceQuery(""))).toBe(true)
    expect(workCaseMatchesQuery(linked, query)).toBe(true)
    expect(workCaseMatchesQuery(workCase({ id: "case-other", linkedEntities: [{ entityType: "household", entityId: "hh-1", via: "action.payload.householdId" }] }), query)).toBe(false)
    const durable = workCase({ id: "work:work-1", root: { kind: "work", id: "work-1" } })
    expect(workCaseMatchesQuery(durable, readWorkSurfaceQuery("?workCaseId=work-1"))).toBe(true)
    expect(workCaseMatchesQuery(durable, readWorkSurfaceQuery("?workCaseId=work:work-1"))).toBe(true)
    expect(workCaseMatchesQuery(linked, readWorkSurfaceQuery("?workCaseId=case-1&householdId=unrelated"))).toBe(true)
    expect(destinationForEntity(linked.linkedEntities[0]!, linked)).toBe("/jarvis/customers?workCaseId=case-exact&householdId=hh-1")
    expect(destinationForEntity(linked.linkedEntities[1]!, linked)).toBe("/jarvis/money?workCaseId=case-exact&householdId=hh-1&invoiceId=invoice-1")
    expect(destinationForEntity(linked.linkedEntities[2]!, linked)).toBe("/jarvis/schedule?workCaseId=case-exact&householdId=hh-1&serviceVisitId=visit-1")
  })

  it("groups repeated queue patterns without dropping their exact records", () => {
    const first = workCase({ id: "case-1", title: "Get business overview", status: "Needs you" })
    const second = workCase({ id: "case-2", title: "  Get   business overview ", status: "Needs you" })
    const completed = workCase({ id: "case-3", title: "Get business overview", status: "Completed" })

    const groups = groupWorkCases([first, second, completed])
    expect(groups).toHaveLength(2)
    expect(groups.find((group) => group.cases[0]?.status === "Needs you")?.cases.map((item) => item.id)).toEqual(["case-1", "case-2"])
    expect(groups.flatMap((group) => group.cases)).toHaveLength(3)
  })
})
