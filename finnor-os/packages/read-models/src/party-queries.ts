import {
  appointments,
  employeeRelationships,
  employeeRoleAssignments,
  employeeRoles,
  externalContacts,
  externalOrganizations,
  orgUnitMemberships,
  orgUnits,
  serviceVisits,
  tasks,
  technicianCapacity,
  technicianDispatchProfiles,
  technicians,
  tenantLocations,
  users,
  userOperatingProfiles,
  withTenant,
  workOrders,
  works,
} from "@finnor/db";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type {
  OperationalLocalDateRange,
  OperationalPartySummary,
  PartyAvailabilityRequest,
  PartyAvailabilityResult,
  PartyCandidate,
  PartyContextRequest,
  PartyContextResult,
  PartyRef,
  PartyResolution,
  PartyLookupRequest,
  PartyLookupResult,
  PartyRelationshipRow,
  PartyResolverContext,
  PartyResolverInput,
  TeamRosterRequest,
  TeamRosterResult,
  OperatingCompanyDirectory,
} from "@finnor/shared-types";
import { resolveParty } from "./party-resolver";
import { resolveTenantRange } from "./operational-queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PARTIES = 100;
const MAX_ROSTER = 100;
const MAX_RELATIONSHIPS = 100;
const MAX_WORKS = 20;
const MAX_TASKS = 50;

// `resolveParty` uses one UNION-backed directory for every resolution path, then
// may consult aliases, business contact methods, relationships, or trusted Work
// context. Keep result provenance complete even when a particular query exits at
// an earlier precedence stage.
const PARTY_RESOLVER_SOURCE_TABLES = [
  "users",
  "user_operating_profiles",
  "org_units",
  "tenant_locations",
  "households",
  "contacts",
  "external_organizations",
  "external_contacts",
  "party_aliases",
  "contact_methods",
  "employee_relationships",
  "org_unit_memberships",
  "works",
  "work_entity_links",
  "work_orders",
  "technicians",
] as const;

export interface PartyReadExecutionContext {
  /** Trusted authenticated identity; never read from the request body. */
  employeeId?: string;
  userId?: string;
  /** Trusted current Work identity for Work-dependent resolver phrases. */
  workId?: string;
  /** Trusted PartyRefs derived from Work links and the active context only. */
  referencedPartyRefs?: PartyRef[];
  now?: Date;
  maxRows?: number;
}

type QueryRequest = PartyLookupRequest | PartyContextRequest | TeamRosterRequest | PartyAvailabilityRequest;
type PublicResolution = "exact" | "unique" | "ambiguous" | "not_found" | "inactive";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function asOf(context: PartyReadExecutionContext): string {
  return (context.now ?? new Date()).toISOString();
}

function pageLimit(request: { page?: { limit?: number } }, context: PartyReadExecutionContext): number {
  return Math.min(100, Math.max(1, Math.floor(context.maxRows ?? request.page?.limit ?? 50)));
}

function resolverInput(request: QueryRequest): PartyResolverInput {
  const ref = request.intent === "team_roster" ? request.teamRef : request.ref;
  return {
    ...(ref ? { ref } : {}),
    ...(request.query?.trim() ? { query: request.query.trim() } : {}),
  };
}

function resolverContext(context: PartyReadExecutionContext): PartyResolverContext {
  const requesterEmployeeId = context.employeeId ?? (isUuid(context.userId) ? context.userId : undefined);
  return {
    ...(requesterEmployeeId ? { requesterEmployeeId } : {}),
    ...(context.workId && isUuid(context.workId) ? { workId: context.workId } : {}),
  };
}

async function resolve(tenantId: string, request: QueryRequest, context: PartyReadExecutionContext): Promise<PartyResolution> {
  return resolveParty(tenantId, resolverInput(request), resolverContext(context));
}

function publicResolution(resolution: PartyResolution): PublicResolution {
  if (resolution.status === "resolved") return resolution.method === "explicit_ref" ? "exact" : "unique";
  return resolution.status;
}

function envelopeStatus(resolution: PublicResolution): "ok" | "ambiguous" | "not_found" | "inactive" {
  if (resolution === "ambiguous") return "ambiguous";
  if (resolution === "inactive") return "inactive";
  if (resolution === "not_found") return "not_found";
  return "ok";
}

interface PageState {
  totalCount: number | null;
  totalCountExact: boolean;
  hasMore: boolean;
  nextCursor: string | null;
}

function encodePageCursor(kind: string, key: string): string {
  return Buffer.from(JSON.stringify({ kind, key }), "utf8").toString("base64url");
}

function decodePageCursor(cursor: string | undefined, kind: string): string | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid cursor");
    const record = value as Record<string, unknown>;
    if (record.kind !== kind || typeof record.key !== "string" || !record.key) throw new Error("invalid cursor");
    return record.key;
  } catch {
    throw new Error("Invalid party query cursor");
  }
}

