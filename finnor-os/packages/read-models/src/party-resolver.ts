import { withTenant, type Db } from "@finnor/db";
import {
  PARTY_TYPES,
  type PartyCandidate,
  type PartyOperationalStatus,
  type PartyRef,
  type PartyResolution,
  type PartyResolutionMethod,
  type PartyResolverContext,
  type PartyResolverInput,
  type PartyType,
} from "@finnor/shared-types";
import { sql } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTY_TYPE_SET = new Set<string>(PARTY_TYPES);
const RESULT_CAP = 20;
const FUZZY_DIRECTORY_CAP = 500;
const RESOLVER_INPUT_KEYS = new Set(["ref", "partyId", "query"]);
const PARTY_REF_KEYS = new Set(["partyType", "partyId"]);

interface DirectoryRow extends Record<string, unknown> {
  party_type: PartyType;
  party_id: string;
  display_name: string;
  operational_status: PartyOperationalStatus;
  description: string | null;
  normalized_name: string;
  email_value: string | null;
  phone_value: string | null;
}

// One canonical projection over the existing employee/customer directory and the
// additive Company World tables. It intentionally excludes credential/profile JSON
// and returns only fields required to resolve and clarify a party.
function directorySql(tenantId: string) {
  return sql`
  SELECT 'employee'::text AS party_type, u.id AS party_id,
         coalesce(nullif(btrim(u.display_name), ''), 'Employee') AS display_name,
         CASE WHEN u.status='active' THEN 'active' ELSE 'suspended' END::text AS operational_status,
         coalesce(nullif(btrim(p.title), ''), initcap(u.role)) AS description,
         finnor_os.normalize_party_text(coalesce(nullif(btrim(u.display_name), ''), '')) AS normalized_name,
         u.email AS email_value, u.phone_number AS phone_value
  FROM finnor_os.users u
  LEFT JOIN finnor_os.user_operating_profiles p ON p.tenant_id=u.tenant_id AND p.user_id=u.id
  WHERE u.tenant_id=${tenantId}::uuid
  UNION ALL
  SELECT 'team', o.id, o.name,
         CASE WHEN o.active THEN 'active' ELSE 'inactive' END,
         initcap(o.kind), finnor_os.normalize_party_text(o.name), NULL, NULL
  FROM finnor_os.org_units o WHERE o.tenant_id=${tenantId}::uuid
  UNION ALL
  SELECT 'location', l.id, l.name,
         CASE WHEN l.active THEN 'active' ELSE 'inactive' END,
         'Operating location', finnor_os.normalize_party_text(l.name), NULL, NULL
  FROM finnor_os.tenant_locations l WHERE l.tenant_id=${tenantId}::uuid
  UNION ALL
  SELECT 'household', h.id,
         coalesce(nullif(btrim(h.contact_info->>'name'), ''), 'Customer household'),
         'active', 'Customer household',
         finnor_os.normalize_party_text(coalesce(nullif(btrim(h.contact_info->>'name'), ''), '')),
         nullif(btrim(h.contact_info->>'email'), ''), nullif(btrim(h.contact_info->>'phone'), '')
  FROM finnor_os.households h WHERE h.tenant_id=${tenantId}::uuid
  UNION ALL
  SELECT 'contact', c.id, c.name,
         CASE WHEN c.archived_at IS NULL THEN 'active' ELSE 'inactive' END,
         coalesce(nullif(btrim(c.role), ''), 'Customer contact'),
         finnor_os.normalize_party_text(c.name), NULL, NULL
  FROM finnor_os.contacts c WHERE c.tenant_id=${tenantId}::uuid
  UNION ALL
  SELECT 'external_organization', e.id, e.name,
         CASE WHEN e.active THEN 'active' ELSE 'inactive' END,
         initcap(e.kind), finnor_os.normalize_party_text(e.name), e.business_email, e.business_phone
  FROM finnor_os.external_organizations e WHERE e.tenant_id=${tenantId}::uuid
  UNION ALL
  SELECT 'external_contact', c.id, c.name,
         CASE WHEN c.active THEN 'active' ELSE 'inactive' END,
         coalesce(nullif(btrim(c.title), ''), 'External contact'),
         finnor_os.normalize_party_text(c.name), c.business_email, c.business_phone
  FROM finnor_os.external_contacts c WHERE c.tenant_id=${tenantId}::uuid
  `;
}

