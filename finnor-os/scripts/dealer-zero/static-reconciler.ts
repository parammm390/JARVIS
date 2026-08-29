// Dealer Zero's convergent, static company package. This boundary owns only
// identities, people, teams, locations, authority, policies and workspace
// configuration. It must never import or mutate evolving business models such as
// customers, leads, visits, messages, invoices, payments or inventory quantities.

import "dotenv/config";
import { isDeepStrictEqual } from "node:util";
import {
  adminDb,
  closePool,
  communicationIdentities,
  communicationIdentityBindings,
  employeeRoleAssignments,
  employeeRoles,
  orgUnitMemberships,
  orgUnits,
  tenantLocations,
  tenants,
  tenantSettings,
  technicians,
  users,
  withTenant,
} from "@finnor/db";
import {
  DEALER_ZERO_AREA_CODE,
  DEALER_ZERO_FIRST_NAMES,
  DEALER_ZERO_LAST_NAMES,
  DEALER_ZERO_TENANT_ID,
  DEALER_ZERO_TENANT_NAME,
  pick,
  rngFor,
} from "@finnor/shared-types";
import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_WORKSPACE_CONFIG } from "../../apps/api/lib/workspace-config";
import { seedTenantPolicies } from "../seed-tenant-policies";

const CLIENT_KEY = "dealer-zero";
const REVIEW_LINK = "https://g.page/r/dealer-zero-finnor-water-co/review";
const TECHNICIAN_COUNT = 3;

const DEALER_ZERO_WORKSPACE_CONFIG = {
  ...DEFAULT_WORKSPACE_CONFIG,
  terminology: { ...DEFAULT_WORKSPACE_CONFIG.terminology, agents: "AI Team" },
  navigationPriority: ["home", "customers", "schedule", "money", "work", "agents"],
} as const;

type EmployeeRole = "owner" | "dispatcher" | "technician";

interface StaticEmployee {
  email: string;
  displayName: string;
  role: EmployeeRole;
  phoneNumber: string;
  technicianId?: string;
  teamKey: "operations" | "field-service";
}

function technicianNames(): string[] {
  return Array.from({ length: TECHNICIAN_COUNT }, (_, index) => {
    const rng = rngFor("technician", index);
    return `${pick(rng, DEALER_ZERO_FIRST_NAMES)} ${pick(rng, DEALER_ZERO_LAST_NAMES)}`;
  });
}

async function ensureTenant(): Promise<{ clientKey: string }> {
  const db = adminDb();
  await db.insert(tenants).values({
    id: DEALER_ZERO_TENANT_ID,
    clientKey: CLIENT_KEY,
    name: DEALER_ZERO_TENANT_NAME,
    timezone: "America/Chicago",
  }).onConflictDoNothing();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, DEALER_ZERO_TENANT_ID)).limit(1);
  if (!tenant) {
    throw new Error("Dealer Zero tenant could not be created; its stable id or client key conflicts with another tenant");
  }
  if (tenant.name !== DEALER_ZERO_TENANT_NAME || tenant.timezone !== "America/Chicago") {
    await db.update(tenants).set({ name: DEALER_ZERO_TENANT_NAME, timezone: "America/Chicago" })
      .where(eq(tenants.id, DEALER_ZERO_TENANT_ID));
  }
  // Pre-client-key Dealer Zero installations keep their existing key because it can
  // already be referenced by managed rows. Fresh installations always use the stable
  // key above; either value remains the ownership key for this reconciler.
  return { clientKey: tenant.clientKey };
}

async function ensureTechnicians(): Promise<Array<{ id: string; name: string }>> {
  const desiredNames = technicianNames();
  return withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
    const result: Array<{ id: string; name: string }> = [];
    for (let index = 0; index < desiredNames.length; index++) {
      const name = desiredNames[index]!;
      const contactInfo = { phone: `+1${DEALER_ZERO_AREA_CODE}5559${String(100 + index).padStart(3, "0")}` };
      const availability = { mon_fri: "08:00-17:00" };
      const [existing] = await db.select().from(technicians).where(and(
        eq(technicians.tenantId, DEALER_ZERO_TENANT_ID),
        eq(technicians.name, name),
      )).limit(1);
      if (existing) {
        if (!isDeepStrictEqual(existing.contactInfo, contactInfo) || !isDeepStrictEqual(existing.availability, availability)) {
          await db.update(technicians).set({ contactInfo, availability }).where(eq(technicians.id, existing.id));
        }
        result.push({ id: existing.id, name });
        continue;
      }
      const [created] = await db.insert(technicians).values({
        tenantId: DEALER_ZERO_TENANT_ID,
        name,
        contactInfo,
        availability,
      }).returning({ id: technicians.id });
      if (!created) throw new Error(`Dealer Zero technician ${name} was not created`);
      result.push({ id: created.id, name });
    }
    return result;
  });
}

