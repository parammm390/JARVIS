import { describe, expect, it } from "vitest";
import { parseClientManifest } from "../../scripts/client-manifest";
import { buildClientImpactPlan } from "../../scripts/release/client-lifecycle-model";

const base = {
  clientKey: "manifest-company",
  tenant: { name: "Manifest Company", timezone: "America/Chicago" },
  locations: [{ key: "main-office", name: "Main Office" }],
  users: [
    { email: "manager@example.test", role: "owner" },
    { email: "worker@example.test", role: "technician" },
  ],
};

describe("Manifest V1 Company World contract", () => {
  it("keeps pre-P0 manifests compatible and preserves P0 field presence", () => {
    const parsed = parseClientManifest(base);

    expect(parsed.users).toEqual([
      { email: "manager@example.test", role: "owner", status: "active" },
      { email: "worker@example.test", role: "technician", status: "active" },
    ]);
    expect(parsed.orgUnits).toBeUndefined();
    expect(parsed.orgUnitMemberships).toBeUndefined();
    expect(parsed.employeeRelationships).toBeUndefined();
    expect(parsed.aliases).toBeUndefined();
    expect(parsed.externalOrganizations).toBeUndefined();
    expect(parsed.externalContacts).toBeUndefined();
  });

  it("parses only the frozen canonical additive fields", () => {
    const parsed = parseClientManifest({
      ...base,
      users: [
        { email: "manager@example.test", role: "owner", orgUnitKeys: ["ops"], locationKey: null },
        { email: "worker@example.test", role: "technician" },
      ],
      orgUnits: [{ key: "ops", name: "Operations", kind: "team", description: "Field operations" }],
      orgUnitMemberships: [{
        employeeEmail: "manager@example.test",
        orgUnitKey: "ops",
        membershipRole: "lead",
        isPrimary: true,
      }],
      employeeRelationships: [{
        subjectEmployeeEmail: "worker@example.test",
        relatedEmployeeEmail: "manager@example.test",
        relationshipType: "manager",
      }],
      aliases: [{ key: "ops-alias", partyType: "team", partyKey: "ops", alias: "Field Ops" }],
      externalOrganizations: [{ key: "membrane-supply", name: "Membrane Supply", kind: "supplier", businessEmail: "sales@membrane.test" }],
      externalContacts: [{ key: "membrane-jane", name: "Jane Supplier", externalOrganizationKey: "membrane-supply", title: "Account Manager" }],
    });

    expect(parsed.orgUnits).toEqual([{ key: "ops", name: "Operations", kind: "team", description: "Field operations", active: true }]);
    expect(parsed.orgUnitMemberships?.[0]).toMatchObject({
      employeeEmail: "manager@example.test",
      orgUnitKey: "ops",
      membershipRole: "lead",
      isPrimary: true,
      active: true,
    });
    expect(parsed.employeeRelationships?.[0]).toMatchObject({
      subjectEmployeeEmail: "worker@example.test",
      relatedEmployeeEmail: "manager@example.test",
      relationshipType: "manager",
      active: true,
    });
    expect(parsed.externalContacts?.[0]).toMatchObject({ name: "Jane Supplier", externalOrganizationKey: "membrane-supply" });
  });

  it("distinguishes omitted collections from explicit empty collections", () => {
    const omitted = parseClientManifest(base);
    const cleared = parseClientManifest({
      ...base,
      orgUnits: [],
      orgUnitMemberships: [],
      employeeRelationships: [],
      aliases: [],
      externalOrganizations: [],
      externalContacts: [],
    });

    expect(omitted.orgUnits).toBeUndefined();
    expect(cleared.orgUnits).toEqual([]);
    expect(cleared.orgUnitMemberships).toEqual([]);
    expect(cleared.employeeRelationships).toEqual([]);
    expect(cleared.aliases).toEqual([]);
    expect(cleared.externalOrganizations).toEqual([]);
    expect(cleared.externalContacts).toEqual([]);
  });

  it("rejects hierarchy and alternate field spellings instead of ignoring them", () => {
    expect(() => parseClientManifest({ ...base, orgUnits: [{ key: "ops", name: "Ops", parentKey: "root" }] })).toThrow();
    expect(() => parseClientManifest({ ...base, teams: [{ key: "ops", name: "Ops" }] })).toThrow();
    expect(() => parseClientManifest({ ...base, users: [{ email: "manager@example.test", role: "owner", teamKeys: ["ops"] }] })).toThrow();
    expect(() => parseClientManifest({ ...base, users: [{ email: "manager@example.test", role: "owner", locationKeys: ["main-office"] }] })).toThrow();
    expect(() => parseClientManifest({
      ...base,
      orgUnits: [{ key: "ops", name: "Ops", type: "team" }],
    })).toThrow();
    expect(() => parseClientManifest({
      ...base,
      employeeRelationships: [{
        subjectEmployeeEmail: "manager@example.test",
        relatedEmployeeEmail: "worker@example.test",
        relationshipType: "report",
      }],
    })).toThrow();
  });

  it("requires every internal reference to be declared and rejects self-relationships", () => {
    expect(() => parseClientManifest({
      ...base,
      orgUnits: [{ key: "ops", name: "Ops" }],
      orgUnitMemberships: [{ employeeEmail: "missing@example.test", orgUnitKey: "ops" }],
    })).toThrow();
    expect(() => parseClientManifest({
      ...base,
      employeeRelationships: [{
        subjectEmployeeEmail: "manager@example.test",
        relatedEmployeeEmail: "manager@example.test",
        relationshipType: "manager",
      }],
    })).toThrow();
    expect(() => parseClientManifest({
      ...base,
      externalContacts: [{ key: "contact-one", name: "Contact", externalOrganizationKey: "missing-org" }],
    })).toThrow();
    expect(() => parseClientManifest({
      ...base,
      aliases: [{ key: "bad-alias", partyType: "team", partyKey: "missing-team", alias: "Missing" }],
    })).toThrow();
  });

  it("routes Company World changes through the identity factory stage", () => {
    const current = parseClientManifest(base);
    const desired = parseClientManifest({ ...base, orgUnits: [{ key: "ops", name: "Operations" }] });
    const plan = buildClientImpactPlan({ currentManifest: current, desiredManifest: desired });

    expect(plan.affectedAreas).toEqual(["identity"]);
    expect(plan.factoryStages).toContain("identity");
    expect(plan.certificationGates).toContain("user_isolation");
  });
});