function candidate(row: DirectoryRow): PartyCandidate {
  return {
    ref: { partyType: row.party_type, partyId: row.party_id },
    displayName: row.display_name,
    status: row.operational_status,
    description: row.description,
  };
}

function uniqueCandidates(rows: DirectoryRow[]): PartyCandidate[] {
  const seen = new Map<string, PartyCandidate>();
  for (const row of rows) {
    if (!PARTY_TYPE_SET.has(row.party_type) || !UUID.test(row.party_id)) continue;
    const value = candidate(row);
    seen.set(`${value.ref.partyType}:${value.ref.partyId}`, value);
  }
  return [...seen.values()]
    .sort((a, b) => a.ref.partyType.localeCompare(b.ref.partyType)
      || a.displayName.localeCompare(b.displayName)
      || a.ref.partyId.localeCompare(b.ref.partyId));
}

function outcome(
  rows: DirectoryRow[],
  method: PartyResolutionMethod,
  query: string | null,
): PartyResolution {
  const candidates = uniqueCandidates(rows);
  const active = candidates.filter((item) => item.status === "active");
  if (active.length === 1) {
    return { status: "resolved", method, query, party: active[0]!, candidates: active };
  }
  if (active.length > 1) {
    return { status: "ambiguous", method, query, party: null, candidates: active.slice(0, RESULT_CAP) };
  }
  if (candidates.length > 0) {
    return { status: "inactive", method, query, party: null, candidates: candidates.slice(0, RESULT_CAP) };
  }
  return { status: "not_found", method: null, query, party: null, candidates: [] };
}

function notFound(query: string | null): PartyResolution {
  return { status: "not_found", method: null, query, party: null, candidates: [] };
}

async function canonicalNormalizedText(db: Db, value: string): Promise<string> {
  const result = await db.execute<{ normalized: string }>(sql`
    SELECT finnor_os.normalize_party_text(${value}) AS normalized
  `);
  return result.rows[0]?.normalized ?? "";
}

function assertResolverInputShape(input: PartyResolverInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Party resolver input must be an object");
  }
  const unknown = Object.keys(input).filter((key) => !RESOLVER_INPUT_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`Party resolver input contains unsupported fields: ${unknown.sort().join(", ")}`);
  }
  if (input.ref) {
    const unknownRef = Object.keys(input.ref).filter((key) => !PARTY_REF_KEYS.has(key));
    if (unknownRef.length > 0) {
      throw new Error(`PartyRef contains unsupported fields: ${unknownRef.sort().join(", ")}`);
    }
  }
}

async function directoryRows(
  db: Db,
  tenantId: string,
  where: ReturnType<typeof sql>,
  limit = RESULT_CAP + 1,
): Promise<DirectoryRow[]> {
  const result = await db.execute<DirectoryRow>(sql`
    WITH directory AS (${directorySql(tenantId)})
    SELECT party_type, party_id, display_name, operational_status, description,
           normalized_name, email_value, phone_value
    FROM directory
    WHERE ${where}
    ORDER BY party_type, display_name, party_id
    LIMIT ${limit}
  `);
  return result.rows;
}

async function exactReference(
  db: Db,
  tenantId: string,
  ref: PartyRef | null,
  id: string,
): Promise<DirectoryRow[]> {
  return directoryRows(
    db,
    tenantId,
    ref
      ? sql`party_type=${ref.partyType} AND party_id=${id}::uuid`
      : sql`party_id=${id}::uuid`,
  );
}