function staticEmployees(technicianRows: Array<{ id: string; name: string }>): StaticEmployee[] {
  return [
    {
      email: "owner@dealerzero.finnorai.com",
      displayName: "Avery Finn",
      role: "owner",
      phoneNumber: `+1${DEALER_ZERO_AREA_CODE}5559001`,
      teamKey: "operations",
    },
    {
      email: "dispatch@dealerzero.finnorai.com",
      displayName: "Jordan Lee",
      role: "dispatcher",
      phoneNumber: `+1${DEALER_ZERO_AREA_CODE}5559002`,
      teamKey: "operations",
    },
    ...technicianRows.map((technician, index): StaticEmployee => ({
      email: `technician${index + 1}@dealerzero.finnorai.com`,
      displayName: technician.name,
      role: "technician",
      phoneNumber: `+1${DEALER_ZERO_AREA_CODE}5559${String(100 + index).padStart(3, "0")}`,
      technicianId: technician.id,
      teamKey: "field-service",
    })),
  ];
}

async function ensureCompanyWorld(clientKey: string, technicianRows: Array<{ id: string; name: string }>) {
  return withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`dealer-zero:static:${DEALER_ZERO_TENANT_ID}`}, 0))`);

    const [settings] = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, DEALER_ZERO_TENANT_ID)).limit(1);
    if (!settings) {
      await db.insert(tenantSettings).values({
        tenantId: DEALER_ZERO_TENANT_ID,
        isDealerZero: true,
        simulatorEnabled: true,
        workspaceConfig: DEALER_ZERO_WORKSPACE_CONFIG,
      });
    } else if (!settings.isDealerZero || !settings.simulatorEnabled || !isDeepStrictEqual(settings.workspaceConfig, DEALER_ZERO_WORKSPACE_CONFIG)) {
      await db.update(tenantSettings).set({
        isDealerZero: true,
        simulatorEnabled: true,
        workspaceConfig: DEALER_ZERO_WORKSPACE_CONFIG,
        updatedAt: new Date(),
      }).where(eq(tenantSettings.tenantId, DEALER_ZERO_TENANT_ID));
    }

    const locationDesired = {
      name: "Houston Headquarters",
      address: "100 Finnor Way, Houston, TX 77002",
      timezone: "America/Chicago",
      active: true,
    };
    const [existingLocation] = await db.select().from(tenantLocations).where(and(
      eq(tenantLocations.tenantId, DEALER_ZERO_TENANT_ID),
      eq(tenantLocations.locationKey, "houston-hq"),
    )).limit(1);
    let locationId: string;
    if (existingLocation) {
      locationId = existingLocation.id;
      if (existingLocation.name !== locationDesired.name || existingLocation.address !== locationDesired.address
        || existingLocation.timezone !== locationDesired.timezone || !existingLocation.active) {
        await db.update(tenantLocations).set({ ...locationDesired, updatedAt: new Date() }).where(eq(tenantLocations.id, locationId));
      }
    } else {
      const [created] = await db.insert(tenantLocations).values({
        tenantId: DEALER_ZERO_TENANT_ID,
        locationKey: "houston-hq",
        ...locationDesired,
      }).returning({ id: tenantLocations.id });
      if (!created) throw new Error("Dealer Zero location was not created");
      locationId = created.id;
    }

    const teamDefinitions = [
      { key: "operations", name: "Operations", description: "Owner and dispatch operations" },
      { key: "field-service", name: "Field Service", description: "Water-treatment service technicians" },
    ] as const;
    const teamIds = new Map<string, string>();
    for (const team of teamDefinitions) {
      const [existing] = await db.select().from(orgUnits).where(and(
        eq(orgUnits.tenantId, DEALER_ZERO_TENANT_ID),
        eq(orgUnits.unitKey, team.key),
      )).limit(1);
      if (existing && existing.managedBy !== clientKey) {
        throw new Error(`Dealer Zero team ${team.key} is owned by another source; refusing to mutate it`);
      }
      if (existing) {
        teamIds.set(team.key, existing.id);
        if (existing.name !== team.name || existing.description !== team.description || existing.kind !== "team"
          || existing.locationId !== locationId || !existing.active) {
          await db.update(orgUnits).set({
            name: team.name,
            description: team.description,
            kind: "team",
            locationId,
            active: true,
            updatedAt: new Date(),
          }).where(eq(orgUnits.id, existing.id));
        }
      } else {
        const [created] = await db.insert(orgUnits).values({
          tenantId: DEALER_ZERO_TENANT_ID,
          unitKey: team.key,
          name: team.name,
          description: team.description,
          kind: "team",
          locationId,
          managedBy: clientKey,
          active: true,
        }).returning({ id: orgUnits.id });
        if (!created) throw new Error(`Dealer Zero team ${team.key} was not created`);
        teamIds.set(team.key, created.id);
      }
    }

    const employees = staticEmployees(technicianRows);
    const employeeIds = new Map<string, string>();
    for (const employee of employees) {
      const [existing] = await db.select().from(users).where(eq(users.email, employee.email)).limit(1);
      if (existing && existing.tenantId !== DEALER_ZERO_TENANT_ID) {
        throw new Error(`Dealer Zero employee email ${employee.email} belongs to another tenant; refusing reassignment`);
      }
      if (existing) {
        employeeIds.set(employee.email, existing.id);
        if (existing.role !== employee.role || existing.displayName !== employee.displayName
          || existing.phoneNumber !== employee.phoneNumber || existing.status !== "active"
          || existing.technicianId !== (employee.technicianId ?? null) || existing.primaryLocationId !== locationId) {
          await db.update(users).set({
            role: employee.role,
            displayName: employee.displayName,
            phoneNumber: employee.phoneNumber,
            status: "active",
            technicianId: employee.technicianId ?? null,
            primaryLocationId: locationId,
          }).where(eq(users.id, existing.id));
        }
      } else {
        const [created] = await db.insert(users).values({
          tenantId: DEALER_ZERO_TENANT_ID,
          email: employee.email,
          role: employee.role,
          displayName: employee.displayName,
          phoneNumber: employee.phoneNumber,
          technicianId: employee.technicianId ?? null,
          primaryLocationId: locationId,
        }).returning({ id: users.id });
        if (!created) throw new Error(`Dealer Zero employee ${employee.email} was not created`);
        employeeIds.set(employee.email, created.id);
      }
    }

    await db.execute(sql`select finnor_os.ensure_legacy_authority(${DEALER_ZERO_TENANT_ID}::uuid)`);
    const roles = await db.select().from(employeeRoles).where(eq(employeeRoles.tenantId, DEALER_ZERO_TENANT_ID));
    const rolesByKey = new Map(roles.map((role) => [role.key, role.id]));
    for (const employee of employees) {
      const employeeId = employeeIds.get(employee.email)!;
      const roleId = rolesByKey.get(employee.role);
      if (!roleId) throw new Error(`Dealer Zero authority role ${employee.role} was not bootstrapped`);
      const resourceScope = employee.role === "technician" ? { kind: "assigned" } : { kind: "tenant" };
      await db.insert(employeeRoleAssignments).values({
        tenantId: DEALER_ZERO_TENANT_ID,
        employeeId,
        roleId,
        resourceScope,
        active: true,
      }).onConflictDoUpdate({
        target: [employeeRoleAssignments.employeeId, employeeRoleAssignments.roleId],
        set: { resourceScope, active: true, expiresAt: null },
      });

      const teamId = teamIds.get(employee.teamKey)!;
      const [membership] = await db.select().from(orgUnitMemberships).where(and(
        eq(orgUnitMemberships.tenantId, DEALER_ZERO_TENANT_ID),
        eq(orgUnitMemberships.orgUnitId, teamId),
        eq(orgUnitMemberships.employeeId, employeeId),
      )).limit(1);
      if (membership && membership.managedBy !== clientKey) {
        throw new Error(`Dealer Zero membership ${employee.teamKey}:${employee.email} is owned by another source`);
      }
      if (membership) {
        if (!membership.active || !membership.isPrimary || membership.membershipRole !== employee.role) {
          await db.update(orgUnitMemberships).set({
            membershipRole: employee.role,
            isPrimary: true,
            active: true,
            updatedAt: new Date(),
          }).where(eq(orgUnitMemberships.id, membership.id));
        }
      } else {
        await db.insert(orgUnitMemberships).values({
          tenantId: DEALER_ZERO_TENANT_ID,
          orgUnitId: teamId,
          employeeId,
          membershipRole: employee.role,
          isPrimary: true,
          managedBy: clientKey,
          active: true,
        });
      }
    }

    // These safe handles describe Dealer Zero's synthetic channels. They are
    // deliberately disabled: static reconciliation never invents provider
    // credentials or turns a fixture into an externally sending identity.
    const identityDefinitions = [
      { key: "dealer-zero-email", channel: "email" as const, address: "operations@dealerzero.finnorai.com", principalType: "tenant" as const, principalId: DEALER_ZERO_TENANT_ID },
      { key: "dealer-zero-sms", channel: "sms" as const, address: `+1${DEALER_ZERO_AREA_CODE}5559000`, principalType: "team" as const, principalId: teamIds.get("operations")! },
      { key: "dealer-zero-voice", channel: "voice" as const, address: `+1${DEALER_ZERO_AREA_CODE}5559000`, principalType: "location" as const, principalId: locationId },
    ];
    for (const identity of identityDefinitions) {
      const [existing] = await db.select().from(communicationIdentities).where(and(
        eq(communicationIdentities.tenantId, DEALER_ZERO_TENANT_ID),
        eq(communicationIdentities.identityKey, identity.key),
      )).limit(1);
      if (existing && existing.managedBy !== clientKey) {
        throw new Error(`Dealer Zero communication identity ${identity.key} is owned by another source`);
      }
      let identityId: string;
      if (existing) {
        identityId = existing.id;
        if (existing.provider !== "sandbox" || existing.channel !== identity.channel || existing.address !== identity.address
          || existing.status !== "disabled" || !isDeepStrictEqual(existing.capabilities, ["dealer-zero-simulation"])) {
          await db.update(communicationIdentities).set({
            provider: "sandbox",
            channel: identity.channel,
            address: identity.address,
            providerIdentityRef: null,
            status: "disabled",
            capabilities: ["dealer-zero-simulation"],
            credentialProvider: null,
            credentialRef: null,
            credentialVersion: null,
            updatedAt: new Date(),
          }).where(eq(communicationIdentities.id, existing.id));
        }
      } else {
        const [created] = await db.insert(communicationIdentities).values({
          tenantId: DEALER_ZERO_TENANT_ID,
          identityKey: identity.key,
          provider: "sandbox",
          channel: identity.channel,
          address: identity.address,
          status: "disabled",
          capabilities: ["dealer-zero-simulation"],
          managedBy: clientKey,
        }).returning({ id: communicationIdentities.id });
        if (!created) throw new Error(`Dealer Zero communication identity ${identity.key} was not created`);
        identityId = created.id;
      }
      const [binding] = await db.select().from(communicationIdentityBindings).where(and(
        eq(communicationIdentityBindings.tenantId, DEALER_ZERO_TENANT_ID),
        eq(communicationIdentityBindings.communicationIdentityId, identityId),
        eq(communicationIdentityBindings.principalType, identity.principalType),
        eq(communicationIdentityBindings.principalId, identity.principalId),
        eq(communicationIdentityBindings.purpose, "default"),
      )).limit(1);
      if (binding && binding.managedBy !== clientKey) {
        throw new Error(`Dealer Zero communication binding for ${identity.key} is owned by another source`);
      }
      if (binding) {
        if (binding.status !== "disabled" || binding.priority !== 0) {
          await db.update(communicationIdentityBindings).set({ status: "disabled", priority: 0, updatedAt: new Date() })
            .where(eq(communicationIdentityBindings.id, binding.id));
        }
      } else {
        await db.insert(communicationIdentityBindings).values({
          tenantId: DEALER_ZERO_TENANT_ID,
          communicationIdentityId: identityId,
          principalType: identity.principalType,
          principalId: identity.principalId,
          purpose: "default",
          priority: 0,
          status: "disabled",
          managedBy: clientKey,
        });
      }
    }

    return {
      locationCount: 1,
      teamCount: teamDefinitions.length,
      employeeCount: employees.length,
      technicianIds: technicianRows.map((row) => row.id),
      communicationIdentityCount: identityDefinitions.length,
    };
  });
}

export interface DealerZeroStaticResult {
  tenantId: string;
  technicianIds: string[];
  employeeCount: number;
  teamCount: number;
  locationCount: number;
  communicationIdentityCount: number;
  policyCount: number;
  priceBookItemCount: number;
}

/** Canonical, idempotent static boundary for Dealer Zero. */
export async function reconcileDealerZeroStatic(): Promise<DealerZeroStaticResult> {
  const { clientKey } = await ensureTenant();
  const technicians = await ensureTechnicians();
  const company = await ensureCompanyWorld(clientKey, technicians);
  const policies = await seedTenantPolicies(DEALER_ZERO_TENANT_ID, { reviewLinkUrl: REVIEW_LINK });
  if (policies.missingFromMatrix.length > 0 || policies.extraInMatrix.length > 0) {
    throw new Error(`Dealer Zero policy registry drift: missing=${policies.missingFromMatrix.join(",")} extra=${policies.extraInMatrix.join(",")}`);
  }
  return {
    tenantId: DEALER_ZERO_TENANT_ID,
    ...company,
    policyCount: policies.actionTypesSeeded,
    priceBookItemCount: policies.priceBookItemsSeeded,
  };
}

const isMain = process.argv[1]?.endsWith("static-reconciler.ts") || process.argv[1]?.endsWith("static-reconciler.js");
if (isMain) {
  reconcileDealerZeroStatic()
    .then(async (result) => {
      console.log(JSON.stringify(result, null, 2));
      await closePool();
    })
    .catch(async (error) => {
      console.error(error);
      await closePool();
      process.exit(1);
    });
}
