import { properties, propertyPartyRelationships, type Db } from "@finnor/db";
import type { PartyRef, PropertyPartyRelationshipKind } from "@finnor/shared-types";
import { and, eq, isNull, or } from "drizzle-orm";

/** Canonical Party↔Property write seam. The DB trigger independently verifies the
 * polymorphic party exists in the same tenant. No role is inferred here. */
export async function linkPropertyParty(db: Db, input: {
  tenantId: string;
  propertyId: string;
  party: PartyRef;
  relationship: PropertyPartyRelationshipKind;
  isPrimary?: boolean;
  provenance: Record<string, unknown>;
}): Promise<string> {
  const [created] = await db.insert(propertyPartyRelationships).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    partyType: input.party.partyType,
    partyId: input.party.partyId,
    relationship: input.relationship,
    isPrimary: input.isPrimary ?? false,
    provenance: input.provenance,
  }).onConflictDoNothing().returning({ id: propertyPartyRelationships.id });
  if (created) return created.id;
  const [existing] = await db.select({ id: propertyPartyRelationships.id }).from(propertyPartyRelationships).where(and(
    eq(propertyPartyRelationships.tenantId, input.tenantId),
    eq(propertyPartyRelationships.propertyId, input.propertyId),
    eq(propertyPartyRelationships.partyType, input.party.partyType),
    eq(propertyPartyRelationships.partyId, input.party.partyId),
    eq(propertyPartyRelationships.relationship, input.relationship),
    isNull(propertyPartyRelationships.validTo),
  )).limit(1);
  if (!existing) throw new Error("Party↔Property link was not created");
  return existing.id;
}

/** Generic read plus the legacy household compatibility projection. The OR is
 * intentional during Phase 1 so old rows remain readable even before dual-write
 * repair has materialized their customer_account relationship. */
export async function listPropertiesForParty(db: Db, input: { tenantId: string; party: PartyRef }) {
  return db.selectDistinct({
    id: properties.id,
    householdId: properties.householdId,
    label: properties.label,
    address: properties.address,
    kind: properties.kind,
    linkStatus: properties.linkStatus,
  }).from(properties).leftJoin(propertyPartyRelationships, and(
    eq(propertyPartyRelationships.tenantId, properties.tenantId),
    eq(propertyPartyRelationships.propertyId, properties.id),
    eq(propertyPartyRelationships.partyType, input.party.partyType),
    eq(propertyPartyRelationships.partyId, input.party.partyId),
    isNull(propertyPartyRelationships.validTo),
  )).where(and(
    eq(properties.tenantId, input.tenantId),
    isNull(properties.archivedAt),
    or(
      eq(propertyPartyRelationships.partyId, input.party.partyId),
      input.party.partyType === "household" ? eq(properties.householdId, input.party.partyId) : undefined,
    ),
  ));
}

export async function listPartiesForProperty(db: Db, input: { tenantId: string; propertyId: string }) {
  return db.select({
    partyType: propertyPartyRelationships.partyType,
    partyId: propertyPartyRelationships.partyId,
    relationship: propertyPartyRelationships.relationship,
    isPrimary: propertyPartyRelationships.isPrimary,
    validFrom: propertyPartyRelationships.validFrom,
    validTo: propertyPartyRelationships.validTo,
  }).from(propertyPartyRelationships).where(and(
    eq(propertyPartyRelationships.tenantId, input.tenantId),
    eq(propertyPartyRelationships.propertyId, input.propertyId),
    isNull(propertyPartyRelationships.validTo),
  ));
}