function pageWindow<T>(items: T[], limit: number, cursor: string | undefined, kind: string, keyFor: (item: T) => string): { items: T[]; page: PageState } {
  const cursorKey = decodePageCursor(cursor, kind);
  const start = cursorKey === null ? 0 : items.findIndex((item) => keyFor(item) === cursorKey) + 1;
  if (cursorKey !== null && start === 0) throw new Error("Party query cursor does not match the result set");
  const visible = items.slice(start, start + limit);
  const hasMore = start + limit < items.length;
  return {
    items: visible,
    page: {
      totalCount: hasMore ? null : items.length,
      totalCountExact: !hasMore,
      hasMore,
      nextCursor: hasMore && visible.length > 0 ? encodePageCursor(kind, keyFor(visible[visible.length - 1]!)) : null,
    },
  };
}

function baseResult<I extends QueryRequest["intent"]>(
  intent: I,
  resolution: PublicResolution,
  asOfValue: string,
  sourceTables: string[],
  limit: number,
  returned: number,
  pageState: Partial<PageState> = {},
) {
  const source = { kind: "canonical_postgres" as const, tables: [...new Set(sourceTables)] };
  const page = {
    limit,
    returned,
    totalCount: pageState.totalCount ?? returned,
    totalCountExact: pageState.totalCountExact ?? true,
    hasMore: pageState.hasMore ?? false,
    nextCursor: pageState.nextCursor ?? null,
    truncated: pageState.hasMore ?? false,
  } as const;
  return {
    kind: "operational_query_result" as const,
    status: envelopeStatus(resolution),
    data: {},
    version: 1 as const,
    intent,
    source,
    asOf: asOfValue,
    count: returned,
    truncated: page.truncated,
    page,
    meta: { version: 1 as const, source, asOf: asOfValue },
  };
}

function candidateSummary(candidate: PartyCandidate, metadata?: PartyMetadata): OperationalPartySummary {
  return {
    ref: candidate.ref,
    displayName: candidate.displayName,
    status: candidate.status,
    description: candidate.description,
    ...(metadata?.title ? { title: metadata.title } : {}),
    ...(metadata?.role ? { role: metadata.role } : {}),
    ...(metadata?.organizationName ? { organizationName: metadata.organizationName } : {}),
    ...(metadata?.teamNames.length ? { teamNames: metadata.teamNames.slice(0, 10) } : {}),
    ...(metadata?.locationNames.length ? { locationNames: metadata.locationNames.slice(0, 10) } : {}),
  };
}

function summaryMap(candidates: PartyCandidate[], metadata = new Map<string, PartyMetadata>()): OperationalPartySummary[] {
  return candidates.slice(0, MAX_PARTIES).map((candidate) => candidateSummary(candidate, metadata.get(refKey(candidate.ref))));
}

function refKey(ref: PartyRef): string {
  return `${ref.partyType}:${ref.partyId}`;
}

interface PartyMetadata {
  title: string | null;
  role: string | null;
  organizationName: string | null;
  teamNames: string[];
  locationNames: string[];
}

function emptyMetadata(): PartyMetadata {
  return { title: null, role: null, organizationName: null, teamNames: [], locationNames: [] };
}