async function exactAlias(db: Db, tenantId: string, normalized: string): Promise<DirectoryRow[]> {
  const result = await db.execute<DirectoryRow>(sql`
    WITH directory AS (${directorySql(tenantId)})
    SELECT d.party_type, d.party_id, d.display_name, d.operational_status,
           d.description, d.normalized_name, d.email_value, d.phone_value
    FROM finnor_os.party_aliases a
    JOIN directory d ON d.party_type=a.party_type AND d.party_id=a.party_id
    WHERE a.tenant_id=${tenantId}::uuid AND a.active=true AND a.normalized_alias=${normalized}
    ORDER BY d.party_type, d.display_name, d.party_id
    LIMIT ${RESULT_CAP + 1}
  `);
  return result.rows;
}

async function exactBusinessContact(db: Db, tenantId: string, value: string): Promise<DirectoryRow[]> {
  const email = value.trim().toLowerCase();
  const phone = value.replace(/\D/g, "");
  const result = await db.execute<DirectoryRow>(sql`
    WITH directory AS (${directorySql(tenantId)}), matched AS (
      SELECT d.* FROM directory d
      WHERE (${email.includes("@")} AND lower(btrim(d.email_value))=${email})
         OR (${phone.length >= 7} AND regexp_replace(coalesce(d.phone_value,''), '[^0-9]', '', 'g')=${phone})
      UNION ALL
      SELECT d.*
      FROM finnor_os.contact_methods m
      JOIN directory d ON d.party_type='contact' AND d.party_id=m.contact_id
      WHERE m.tenant_id=${tenantId}::uuid
        AND ((m.method_type='email' AND lower(btrim(m.value))=${email})
          OR (${phone.length >= 7} AND m.method_type='phone'
              AND regexp_replace(m.value, '[^0-9]', '', 'g')=${phone}))
    )
    SELECT party_type, party_id, display_name, operational_status, description,
           normalized_name, email_value, phone_value
    FROM matched
    ORDER BY party_type, display_name, party_id
    LIMIT ${RESULT_CAP + 1}
  `);
  return result.rows;
}

async function exactName(db: Db, tenantId: string, normalized: string): Promise<DirectoryRow[]> {
  return directoryRows(db, tenantId, sql`normalized_name=${normalized}`);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3)));
}

function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

async function fuzzyName(db: Db, tenantId: string, normalized: string): Promise<DirectoryRow[]> {
  const rows = await directoryRows(db, tenantId, sql`normalized_name <> ''`, FUZZY_DIRECTORY_CAP + 1);
  // The cap is a deliberate safety boundary. Within it every plausible candidate is
  // returned; score is only a threshold and never a "pick the most likely" tiebreaker.
  return rows.slice(0, FUZZY_DIRECTORY_CAP).filter((row) => {
    const score = trigramSimilarity(normalized, row.normalized_name);
    return score >= 0.45
      || (normalized.length >= 4 && row.normalized_name.includes(normalized))
      || (row.normalized_name.length >= 4 && normalized.includes(row.normalized_name));
  });
}

async function employeesForRelationship(
  db: Db,
  tenantId: string,
  employeeId: string,
  relationship: "manager" | "backup" | "assistant" | "reports",
): Promise<DirectoryRow[]> {
  const result = await db.execute<DirectoryRow>(sql`
    WITH directory AS (${directorySql(tenantId)}), employee_ids AS (
      SELECT CASE WHEN ${relationship}='reports' THEN r.subject_employee_id ELSE r.related_employee_id END AS id
      FROM finnor_os.employee_relationships r
      WHERE r.tenant_id=${tenantId}::uuid AND r.active=true
        AND r.relationship_type=${relationship === "reports" ? "manager" : relationship}
        AND CASE WHEN ${relationship}='reports'
          THEN r.related_employee_id=${employeeId}::uuid
          ELSE r.subject_employee_id=${employeeId}::uuid
        END
    )
    SELECT d.party_type, d.party_id, d.display_name, d.operational_status,
           d.description, d.normalized_name, d.email_value, d.phone_value
    FROM employee_ids ids
    JOIN directory d ON d.party_type='employee' AND d.party_id=ids.id
    ORDER BY d.display_name, d.party_id
    LIMIT ${RESULT_CAP + 1}
  `);
  return result.rows;
}

