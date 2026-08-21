import { describe, expect, it } from "vitest";
import {
  canonicalEntityRefToPartyRef,
  partyRefToCanonicalEntityRef,
  type PartyResolverInput,
} from "@finnor/shared-types";
import { resolveParty } from "@finnor/read-models";

describe("Company World shared party contract", () => {
  it("maps business party names onto the existing canonical graph identities", () => {
    expect(partyRefToCanonicalEntityRef({ partyType: "employee", partyId: "employee-id" }))
      .toEqual({ entityType: "user", entityId: "employee-id" });
    expect(partyRefToCanonicalEntityRef({ partyType: "team", partyId: "team-id" }))
      .toEqual({ entityType: "org_unit", entityId: "team-id" });
    expect(canonicalEntityRefToPartyRef({ entityType: "tenant_location", entityId: "location-id" }))
      .toEqual({ partyType: "location", partyId: "location-id" });
  });

  it("keeps tenant identity out of resolver payloads", () => {
    const input: PartyResolverInput = { query: "my manager" };
    expect(input).toEqual({ query: "my manager" });
    expect("tenantId" in input).toBe(false);
  });

  it("rejects forged tenant selectors at runtime instead of silently ignoring them", async () => {
    await expect(resolveParty("trusted-tenant", {
      query: "Mario",
      tenantId: "forged-tenant",
    } as PartyResolverInput)).rejects.toThrow("unsupported fields: tenantId");
    await expect(resolveParty("trusted-tenant", {
      ref: {
        partyType: "employee",
        partyId: "11111111-1111-4111-8111-111111111111",
        tenantId: "forged-tenant",
      },
    } as PartyResolverInput)).rejects.toThrow("PartyRef contains unsupported fields: tenantId");
  });
});