async function loadMetadata(tenantId: string, refs: PartyRef[]): Promise<Map<string, PartyMetadata>> {
  const wanted = [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
  const metadata = new Map<string, PartyMetadata>(wanted.map((ref) => [refKey(ref), emptyMetadata()]));
  if (wanted.length === 0) return metadata;
  const employeeIds = wanted.filter((ref) => ref.partyType === "employee").map((ref) => ref.partyId);
  const teamIds = wanted.filter((ref) => ref.partyType === "team").map((ref) => ref.partyId);
  const locationIds = wanted.filter((ref) => ref.partyType === "location").map((ref) => ref.partyId);
  const organizationIds = wanted.filter((ref) => ref.partyType === "external_organization").map((ref) => ref.partyId);
  const externalContactIds = wanted.filter((ref) => ref.partyType === "external_contact").map((ref) => ref.partyId);

  await withTenant(tenantId, async (db) => {
    if (employeeIds.length > 0) {
      const profiles = await db.select({ userId: userOperatingProfiles.userId, title: userOperatingProfiles.title })
        .from(userOperatingProfiles)
        .where(and(eq(userOperatingProfiles.tenantId, tenantId), inArray(userOperatingProfiles.userId, employeeIds)))
        .limit(MAX_PARTIES);
      for (const row of profiles) metadata.get(`employee:${row.userId}`)!.title = row.title;
      const employees = await db.select({ id: users.id, role: users.role, primaryLocationId: users.primaryLocationId })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, employeeIds)))
        .limit(MAX_PARTIES);
      const primaryLocationIds = employees.map((row) => row.primaryLocationId).filter((id): id is string => Boolean(id));
      for (const row of employees) {
        const item = metadata.get(`employee:${row.id}`);
        if (item) {
          item.role = row.role;
          if (row.primaryLocationId) item.locationNames.push(row.primaryLocationId);
        }
      }
      const memberships = await db.select({ employeeId: orgUnitMemberships.employeeId, orgUnitId: orgUnitMemberships.orgUnitId })
        .from(orgUnitMemberships)
        .where(and(eq(orgUnitMemberships.tenantId, tenantId), eq(orgUnitMemberships.active, true), inArray(orgUnitMemberships.employeeId, employeeIds)))
        .limit(MAX_PARTIES * 4);
      const membershipTeamIds = [...new Set(memberships.map((row) => row.orgUnitId))];
      const allTeamIds = [...new Set([...teamIds, ...membershipTeamIds])];
      let teamLocationIds: string[] = [];
      if (allTeamIds.length > 0) {
        const teams = await db.select({ id: orgUnits.id, name: orgUnits.name, locationId: orgUnits.locationId })
          .from(orgUnits)
          .where(and(eq(orgUnits.tenantId, tenantId), inArray(orgUnits.id, allTeamIds)))
          .limit(MAX_PARTIES);
        const names = new Map(teams.map((row) => [row.id, row.name]));
        for (const row of memberships) metadata.get(`employee:${row.employeeId}`)?.teamNames.push(names.get(row.orgUnitId) ?? row.orgUnitId);
        teamLocationIds = teams.map((row) => row.locationId).filter((id): id is string => Boolean(id));
      }
      const allLocationIds = [...new Set([...locationIds, ...primaryLocationIds, ...teamLocationIds])];
      if (allLocationIds.length > 0) {
        const locations = await db.select({ id: tenantLocations.id, name: tenantLocations.name })
          .from(tenantLocations)
          .where(and(eq(tenantLocations.tenantId, tenantId), inArray(tenantLocations.id, allLocationIds)))
          .limit(MAX_PARTIES);
        const locationNames = new Map(locations.map((row) => [row.id, row.name]));
        for (const item of metadata.values()) {
          item.locationNames = item.locationNames.map((id) => locationNames.get(id) ?? id);
        }
      }
    }
    if (organizationIds.length > 0 || externalContactIds.length > 0) {
      const contacts = externalContactIds.length > 0
        ? await db.select({ id: externalContacts.id, organizationId: externalContacts.externalOrganizationId })
          .from(externalContacts)
          .where(and(eq(externalContacts.tenantId, tenantId), inArray(externalContacts.id, externalContactIds)))
          .orderBy(asc(externalContacts.id))
          .limit(MAX_PARTIES)
        : [];
      const contactOrganizationIds = contacts.map((row) => row.organizationId).filter((id): id is string => Boolean(id));
      const allOrganizationIds = [...new Set([...organizationIds, ...contactOrganizationIds])];
      if (allOrganizationIds.length === 0) return;
      const organizations = await db.select({ id: externalOrganizations.id, name: externalOrganizations.name })
        .from(externalOrganizations)
        .where(and(eq(externalOrganizations.tenantId, tenantId), inArray(externalOrganizations.id, allOrganizationIds)))
        .orderBy(asc(externalOrganizations.id))
        .limit(MAX_PARTIES);
      const organizationNames = new Map(organizations.map((row) => [row.id, row.name]));
      for (const row of contacts) if (row.organizationId) metadata.get(`external_contact:${row.id}`)!.organizationName = organizationNames.get(row.organizationId) ?? null;
    }
  });
  return metadata;
}