async function teamsForEmployee(db: Db, tenantId: string, employeeId: string): Promise<DirectoryRow[]> {
  const result = await db.execute<DirectoryRow>(sql`
    WITH directory AS (${directorySql(tenantId)}), memberships AS (
      SELECT m.*
      FROM finnor_os.org_unit_memberships m
      WHERE m.tenant_id=${tenantId}::uuid AND m.employee_id=${employeeId}::uuid AND m.active=true
        AND (m.is_primary=true OR NOT EXISTS (
          SELECT 1 FROM finnor_os.org_unit_memberships primary_membership
          WHERE primary_membership.tenant_id=m.tenant_id
            AND primary_membership.employee_id=m.employee_id
            AND primary_membership.active=true AND primary_membership.is_primary=true
        ))
    )
    SELECT d.party_type, d.party_id, d.display_name, d.operational_status,
           d.description, d.normalized_name, d.email_value, d.phone_value
    FROM memberships m
    JOIN directory d ON d.party_type='team' AND d.party_id=m.org_unit_id
    ORDER BY m.is_primary DESC, d.display_name, d.party_id
    LIMIT ${RESULT_CAP + 1}
  `);
  return result.rows;
}

async function workTechnicians(db: Db, tenantId: string, workId: string): Promise<DirectoryRow[]> {
  const result = await db.execute<DirectoryRow>(sql`
    WITH directory AS (${directorySql(tenantId)}), employee_ids AS (
      SELECT w.assigned_to AS id
      FROM finnor_os.works w
      JOIN finnor_os.users u ON u.tenant_id=w.tenant_id AND u.id=w.assigned_to
      WHERE w.tenant_id=${tenantId}::uuid AND w.id=${workId}::uuid
        AND (u.role='technician' OR u.technician_id IS NOT NULL)
      UNION
      SELECT l.entity_id
      FROM finnor_os.work_entity_links l
      JOIN finnor_os.users u ON u.tenant_id=l.tenant_id AND u.id=l.entity_id
      WHERE l.tenant_id=${tenantId}::uuid AND l.work_id=${workId}::uuid
        AND l.entity_type='user' AND (u.role='technician' OR u.technician_id IS NOT NULL)
      UNION
      SELECT u.id
      FROM finnor_os.work_entity_links l
      JOIN finnor_os.users u ON u.tenant_id=l.tenant_id AND u.technician_id=l.entity_id
      WHERE l.tenant_id=${tenantId}::uuid AND l.work_id=${workId}::uuid AND l.entity_type='technician'
      UNION
      SELECT u.id
      FROM finnor_os.work_entity_links l
      JOIN finnor_os.work_orders wo ON wo.tenant_id=l.tenant_id AND wo.id=l.entity_id
      JOIN finnor_os.users u ON u.tenant_id=wo.tenant_id AND u.technician_id=wo.technician_id
      WHERE l.tenant_id=${tenantId}::uuid AND l.work_id=${workId}::uuid AND l.entity_type='work_order'
    )
    SELECT d.party_type, d.party_id, d.display_name, d.operational_status,
           d.description, d.normalized_name, d.email_value, d.phone_value
    FROM employee_ids ids
    JOIN directory d ON d.party_type='employee' AND d.party_id=ids.id
    WHERE ids.id IS NOT NULL
    ORDER BY d.display_name, d.party_id
    LIMIT ${RESULT_CAP + 1}
  `);
  return result.rows;
}

type RelationshipTarget = "manager" | "backup" | "assistant" | "team" | "reports";

function relationshipPhrase(normalized: string): { owner: "my" | string; target: RelationshipTarget } | null {
  const self = normalized.match(/^my (manager|backup|assistant|team|reports)$/);
  if (self) return { owner: "my", target: self[1] as RelationshipTarget };
  const named = normalized.match(/^(.+?) s (manager|backup|assistant|team|reports)$/);
  if (named?.[1] && named[2]) return { owner: named[1], target: named[2] as RelationshipTarget };
  return null;
}

