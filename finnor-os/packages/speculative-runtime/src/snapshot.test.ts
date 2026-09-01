import { describe, expect, it } from "vitest";
import { internalCanonicalWriteProgram } from "../../operational-ir/fixtures/p2-programs";
import { materializeWorldSnapshot, createInMemoryWorldSnapshotSource, deriveSnapshotMaterializationSelectors } from "./snapshot";
import { P5_TEST_NOW, P5_TEST_TENANT, snapshotForProgram } from "./test-support";

describe("P5 immutable WorldSnapshot", () => {
  it("materializes only program/effect state with deterministic provenance-backed identity", async () => {
    const program = internalCanonicalWriteProgram();
    const first = await snapshotForProgram({ program });
    const second = await snapshotForProgram({ program });
    expect(second).toEqual(first);
    expect(first.snapshotId).toMatch(/^p5:snapshot:sha256:[0-9a-f]{64}$/);
    expect(first.canonicalState).toHaveLength(1);
    expect(first.provenance.materializationSelectors).toEqual(deriveSnapshotMaterializationSelectors(program));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.canonicalState)).toBe(true);
    expect(() => (first.canonicalState[0]!.values.status = "mutated")).toThrow();
  });

  it("fails closed on cross-tenant state and leaves canonical input untouched", async () => {
    const program = internalCanonicalWriteProgram();
    const entity = program.entities[0]!;
    if (entity.resolution.status !== "resolved") throw new Error("fixture drift");
    const canonical = {
      tenantId: "10000000-0000-4000-8000-000000000002",
      ref: { kind: "entity" as const, type: entity.entityType, id: entity.resolution.canonical.id },
      values: { status: "open" },
      observedAt: P5_TEST_NOW,
      provenance: { owner: "fixture", sourceRef: "fixture:cross-tenant", evidenceRefs: [] },
    };
    const source = createInMemoryWorldSnapshotSource({ tenantId: P5_TEST_TENANT, canonicalState: [canonical], workState: [], relevantObservations: [], sourceRefs: [] });
    await expect(materializeWorldSnapshot({ tenantId: P5_TEST_TENANT, asOf: P5_TEST_NOW, program, source })).rejects.toThrow(/CROSS_TENANT_WORLD_ACCESS/);
    expect(canonical.values.status).toBe("open");
  });

  it("projects only requested selector fields and drops extra source payload", async () => {
    const program = internalCanonicalWriteProgram();
    const entity = program.entities[0]!;
    if (entity.resolution.status !== "resolved") throw new Error("fixture drift");
    const source = createInMemoryWorldSnapshotSource({
      tenantId: P5_TEST_TENANT,
      canonicalState: [{
        tenantId: P5_TEST_TENANT,
        ref: { kind: entity.resolution.canonical.kind, type: entity.resolution.canonical.type, id: entity.resolution.canonical.id },
        values: {
          status: "active",
          tasks: { confirmationFollowup: { exists: false }, unrelated: "not-requested" },
          secret: "must-never-enter-snapshot",
          unrestrictedPayload: { arbitrary: true },
        },
        observedAt: P5_TEST_NOW,
        provenance: { owner: "fixture", sourceRef: "fixture:overwide-row", evidenceRefs: [] },
      }],
      workState: [],
      relevantObservations: [],
      sourceRefs: ["fixture:overwide-row"],
    });
    const snapshot = await materializeWorldSnapshot({ tenantId: P5_TEST_TENANT, asOf: P5_TEST_NOW, program, source });
    expect(JSON.stringify(snapshot.canonicalState[0]!.values)).not.toContain("must-never-enter-snapshot");
    expect(snapshot.canonicalState[0]!.values).not.toHaveProperty("unrestrictedPayload");
    expect(snapshot.canonicalState[0]!.values).toHaveProperty("tasks.confirmationFollowup.exists", false);
  });

  it("rejects a source that returns a world row outside the derived selector set", async () => {
    const program = internalCanonicalWriteProgram();
    const source = {
      mode: "READ_ONLY" as const,
      sourceId: "fixture:unbounded-source",
      async materialize() {
        return {
          tenantId: P5_TEST_TENANT,
          canonicalState: [{
            tenantId: P5_TEST_TENANT,
            ref: { kind: "entity" as const, type: "unrequested", id: "unrequested-1" },
            values: { status: "open" },
            observedAt: P5_TEST_NOW,
            provenance: { owner: "fixture", sourceRef: "fixture:unrequested", evidenceRefs: [] },
          }],
          workState: [],
          relevantObservations: [],
          sourceRefs: ["fixture:unrequested"],
        };
      },
    };
    await expect(materializeWorldSnapshot({ tenantId: P5_TEST_TENANT, asOf: P5_TEST_NOW, program, source })).rejects.toThrow("UNREQUESTED_WORLD_STATE");
  });
});