async function contextRows(tenantId: string, ref: PartyRef, context: PartyReadExecutionContext): Promise<{
  teams: PartyCandidate[];
  locations: PartyCandidate[];
  relationships: PartyRelationshipRow[];
  currentWork: Array<{ id: string; status: string; instruction: string | null; updatedAt: string | null }>;
  currentTasks: Array<{ id: string; title: string; status: string; dueAt: string | null; authorityRole: string | null }>;
  authorityRoles: string[];
}> {
  return withTenant(tenantId, async (db) => {
    const teams: PartyCandidate[] = [];
    const locations: PartyCandidate[] = [];
    const relationships: PartyRelationshipRow[] = [];
    const currentWork: Array<{ id: string; status: string; instruction: string | null; updatedAt: string | null }> = [];
    const currentTasks: Array<{ id: string; title: string; status: string; dueAt: string | null; authorityRole: string | null }> = [];
    let authorityRoles: string[] = [];

    if (ref.partyType === "employee") {
      const memberships = await db.select({ orgUnitId: orgUnitMemberships.orgUnitId })
        .from(orgUnitMemberships)
        .where(and(eq(orgUnitMemberships.tenantId, tenantId), eq(orgUnitMemberships.employeeId, ref.partyId), eq(orgUnitMemberships.active, true)))
        .orderBy(asc(orgUnitMemberships.orgUnitId))
        .limit(MAX_PARTIES);
      const teamIds = memberships.map((row) => row.orgUnitId);
      if (teamIds.length > 0) {
        const rows = await db.select({ id: orgUnits.id, name: orgUnits.name, kind: orgUnits.kind, active: orgUnits.active, description: orgUnits.description })
          .from(orgUnits)
          .where(and(eq(orgUnits.tenantId, tenantId), inArray(orgUnits.id, teamIds)))
          .orderBy(asc(orgUnits.name), asc(orgUnits.id))
          .limit(MAX_PARTIES);
        teams.push(...rows.map((row) => ({ ref: { partyType: "team" as const, partyId: row.id }, displayName: row.name, status: row.active ? "active" as const : "inactive" as const, description: row.description ?? row.kind })));
      }
      const [user] = await db.select({ primaryLocationId: users.primaryLocationId })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, ref.partyId)))
        .limit(1);
      const locationIds = user?.primaryLocationId ? [user.primaryLocationId] : [];
      const teamLocationRows = teamIds.length > 0 ? await db.select({ locationId: orgUnits.locationId }).from(orgUnits).where(and(eq(orgUnits.tenantId, tenantId), inArray(orgUnits.id, teamIds))).limit(MAX_PARTIES) : [];
      locationIds.push(...teamLocationRows.map((row) => row.locationId).filter((id): id is string => Boolean(id)));
      if (locationIds.length > 0) {
        const rows = await db.select({ id: tenantLocations.id, name: tenantLocations.name, active: tenantLocations.active, address: tenantLocations.address })
          .from(tenantLocations)
          .where(and(eq(tenantLocations.tenantId, tenantId), inArray(tenantLocations.id, [...new Set(locationIds)])))
          .orderBy(asc(tenantLocations.name), asc(tenantLocations.id))
          .limit(MAX_PARTIES);
        locations.push(...rows.map((row) => ({ ref: { partyType: "location" as const, partyId: row.id }, displayName: row.name, status: row.active ? "active" as const : "inactive" as const, description: row.address })));
      }
      const relationshipRows = await db.select({ subjectEmployeeId: employeeRelationships.subjectEmployeeId, relatedEmployeeId: employeeRelationships.relatedEmployeeId, relationshipType: employeeRelationships.relationshipType, active: employeeRelationships.active })
        .from(employeeRelationships)
        .where(and(eq(employeeRelationships.tenantId, tenantId), eq(employeeRelationships.active, true), or(eq(employeeRelationships.subjectEmployeeId, ref.partyId), eq(employeeRelationships.relatedEmployeeId, ref.partyId))))
        .orderBy(asc(employeeRelationships.relationshipType), asc(employeeRelationships.subjectEmployeeId), asc(employeeRelationships.relatedEmployeeId))
        .limit(MAX_RELATIONSHIPS);
      const employeeIds = [...new Set(relationshipRows.flatMap((row) => [row.subjectEmployeeId, row.relatedEmployeeId]))];
      const employees = employeeIds.length > 0 ? await db.select({ id: users.id, displayName: users.displayName, status: users.status, role: users.role })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, employeeIds)))
        .limit(MAX_PARTIES) : [];
      const employeeMap = new Map(employees.map((row) => [row.id, { ref: { partyType: "employee" as const, partyId: row.id }, displayName: row.displayName ?? "Employee", status: row.status === "active" ? "active" as const : "suspended" as const, description: row.role }]));
      for (const row of relationshipRows) {
        const from = employeeMap.get(row.subjectEmployeeId);
        const to = employeeMap.get(row.relatedEmployeeId);
        if (from && to) relationships.push({ relationship: row.relationshipType, from: from.ref, to: to.ref, label: null, status: row.active ? "active" : "inactive" });
      }
      const roleRows = await db.select({ key: employeeRoles.key })
        .from(employeeRoleAssignments)
        .innerJoin(employeeRoles, eq(employeeRoles.id, employeeRoleAssignments.roleId))
        .where(and(eq(employeeRoleAssignments.tenantId, tenantId), eq(employeeRoleAssignments.employeeId, ref.partyId), eq(employeeRoleAssignments.active, true), eq(employeeRoles.active, true)))
        .orderBy(asc(employeeRoles.key))
        .limit(20);
      authorityRoles = [...new Set(roleRows.map((row) => row.key).filter((key): key is string => Boolean(key)))].slice(0, 20);

      const activeWorkWhere = and(eq(works.tenantId, tenantId), or(eq(works.assignedTo, ref.partyId), eq(works.currentOwnerId, ref.partyId), eq(works.createdBy, ref.partyId)), inArray(works.status, ["received", "understanding", "planning", "ready", "actionable", "awaiting_approval", "executing", "waiting", "blocked", "recovery"]));
      const workRows = await db.select({ id: works.id, status: works.status, instruction: works.initialInstruction, updatedAt: works.updatedAt })
        .from(works).where(context.workId ? and(activeWorkWhere, eq(works.id, context.workId)) : activeWorkWhere).orderBy(desc(works.updatedAt)).limit(MAX_WORKS);
      currentWork.push(...workRows.map((row) => ({ id: row.id, status: row.status, instruction: row.instruction, updatedAt: row.updatedAt.toISOString() })));
      const taskRows = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status, dueAt: tasks.dueAt })
        .from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.assigneeType, "user"), eq(tasks.assigneeId, ref.partyId), isNull(tasks.archivedAt), inArray(tasks.status, ["open"]))).orderBy(asc(tasks.dueAt), desc(tasks.createdAt)).limit(MAX_TASKS);
      currentTasks.push(...taskRows.map((row) => ({ id: row.id, title: row.title, status: row.status, dueAt: row.dueAt?.toISOString() ?? null, authorityRole: null })));
    }
    return { teams, locations, relationships, currentWork, currentTasks, authorityRoles };
  });
}