async function queryStages(
  db: Db,
  tenantId: string,
  rawQuery: string,
  context: PartyResolverContext,
  allowRelationship = true,
): Promise<PartyResolution> {
  // Resolution uses the same database helper that normalizes stored aliases, so
  // canonical matching has exactly one source of truth.
  const normalized = await canonicalNormalizedText(db, rawQuery);
  if (!normalized) return notFound(rawQuery);

  const alias = await exactAlias(db, tenantId, normalized);
  if (alias.length > 0) return outcome(alias, "alias", rawQuery);

  const contacts = await exactBusinessContact(db, tenantId, rawQuery);
  if (contacts.length > 0) return outcome(contacts, "business_contact", rawQuery);

  if (allowRelationship) {
    if (/^(?:the )?technician assigned to (?:this|the current) work$/.test(normalized)) {
      if (!context.workId || !UUID.test(context.workId)) return notFound(rawQuery);
      const related = await workTechnicians(db, tenantId, context.workId);
      return related.length > 0 ? outcome(related, "work_context", rawQuery) : notFound(rawQuery);
    }

    const phrase = relationshipPhrase(normalized);
    if (phrase) {
      let employeeId: string | null = null;
      if (phrase.owner === "my") {
        employeeId = context.requesterEmployeeId && UUID.test(context.requesterEmployeeId)
          ? context.requesterEmployeeId
          : null;
      } else {
        const owner = await queryStages(db, tenantId, phrase.owner, context, false);
        if (owner.status !== "resolved" || owner.party?.ref.partyType !== "employee") {
          return owner.status === "ambiguous" || owner.status === "inactive"
            ? { ...owner, method: "relationship", query: rawQuery }
            : notFound(rawQuery);
        }
        employeeId = owner.party.ref.partyId;
      }
      if (!employeeId) return notFound(rawQuery);
      const related = phrase.target === "team"
        ? await teamsForEmployee(db, tenantId, employeeId)
        : await employeesForRelationship(db, tenantId, employeeId, phrase.target);
      return related.length > 0 ? outcome(related, "relationship", rawQuery) : notFound(rawQuery);
    }
  }

  const names = await exactName(db, tenantId, normalized);
  if (names.length > 0) return outcome(names, "exact_name", rawQuery);

  const fuzzy = await fuzzyName(db, tenantId, normalized);
  return fuzzy.length > 0 ? outcome(fuzzy, "fuzzy", rawQuery) : notFound(rawQuery);
}

/**
 * The single deterministic Company World resolver. `tenantId` and relationship
 * context are separate trusted arguments; PartyResolverInput intentionally has no
 * tenant or employee selector that a planner/user payload could forge.
 */
export async function resolveParty(
  tenantId: string,
  input: PartyResolverInput,
  context: PartyResolverContext = {},
): Promise<PartyResolution> {
  assertResolverInputShape(input);
  return withTenant(tenantId, async (db) => {
    if (input.ref) {
      if (!PARTY_TYPE_SET.has(input.ref.partyType) || !UUID.test(input.ref.partyId)) return notFound(input.query ?? null);
      const rows = await exactReference(db, tenantId, input.ref, input.ref.partyId);
      return rows.length > 0 ? outcome(rows, "explicit_ref", input.query ?? null) : notFound(input.query ?? null);
    }

    const explicitId = input.partyId ?? (input.query && UUID.test(input.query.trim()) ? input.query.trim() : null);
    if (explicitId) {
      if (!UUID.test(explicitId)) return notFound(input.query ?? null);
      const rows = await exactReference(db, tenantId, null, explicitId);
      return rows.length > 0 ? outcome(rows, "explicit_ref", input.query ?? explicitId) : notFound(input.query ?? explicitId);
    }

    return input.query ? queryStages(db, tenantId, input.query, context) : notFound(null);
  });
}
