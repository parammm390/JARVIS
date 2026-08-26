import { describe, expect, it } from "vitest";
import { ASSET_DOMAINS, PROPERTY_LINK_STATUSES } from "@finnor/shared-types";
import { appointments, assetMeasurements, equipment, households, properties, serviceVisits } from "@finnor/db";
import { parseImportDefinition } from "@finnor/import-engine";
import { PHASE1_LOCKED_COUNTS } from "../phase1/locked-corpus";

describe("generic Property/Asset kernel", () => {
  it("preserves equipment and household as the legacy identity seam", () => {
    expect(equipment.id.name).toBe("id");
    expect(equipment.householdId.name).toBe("household_id");
    expect(equipment.householdId.notNull).toBe(true);
    expect(households.id.name).toBe("id");
  });

  it("adds one shared property/asset/history/measurement relationship", () => {
    expect(properties.householdId.name).toBe("household_id");
    expect(equipment.propertyId.name).toBe("property_id");
    expect(serviceVisits.propertyId.name).toBe("property_id");
    expect(serviceVisits.equipmentId.name).toBe("equipment_id");
    expect(appointments.propertyId.name).toBe("property_id");
    expect(assetMeasurements.propertyId.notNull).toBe(true);
    expect(assetMeasurements.equipmentId.notNull).toBe(true);
    expect(PROPERTY_LINK_STATUSES).toEqual(["RESOLVED", "UNRESOLVED"]);
    expect(ASSET_DOMAINS).toEqual(["WATER", "HVAC", "PLUMBING", "GENERIC", "UNRESOLVED"]);
  });

  it("uses the same base schema for Water, HVAC, and Plumbing fixtures", () => {
    expect(PHASE1_LOCKED_COUNTS).toMatchObject({ water: 20, hvac: 20, plumbing: 20 });
  });

  it("accepts additive property-aware import definitions without weakening household compatibility", () => {
    const definition = parseImportDefinition({
      key: "phase1-assets", format: "json", version: 1, entity: "equipment", sourceSystem: "phase1-fixture",
      fields: { type: { from: "type", required: true }, model: { from: "model" }, assetDomain: { from: "domain", required: true } },
      externalId: { from: "externalId", required: true },
      relationships: {
        householdId: { entity: "customer", sourceId: { from: "customerId", required: true }, required: true },
        propertyId: { entity: "property", sourceId: { from: "propertyExternalId", required: true }, required: true },
      },
    });
    expect(definition.relationships).toHaveProperty("householdId");
    expect(definition.relationships).toHaveProperty("propertyId");
  });
});