async function metadataForResolution(tenantId: string, resolution: PartyResolution): Promise<Map<string, PartyMetadata>> {
  return loadMetadata(tenantId, resolution.candidates.map((candidate) => candidate.ref));
}

export async function partyLookup(tenantId: string, request: PartyLookupRequest, context: PartyReadExecutionContext = {}): Promise<PartyLookupResult> {
  const resolution = await resolve(tenantId, request, context);
  const publicStatus = publicResolution(resolution);
  const metadata = await metadataForResolution(tenantId, resolution);
  const limit = pageLimit(request, context);
  const candidatesPage = pageWindow(resolution.candidates, limit, request.page?.cursor, "party_lookup", (candidate) => refKey(candidate.ref));
  const rows = summaryMap(candidatesPage.items, metadata);
  const base = baseResult("party_lookup", publicStatus, asOf(context), [...PARTY_RESOLVER_SOURCE_TABLES], limit, rows.length, candidatesPage.page);
  return { ...base, resolution: publicStatus, rows, data: { resolution: publicStatus, rows } };
}

export async function partyContext(tenantId: string, request: PartyContextRequest, context: PartyReadExecutionContext = {}): Promise<PartyContextResult> {
  const resolution = await resolve(tenantId, request, context);
  const publicStatus = publicResolution(resolution);
  const metadata = await metadataForResolution(tenantId, resolution);
  const limit = pageLimit(request, context);
  const candidatesPage = pageWindow(resolution.candidates, limit, request.page?.cursor, "party_context", (candidate) => refKey(candidate.ref));
  const candidates = summaryMap(candidatesPage.items, metadata);
  const party = resolution.party ? candidateSummary(resolution.party, metadata.get(refKey(resolution.party.ref))) : null;
  const details = resolution.status === "resolved" && resolution.party ? await contextRows(tenantId, resolution.party.ref, context) : { teams: [], locations: [], relationships: [], currentWork: [], currentTasks: [], authorityRoles: [] };
  const base = baseResult("party_context", publicStatus, asOf(context), [...PARTY_RESOLVER_SOURCE_TABLES, "tasks", "employee_role_assignments", "employee_roles"], limit, party ? 1 : candidates.length, party ? {} : candidatesPage.page);
  const teams = summaryMap(details.teams, metadata);
  const locations = summaryMap(details.locations, metadata);
  return { ...base, resolution: publicStatus, party, candidates, teams, locations, relationships: details.relationships, currentWork: details.currentWork, currentTasks: details.currentTasks, authorityRoles: details.authorityRoles, data: { party, candidates, teams, locations, relationships: details.relationships, currentWork: details.currentWork, currentTasks: details.currentTasks, authorityRoles: details.authorityRoles } };
}

export async function teamRoster(tenantId: string, request: TeamRosterRequest, context: PartyReadExecutionContext = {}): Promise<TeamRosterResult> {
  const resolution = await resolve(tenantId, request, context);
  const publicStatus = publicResolution(resolution);
  const metadata = await metadataForResolution(tenantId, resolution);
  const limit = pageLimit(request, context);
  const candidates = summaryMap(resolution.candidates, metadata);
  const team = resolution.status === "resolved" && resolution.party?.ref.partyType === "team" ? resolution.party : null;
  const teamResolution: PublicResolution = team ? publicStatus : publicStatus === "exact" || publicStatus === "unique" ? "not_found" : publicStatus;
  const roster = team ? await withTenant(tenantId, async (db) => {
    const cursorKey = decodePageCursor(request.page?.cursor, "team_roster");
    const membershipWhere = and(eq(orgUnitMemberships.tenantId, tenantId), eq(orgUnitMemberships.orgUnitId, team.ref.partyId), eq(orgUnitMemberships.active, true), ...(cursorKey ? [gt(orgUnitMemberships.employeeId, cursorKey)] : []));
    const memberships = await db.select({ employeeId: orgUnitMemberships.employeeId, membershipRole: orgUnitMemberships.membershipRole })
      .from(orgUnitMemberships)
      .innerJoin(users, and(eq(users.id, orgUnitMemberships.employeeId), eq(users.tenantId, tenantId)))
      .where(and(membershipWhere, eq(users.status, "active")))
      .orderBy(asc(orgUnitMemberships.employeeId)).limit(limit + 1);
    const hasMore = memberships.length > limit;
    const visibleMemberships = memberships.slice(0, limit);
    if (visibleMemberships.length === 0) return { members: [] as Array<PartyCandidate & { membershipRole?: string | null }>, hasMore, nextCursor: null as string | null };
    const employees = await db.select({ id: users.id, displayName: users.displayName, status: users.status, role: users.role })
      .from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.id, visibleMemberships.map((row) => row.employeeId)))).limit(visibleMemberships.length);
    const byId = new Map(employees.map((row) => [row.id, { ref: { partyType: "employee" as const, partyId: row.id }, displayName: row.displayName ?? "Employee", status: row.status === "active" ? "active" as const : "suspended" as const, description: row.role }]));
    const members = visibleMemberships.flatMap((membership) => {
      const member = byId.get(membership.employeeId);
      return member ? [{ ...member, ...(membership.membershipRole ? { membershipRole: membership.membershipRole } : {}) }] : [];
    });
    return { members, hasMore, nextCursor: hasMore && members.length > 0 ? encodePageCursor("team_roster", members[members.length - 1]!.ref.partyId) : null };
  }) : { members: [] as Array<PartyCandidate & { membershipRole?: string | null }>, hasMore: false, nextCursor: null };
  const memberMetadata = await metadataForResolution(tenantId, { ...resolution, candidates: roster.members, party: null });
  const membersOut = roster.members.map((member) => ({ ...candidateSummary(member, memberMetadata.get(refKey(member.ref))), ...(member.membershipRole ? { membershipRole: member.membershipRole } : {}) }));
  const base = baseResult("team_roster", teamResolution, asOf(context), [...PARTY_RESOLVER_SOURCE_TABLES], limit, membersOut.length, {
    totalCount: roster.hasMore ? null : membersOut.length,
    totalCountExact: !roster.hasMore,
    hasMore: roster.hasMore,
    nextCursor: roster.nextCursor,
  });
  return { ...base, resolution: teamResolution, team: team ? candidateSummary(team, metadata.get(refKey(team.ref))) : null, candidates, members: membersOut, data: { team: team ? candidateSummary(team, metadata.get(refKey(team.ref))) : null, candidates, members: membersOut } };
}

function availabilityWindows(availability: unknown, rows: Array<{ dayOfWeek: number | null; startTime: string | null; endTime: string | null; maxConcurrentJobs: number }>): Array<{ dayOfWeek: number | null; startTime: string | null; endTime: string | null; maxConcurrentJobs: number | null }> {
  if (rows.length > 0) return rows.slice(0, 20).map((row) => ({ ...row, maxConcurrentJobs: row.maxConcurrentJobs }));
  if (!availability || typeof availability !== "object" || Array.isArray(availability)) return [];
  const input = availability as Record<string, unknown>;
  const values = input.windows ?? input.schedule ?? input.workingHours ?? input.working_hours;
  if (!Array.isArray(values)) return [];
  return values.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))).slice(0, 20).map((row) => ({
    dayOfWeek: typeof row.dayOfWeek === "number" ? row.dayOfWeek : typeof row.day_of_week === "number" ? row.day_of_week : null,
    startTime: typeof row.startTime === "string" ? row.startTime : typeof row.start_time === "string" ? row.start_time : null,
    endTime: typeof row.endTime === "string" ? row.endTime : typeof row.end_time === "string" ? row.end_time : null,
    maxConcurrentJobs: typeof row.maxConcurrentJobs === "number" ? row.maxConcurrentJobs : typeof row.max_concurrent_jobs === "number" ? row.max_concurrent_jobs : null,
  }));
}

export async function partyAvailability(tenantId: string, request: PartyAvailabilityRequest, context: PartyReadExecutionContext = {}): Promise<PartyAvailabilityResult> {
  const resolution = await resolve(tenantId, request, context);
  const publicStatus = publicResolution(resolution);
  const metadata = await metadataForResolution(tenantId, resolution);
  const limit = pageLimit(request, context);
  const candidatesPage = pageWindow(resolution.candidates, limit, request.page?.cursor, "party_availability", (candidate) => refKey(candidate.ref));
  const candidates = summaryMap(candidatesPage.items, metadata);
  const party = resolution.status === "resolved" ? resolution.party : null;
  const availabilityAsOf = asOf(context);
  const details = party ? await withTenant(tenantId, async (db) => {
    if (party.ref.partyType !== "employee") return { availability: "unknown" as const, windows: [], capacity: null, dispatchProfile: null, sourceTables: ["users"] };
    const [employee] = await db.select({ technicianId: users.technicianId, status: users.status }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, party.ref.partyId))).limit(1);
    if (!employee?.technicianId) return { availability: "unknown" as const, windows: [], capacity: null, dispatchProfile: null, sourceTables: ["users"] };
    const [technician] = await db.select({ availability: technicians.availability }).from(technicians).where(and(eq(technicians.tenantId, tenantId), eq(technicians.id, employee.technicianId))).limit(1);
    const capacityRows = await db.select({ dayOfWeek: technicianCapacity.dayOfWeek, startTime: technicianCapacity.startTime, endTime: technicianCapacity.endTime, maxConcurrentJobs: technicianCapacity.maxConcurrentJobs })
      .from(technicianCapacity)
      .where(and(eq(technicianCapacity.tenantId, tenantId), eq(technicianCapacity.technicianId, employee.technicianId), isNull(technicianCapacity.archivedAt)))
      .orderBy(asc(technicianCapacity.dayOfWeek), asc(technicianCapacity.startTime), asc(technicianCapacity.endTime), asc(technicianCapacity.id))
      .limit(20);
    const [dispatch] = await db.select({ workdayStart: technicianDispatchProfiles.workdayStart, workdayEnd: technicianDispatchProfiles.workdayEnd, defaultSlaMinutes: technicianDispatchProfiles.defaultSlaMinutes })
      .from(technicianDispatchProfiles).where(and(eq(technicianDispatchProfiles.tenantId, tenantId), eq(technicianDispatchProfiles.technicianId, employee.technicianId))).limit(1);
    const resolvedRange = await resolveTenantRange(
      db,
      tenantId,
      { localDateRange: request.localDateRange ?? { startDate: "today" } },
      availabilityAsOf,
    );
    const bounds = resolvedRange.range;
    const [appointmentsCount] = await db.select({ count: count(appointments.id) }).from(appointments).where(and(eq(appointments.tenantId, tenantId), eq(appointments.technicianId, employee.technicianId), isNull(appointments.archivedAt), inArray(appointments.status, ["hold", "confirmed"]), gte(appointments.scheduledAt, bounds.startDate), lt(appointments.scheduledAt, bounds.endDate)));
    const [visitsCount] = await db.select({ count: count(serviceVisits.id) }).from(serviceVisits).where(and(eq(serviceVisits.tenantId, tenantId), eq(serviceVisits.technicianId, employee.technicianId), gte(serviceVisits.scheduledAt, bounds.startDate), lt(serviceVisits.scheduledAt, bounds.endDate)));
    const [workOrdersCount] = await db.select({ count: count(workOrders.id) }).from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.technicianId, employee.technicianId), isNull(workOrders.archivedAt), inArray(workOrders.status, ["draft", "scheduled", "in_progress"]), gte(workOrders.scheduledAt, bounds.startDate), lt(workOrders.scheduledAt, bounds.endDate)));
    const openAssignments = Number(appointmentsCount?.count ?? 0) + Number(visitsCount?.count ?? 0) + Number(workOrdersCount?.count ?? 0);
    const windows = availabilityWindows(technician?.availability, capacityRows);
    const maxConcurrentJobs = capacityRows.map((row) => row.maxConcurrentJobs).sort((a, b) => a - b)[0] ?? null;
    const capacity = request.includeCapacity === false ? null : { openAssignments, maxConcurrentJobs };
    const dispatchProfile = dispatch ? { workdayStart: dispatch.workdayStart, workdayEnd: dispatch.workdayEnd, defaultSlaMinutes: dispatch.defaultSlaMinutes } : null;
    const hasWorkingState = windows.length > 0 || Boolean(dispatchProfile);
    return {
      availability: employee.status !== "active" ? "unavailable" as const : !hasWorkingState ? "unknown" as const : maxConcurrentJobs !== null && openAssignments >= maxConcurrentJobs ? "unavailable" as const : "available" as const,
      windows,
      capacity,
      dispatchProfile,
      sourceTables: ["users", "technicians", ...(windows.length ? ["technician_capacity"] : []), ...(dispatchProfile ? ["technician_dispatch_profiles"] : []), "appointments", "service_visits", "work_orders"],
    };
  }) : { availability: "unknown" as const, windows: [], capacity: null, dispatchProfile: null, sourceTables: [] };
  const publicParty = party ? candidateSummary(party, metadata.get(refKey(party.ref))) : null;
  const base = baseResult("party_availability", publicStatus, asOf(context), [...PARTY_RESOLVER_SOURCE_TABLES, "technician_capacity", "technician_dispatch_profiles", "appointments", "service_visits"], limit, party ? 1 : candidates.length, party ? {} : candidatesPage.page);
  return { ...base, resolution: publicStatus, party: publicParty, candidates, ...details, data: { party: publicParty, candidates, availability: details.availability, windows: details.windows, capacity: details.capacity, dispatchProfile: details.dispatchProfile } };
}

export async function executePartyOperationalQuery(
  tenantId: string,
  request: PartyLookupRequest | PartyContextRequest | TeamRosterRequest | PartyAvailabilityRequest,
  context: PartyReadExecutionContext = {},
): Promise<PartyLookupResult | PartyContextResult | TeamRosterResult | PartyAvailabilityResult> {
  switch (request.intent) {
    case "party_lookup": return partyLookup(tenantId, request, context);
    case "party_context": return partyContext(tenantId, request, context);
    case "team_roster": return teamRoster(tenantId, request, context);
    case "party_availability": return partyAvailability(tenantId, request, context);
  }
}

export async function loadOperatingDirectoryContext(tenantId: string, context: PartyReadExecutionContext = {}): Promise<OperatingCompanyDirectory> {
  const employeeId = context.employeeId ?? (isUuid(context.userId) ? context.userId : undefined);
  const resolution = employeeId
    ? await resolveParty(tenantId, { ref: { partyType: "employee", partyId: employeeId } }, resolverContext(context))
    : { status: "not_found", method: null, query: null, party: null, candidates: [] } satisfies PartyResolution;
  const metadata = await metadataForResolution(tenantId, resolution);
  const employee = resolution.party ? candidateSummary(resolution.party, metadata.get(refKey(resolution.party.ref))) : null;
  const details = resolution.status === "resolved" && resolution.party ? await contextRows(tenantId, resolution.party.ref, context) : { teams: [], locations: [], relationships: [], currentWork: [], currentTasks: [], authorityRoles: [] };
  const byType = (type: PartyRef["partyType"]) => details.relationships.flatMap((row) => [row.from, row.to]).filter((ref) => ref.partyType === type);
  const relatedPeople = [...new Set(byType("employee").map((ref) => refKey(ref)))].map((key) => details.relationships.flatMap((row) => [row.from, row.to]).find((ref) => refKey(ref) === key)).filter((ref): ref is PartyRef => Boolean(ref));
  const relatedResolutions = await Promise.all(relatedPeople.slice(0, MAX_PARTIES).map((ref) => resolveParty(tenantId, { ref }, resolverContext(context))));
  const relatedMetadata = await loadMetadata(tenantId, relatedResolutions.flatMap((item) => item.candidates.map((candidate) => candidate.ref)));
  const relatedSummaries = new Map(relatedResolutions.flatMap((item) => item.party ? [[refKey(item.party.ref), candidateSummary(item.party, relatedMetadata.get(refKey(item.party.ref)))]] as Array<[string, OperationalPartySummary]> : []));
  const rel = (kind: "manager" | "backup" | "assistant", inverse = false) => details.relationships.filter((row) => row.relationship === kind && (inverse ? row.to.partyId === employee?.ref.partyId : row.from.partyId === employee?.ref.partyId)).map((row) => relatedSummaries.get(refKey(inverse ? row.from : row.to))).filter((item): item is OperationalPartySummary => Boolean(item)).slice(0, MAX_PARTIES);
  const referencedResolutions = await Promise.all((context.referencedPartyRefs ?? []).slice(0, MAX_PARTIES).map((ref) => resolveParty(tenantId, { ref }, resolverContext(context))));
  const referencedCandidates = referencedResolutions.flatMap((item) => item.candidates);
  const referencedMetadata = await loadMetadata(tenantId, referencedCandidates.map((candidate) => candidate.ref));
  const referencedParties = summaryMap(referencedCandidates, referencedMetadata);
  return {
    employee,
    teams: details.teams.map((candidate) => candidateSummary(candidate)),
    locations: details.locations.map((candidate) => candidateSummary(candidate)),
    reporting: { manager: rel("manager")[0] ?? null, reports: rel("manager", true), backups: rel("backup"), assistants: rel("assistant") },
    currentWork: details.currentWork,
    currentTasks: details.currentTasks,
    authorityRoles: details.authorityRoles,
    referencedParties,
    sourceTables: [...new Set([...PARTY_RESOLVER_SOURCE_TABLES, "tasks", "employee_role_assignments", "employee_roles"])],
  };
}
