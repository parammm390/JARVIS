// Cross-entity read-models (Phase 6, docs/jarvis-90-execution-blueprint.md §6). Plain
// typed queries over business_events/data_quality_findings/existing domain tables — no
// LLM involved. Each function answers one operational question a dealer owner (or
// workflow 6's daily digest) actually asks, grounded in tables that already exist.

import {
  withTenant,
  type Db,
  leads,
  quotes,
  proposals,
  technicians,
  appointments,
  workOrders,
  invoices,
  payments,
  inventoryItems,
  warehouseStock,
  procurementOrders,
  maintenanceAgreements,
  households,
  conversations,
  workflowRuns,
  workflowSteps,
  computerSteps,
  reconciliationCases,
  dataQualityFindings,
  contacts,
  contactMethods,
  opportunities,
  serviceVisits,
  messages,
  documents,
  communicationsLog,
  businessEvents,
  equipment,
  domainActions,
  decisionReceipts,
  deadLetters,
  readinessLog,
  failureInjections,
  actionLog,
  calls,
  tasks,
  works,
  workEntityLinks,
  businessOperations,
  businessOperationTargets,
} from "@finnor/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { performance } from "node:perf_hooks";
import { holtWinters, type ForecastPoint } from "./holt-winters";
import { rollingZScores } from "./anomaly-detector";
import {
  partyRefToCanonicalEntityRef,
  type CanonicalEntityNode,
  type CanonicalEntityRef,
  type CanonicalRelationship,
  type CompanyContext,
  type CompanyContextAnchor,
  type BusinessScene,
  type BusinessWorldObject,
  type BusinessWorldProjection,
} from "@finnor/shared-types";

export * from "./route-optimizer";
export * from "./slot-recommender";
export * from "./holt-winters";
export * from "./anomaly-detector";
export * from "./churn-risk";
export * from "./reorder-points";
export * from "./failure-injection-calendar";
export * from "./work-cases";
export * from "./operational-queries";
export * from "./party-resolver";
export * from "./party-queries";
export * from "./execution-projection";
export * from "./causal-replay";

export interface IntelligenceForecasts {
  cashCollections: ForecastPoint[] | null;
  visitVolume: ForecastPoint[] | null;
  historyDays: number;
}

/** B3.T3: cash is actual succeeded payment receipt time; visit volume is actual
 * scheduled service-visit time. We deliberately do not substitute invoice issue dates
 * or created-at timestamps for either series. */
export async function intelligenceForecasts(tenantId: string, historyDays = 56): Promise<IntelligenceForecasts> {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - historyDays + 1));
  const { paymentRows, visitRows } = await withTenant(tenantId, async (db) => {
    const paymentRows = await db.select({ receivedAt: payments.receivedAt, amountUsd: payments.amountUsd }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.status, "succeeded"), gte(payments.receivedAt, start)));
    const visitRows = await db.select({ scheduledAt: serviceVisits.scheduledAt }).from(serviceVisits).innerJoin(households, eq(households.id, serviceVisits.householdId)).where(and(eq(households.tenantId, tenantId), gte(serviceVisits.scheduledAt, start)));
    return { paymentRows, visitRows };
  });
  const key = (date: Date) => date.toISOString().slice(0, 10);
  const cashByDay = new Map<string, number>();
  const visitsByDay = new Map<string, number>();
  for (const row of paymentRows) cashByDay.set(key(row.receivedAt), (cashByDay.get(key(row.receivedAt)) ?? 0) + Number(row.amountUsd));
  for (const row of visitRows) if (row.scheduledAt) visitsByDay.set(key(row.scheduledAt), (visitsByDay.get(key(row.scheduledAt)) ?? 0) + 1);
  const days = Array.from({ length: historyDays }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000);
    return { cash: cashByDay.get(key(day)) ?? 0, visits: visitsByDay.get(key(day)) ?? 0 };
  });
  return { cashCollections: holtWinters(days.map((day) => day.cash)), visitVolume: holtWinters(days.map((day) => day.visits)), historyDays };
}

export async function readinessAnomalies(tenantId: string): Promise<Array<{ metric: "failure_rate"; value: number; zScore: number }>> {
  const rows = await withTenant(tenantId, (db) => db.select({ success: readinessLog.workflowSuccessRate }).from(readinessLog).where(and(eq(readinessLog.tenantId, tenantId), isNotNull(readinessLog.workflowSuccessRate))).orderBy(desc(readinessLog.logDate)).limit(60));
  const values = rows.reverse().map((row) => 1 - row.success!);
  return rollingZScores(values).filter((point) => point.index === values.length - 1).map((point) => ({ metric: "failure_rate" as const, value: point.value, zScore: point.zScore }));
}

export interface PipelineHealth {
  leadsByStatus: Array<{ status: string; count: number }>;
  quotesByStatus: Array<{ status: string; count: number }>;
  proposalsByStatus: Array<{ status: string; count: number }>;
}

export async function pipelineHealth(tenantId: string): Promise<PipelineHealth> {
  return withTenant(tenantId, async (db) => {
    const leadsByStatus = await db
      .select({ status: leads.status, count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.tenantId, tenantId))
      .groupBy(leads.status);
    const quotesByStatus = await db
      .select({ status: quotes.status, count: sql<number>`count(*)::int` })
      .from(quotes)
      .where(eq(quotes.tenantId, tenantId))
      .groupBy(quotes.status);
    // proposals has no tenant_id column of its own — scope through the household it belongs to.
    const proposalsByStatus = await db
      .select({ status: proposals.status, count: sql<number>`count(*)::int` })
      .from(proposals)
      .innerJoin(households, eq(households.id, proposals.householdId))
      .where(eq(households.tenantId, tenantId))
      .groupBy(proposals.status);
    return { leadsByStatus, quotesByStatus, proposalsByStatus };
  });
}

export interface TechnicianLoad {
  technicianId: string;
  name: string;
  upcomingAppointments: number;
  openWorkOrders: number;
}

export async function technicianLoad(tenantId: string): Promise<TechnicianLoad[]> {
  return withTenant(tenantId, async (db) => {
    const techs = await db.select({ id: technicians.id, name: technicians.name }).from(technicians).where(eq(technicians.tenantId, tenantId));
    const results: TechnicianLoad[] = [];
    for (const t of techs) {
      const [apptRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(eq(appointments.technicianId, t.id), inArray(appointments.status, ["hold", "confirmed"])));
      const [woRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(and(eq(workOrders.technicianId, t.id), inArray(workOrders.status, ["draft", "scheduled", "in_progress"])));
      results.push({ technicianId: t.id, name: t.name, upcomingAppointments: apptRow!.count, openWorkOrders: woRow!.count });
    }
    return results;
  });
}

export interface StockRiskItem {
  sku: string;
  name: string | null;
  quantity: number;
  reorderThreshold: number;
  source: "inventory_items" | "warehouse_stock";
}

export interface StockRisk {
  belowThreshold: StockRiskItem[];
  openProcurementOrders: number;
}

export async function stockRisk(tenantId: string): Promise<StockRisk> {
  return withTenant(tenantId, async (db) => {
    const items = await db
      .select({ sku: inventoryItems.sku, name: inventoryItems.name, quantity: inventoryItems.quantity, reorderThreshold: inventoryItems.reorderThreshold })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), sql`${inventoryItems.quantity} <= ${inventoryItems.reorderThreshold}`));
    const stock = await db
      .select({ sku: warehouseStock.sku, quantity: warehouseStock.quantity, reorderThreshold: warehouseStock.reorderThreshold })
      .from(warehouseStock)
      .where(and(eq(warehouseStock.tenantId, tenantId), sql`${warehouseStock.quantity} <= ${warehouseStock.reorderThreshold}`));
    const [procRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(procurementOrders)
      .where(and(eq(procurementOrders.tenantId, tenantId), inArray(procurementOrders.status, ["draft", "ordered"])));
    return {
      belowThreshold: [
        ...items.map((i) => ({ ...i, source: "inventory_items" as const })),
        ...stock.map((s) => ({ ...s, name: null, source: "warehouse_stock" as const })),
      ],
      openProcurementOrders: procRow!.count,
    };
  });
}

export interface CashCollections {
  invoicesByStatus: Array<{ status: string; count: number; totalUsd: number }>;
  totalCollected: number;
  paymentLinksAwaitingPayment: number;
}

export async function cashCollections(tenantId: string): Promise<CashCollections> {
  return withTenant(tenantId, async (db) => {
    const invoicesByStatus = await db
      .select({ status: invoices.status, count: sql<number>`count(*)::int`, totalUsd: sql<number>`coalesce(sum(${invoices.amountUsd}), 0)::float` })
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId))
      .groupBy(invoices.status);
    const [collectedRow] = await db
      .select({ totalCollected: sql<number>`coalesce(sum(${payments.amountUsd}), 0)::float` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.status, "succeeded")));
    const [linksRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.stepType, "create_payment_link"), inArray(workflowSteps.status, ["pending", "leased", "completed"])));
    return { invoicesByStatus, totalCollected: collectedRow!.totalCollected, paymentLinksAwaitingPayment: linksRow!.count };
  });
}

export interface RouteSavingsBriefing {
  proposals: number;
  naiveKm: number;
  optimizedKm: number;
  kmSaved: number;
}

/** Completed B3 route suggestions are receipted runtime results.  The owner briefing
 * reads them back; it never recomputes a route or claims a saving that was not
 * actually returned by OSRM. */
export async function routeSavingsBriefing(tenantId: string, date = new Date()): Promise<RouteSavingsBriefing> {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  const rows = await withTenant(tenantId, (db) =>
    db
      .select({ actualResult: decisionReceipts.actualResult })
      .from(decisionReceipts)
      .innerJoin(domainActions, eq(domainActions.id, decisionReceipts.domainActionId))
      .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.actionType, "route_suggestion"), gte(decisionReceipts.createdAt, start), lt(decisionReceipts.createdAt, end))),
  );
  return rows.reduce<RouteSavingsBriefing>(
    (total, row) => {
      const output = ((row.actualResult as { output?: unknown } | null)?.output ?? {}) as Record<string, unknown>;
      const naiveKm = typeof output.naiveKm === "number" ? output.naiveKm : null;
      const optimizedKm = typeof output.optimizedKm === "number" ? output.optimizedKm : null;
      const kmSaved = typeof output.kmSaved === "number" ? output.kmSaved : null;
      if (naiveKm === null || optimizedKm === null || kmSaved === null) return total;
      return { proposals: total.proposals + 1, naiveKm: total.naiveKm + naiveKm, optimizedKm: total.optimizedKm + optimizedKm, kmSaved: total.kmSaved + kmSaved };
    },
    { proposals: 0, naiveKm: 0, optimizedKm: 0, kmSaved: 0 },
  );
}

export interface ServiceDueAgreement {
  agreementId: string;
  householdId: string;
  cadence: string;
  status: string;
  renewalDate: string | null;
}

export async function serviceDue(tenantId: string, windowDays = 30): Promise<ServiceDueAgreement[]> {
  const cutoff = new Date(Date.now() + windowDays * 86_400_000);
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        agreementId: maintenanceAgreements.id,
        householdId: maintenanceAgreements.householdId,
        cadence: maintenanceAgreements.cadence,
        status: maintenanceAgreements.status,
        renewalDate: maintenanceAgreements.renewalDate,
      })
      .from(maintenanceAgreements)
      .innerJoin(households, eq(households.id, maintenanceAgreements.householdId))
      .where(
        and(
          eq(households.tenantId, tenantId),
          inArray(maintenanceAgreements.status, ["active", "renewal_window", "renewal_sent"]),
          lt(maintenanceAgreements.renewalDate, cutoff),
        ),
      );
    return rows.map((r) => ({ ...r, renewalDate: r.renewalDate?.toISOString() ?? null }));
  });
}

export interface SlaBreaches {
  stuckWorkflowRuns: number;
  openReconciliationCases: number;
}

/** "Stuck" means still `running` and not updated in the last STALL_HOURS — a real
 *  workflow either advances a step or terminates; sitting untouched this long means
 *  something silently died without failing the run itself (a worker crash between
 *  advanceWorkflow's own updates, or a step whose lease was never reclaimed). */
export async function slaBreaches(tenantId: string, stallHours = 24): Promise<SlaBreaches> {
  const cutoff = new Date(Date.now() - stallHours * 3600_000);
  return withTenant(tenantId, async (db) => {
    const [runsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.tenantId, tenantId), eq(workflowRuns.status, "running"), lt(workflowRuns.updatedAt, cutoff)));
    const [casesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reconciliationCases)
      .where(and(eq(reconciliationCases.tenantId, tenantId), eq(reconciliationCases.status, "open")));
    return { stuckWorkflowRuns: runsRow!.count, openReconciliationCases: casesRow!.count };
  });
}

export interface FollowUpDebtItem {
  entityType: "lead" | "quote";
  entityId: string;
  householdId: string | null;
  status: string;
  lastActivityAt: string | null;
}

/** A lead/quote whose household has no conversation activity in `staleDays` — or none
 *  at all — is follow-up debt: something the pipeline is quietly not chasing. */
export async function followUpDebt(tenantId: string, staleDays = 7): Promise<FollowUpDebtItem[]> {
  const cutoff = new Date(Date.now() - staleDays * 86_400_000);
  return withTenant(tenantId, async (db) => {
    const openLeads = await db
      .select({ id: leads.id, householdId: leads.householdId, status: leads.status })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), inArray(leads.status, ["new", "contacted", "qualified"])));
    const openQuotes = await db
      .select({ id: quotes.id, householdId: quotes.householdId, status: quotes.status })
      .from(quotes)
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.status, "sent")));

    const results: FollowUpDebtItem[] = [];
    for (const l of openLeads) {
      const stale = await isHouseholdStale(db, tenantId, l.householdId, cutoff);
      if (stale.stale) results.push({ entityType: "lead", entityId: l.id, householdId: l.householdId, status: l.status, lastActivityAt: stale.lastActivityAt });
    }
    for (const q of openQuotes) {
      const stale = await isHouseholdStale(db, tenantId, q.householdId, cutoff);
      if (stale.stale) results.push({ entityType: "quote", entityId: q.id, householdId: q.householdId, status: q.status, lastActivityAt: stale.lastActivityAt });
    }
    return results;
  });
}

async function isHouseholdStale(
  db: Db,
  tenantId: string,
  householdId: string | null,
  cutoff: Date,
): Promise<{ stale: boolean; lastActivityAt: string | null }> {
  if (!householdId) return { stale: true, lastActivityAt: null };
  const [convo] = await db
    .select({ lastActivityAt: conversations.lastActivityAt })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.householdId, householdId)))
    .orderBy(sql`${conversations.lastActivityAt} desc`)
    .limit(1);
  if (!convo) return { stale: true, lastActivityAt: null };
  return { stale: convo.lastActivityAt < cutoff, lastActivityAt: convo.lastActivityAt.toISOString() };
}

export interface DataQualitySummary {
  byTypeAndSeverity: Array<{ findingType: string; severity: string; count: number }>;
  totalUnresolved: number;
}

export async function dataQuality(tenantId: string): Promise<DataQualitySummary> {
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({ findingType: dataQualityFindings.findingType, severity: dataQualityFindings.severity, count: sql<number>`count(*)::int` })
      .from(dataQualityFindings)
      .where(and(eq(dataQualityFindings.tenantId, tenantId), isNull(dataQualityFindings.resolvedAt)))
      .groupBy(dataQualityFindings.findingType, dataQualityFindings.severity);
    return { byTypeAndSeverity: rows, totalUnresolved: rows.reduce((s, r) => s + r.count, 0) };
  });
}

// ---------------------------------------------------------------------------
// Household 360 (Phase 11, docs/jarvis-99-phase-10-16-execution-plan.md §PHASE 11).
// Traverses BOTH table generations linked to a household: pre-canonical (equipment,
// service_visits, maintenance_agreements via serviceDue above, communications_log)
// and canonical (contacts+contact_methods, leads, opportunities, quotes,
// invoices+payments, work_orders, appointments, conversations+messages, documents),
// plus the business_events timeline. This is a read-model + API + console surface —
// deliberately NOT wired into the planner prompt (ground-truth §14: longTerm already
// isn't serialized into the LLM prompt; extending that is a named non-goal here to
// keep the token-budget blast radius at zero for this phase).
// ---------------------------------------------------------------------------

export interface HouseholdMentionMatch {
  householdId: string;
  label: string;
  matchedAlias: string;
  matchKind: "phone" | "name" | "address";
  fuzzy?: boolean;
  /** Normalized phrase found in the instruction when a typo-safe name match won. */
  instructionAlias?: string;
}

function normalizeMention(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Placeholder labels are not identities. Matching an instruction such as
 * "show the customer record for Daniel..." against a household literally named
 * "Customer" silently loads the wrong person's history. Keep these values usable
 * as display fallbacks, but never treat them as mention aliases. */
function isPlaceholderHouseholdName(value: string): boolean {
  const normalized = normalizeMention(value);
  return /^(?:customer|unknown(?: customer)?|homeowner|resident|prospect|lead|contact|caller|guest|anonymous|walk in|test(?: customer)?)(?: \d+)?$/.test(normalized);
}

function editDistance(a: string, b: string): number {
  const prior = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1]! + 1, prior[j]! + 1, prior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prior.splice(0, prior.length, ...current);
  }
  return prior[b.length]!;
}

function closeNameMention(instruction: string, candidate: string): string | null {
  const candidateTokens = candidate.split(" ").filter(Boolean);
  const instructionTokens = instruction.split(" ").filter(Boolean);
  if (candidateTokens.length < 2 || instructionTokens.length < candidateTokens.length || candidate.length < 8) return null;
  for (let start = 0; start <= instructionTokens.length - candidateTokens.length; start++) {
    const phraseTokens = instructionTokens.slice(start, start + candidateTokens.length);
    if (phraseTokens[0] !== candidateTokens[0]) continue;
    const phrase = phraseTokens.join(" ");
    if (editDistance(phrase, candidate) <= 2) return phrase;
  }
  return null;
}

/** Resolve a customer explicitly named in an owner instruction. This is deliberately
 * exact and fail-closed: the longest unique full name/address/phone wins; tied rows
 * return null so JARVIS asks rather than loading the wrong household's memory. */
export async function resolveHouseholdMention(tenantId: string, instruction: string): Promise<HouseholdMentionMatch | null> {
  const normalizedInstruction = normalizeMention(instruction);
  const instructionDigits = instruction.replace(/\D/g, "");
  if (!normalizedInstruction && instructionDigits.length < 7) return null;
  const candidates = await withTenant(tenantId, async (db) => {
    // A tenant transaction owns one pg client; keep its queries sequential so pg@9
    // does not rely on the deprecated concurrent-query queueing behavior.
    const householdRows = await db.select({ id: households.id, address: households.address, contactInfo: households.contactInfo }).from(households).where(eq(households.tenantId, tenantId));
    const contactRows = await db.select({ householdId: contacts.householdId, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), isNull(contacts.archivedAt)));
    const contactsByHousehold = new Map<string, string[]>();
    for (const contact of contactRows) {
      if (!contact.householdId) continue;
      const list = contactsByHousehold.get(contact.householdId) ?? [];
      list.push(contact.name);
      contactsByHousehold.set(contact.householdId, list);
    }
    return householdRows.map((row) => {
      const info = (row.contactInfo ?? {}) as Record<string, unknown>;
      const allNames = [typeof info.name === "string" ? info.name : undefined, ...(contactsByHousehold.get(row.id) ?? [])].filter((value): value is string => Boolean(value));
      const names = allNames.filter((value) => !isPlaceholderHouseholdName(value));
      return {
        id: row.id,
        label: allNames[0] ?? row.address,
        aliases: [
          ...names.map((value) => ({ value, kind: "name" as const, weight: 3000 })),
          { value: row.address, kind: "address" as const, weight: 2000 },
          ...(typeof info.phone === "string" ? [{ value: info.phone, kind: "phone" as const, weight: 4000 }] : []),
        ],
      };
    });
  });

  const scored: Array<HouseholdMentionMatch & { score: number }> = [];
  for (const candidate of candidates) {
    for (const alias of candidate.aliases) {
      const normalizedAlias = normalizeMention(alias.value);
      const phoneDigits = alias.kind === "phone" ? alias.value.replace(/\D/g, "") : "";
      const exact = alias.kind === "phone"
        ? phoneDigits.length >= 7 && instructionDigits.includes(phoneDigits)
        : normalizedAlias.length >= 3 && ` ${normalizedInstruction} `.includes(` ${normalizedAlias} `);
      const fuzzyPhrase = !exact && alias.kind === "name" ? closeNameMention(normalizedInstruction, normalizedAlias) : null;
      const fuzzy = Boolean(fuzzyPhrase);
      if (!exact && !fuzzy) continue;
      scored.push({
        householdId: candidate.id,
        label: candidate.label,
        matchedAlias: alias.value,
        matchKind: alias.kind,
        fuzzy,
        ...(fuzzyPhrase ? { instructionAlias: fuzzyPhrase } : {}),
        score: alias.weight + (alias.kind === "phone" ? phoneDigits.length : normalizedAlias.length) - (fuzzy ? 500 : 0),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.householdId.localeCompare(b.householdId));
  const best = scored[0];
  if (!best) return null;
  const tiedHousehold = scored.find((row) => row.score === best.score && row.householdId !== best.householdId);
  if (tiedHousehold) return null;
  const { score: _score, ...match } = best;
  return match;
}

export interface Household360 {
  household: { id: string; address: string; contactInfo: Record<string, unknown>; marketingConsent: boolean; createdAt: string };
  contacts: Array<{ id: string; name: string; role: string | null; methods: Array<{ methodType: string; value: string; consent: boolean }> }>;
  equipment: Array<{ id: string; type: string; model: string | null; installDate: string | null; source: string }>;
  leads: Array<{ id: string; name: string; status: string; source: string | null; createdAt: string }>;
  opportunities: Array<{ id: string; pipelineStage: string; expectedValueUsd: number | null; createdAt: string }>;
  quotes: Array<{ id: string; status: string; totalUsd: number | null; createdAt: string }>;
  invoices: Array<{ id: string; status: string; amountUsd: number; memo: string | null; createdAt: string; dueDate: string | null; payments: Array<{ id: string; amountUsd: number; method: string; status: string; receivedAt: string }> }>;
  agreements: Array<{ id: string; cadence: string; status: string; renewalDate: string | null }>;
  proposals: Array<{ id: string; quoteId: string | null; status: string; sentAt: string | null }>;
  workOrders: Array<{ id: string; type: string; status: string; technicianId: string | null; depositAmountUsd: number | null; createdAt: string; scheduledAt: string | null; completedAt: string | null }>;
  serviceVisits: Array<{ id: string; type: string; technicianId: string | null; scheduledAt: string | null; completedAt: string | null; notes: string | null }>;
  appointments: Array<{ id: string; subjectType: string; status: string; scheduledAt: string; durationMinutes: number | null; technicianId: string | null; notes: string | null; createdAt: string }>;
  tasks: Array<{ id: string; subjectType: string; subjectId: string; title: string; status: string; priority: string; dueAt: string | null }>;
  conversations: Array<{ id: string; channel: string; status: string; createdAt: string; lastActivityAt: string; messageCount: number; recentMessages: Array<{ id: string; direction: string; channel: string; content: string; sentAt: string }> }>;
  calls: Array<{ id: string; conversationId: string | null; direction: string; transcript: string | null; startedAt: string | null; endedAt: string | null; endedReason: string | null; raw: Record<string, unknown> }>;
  documents: Array<{ id: string; kind: string; title: string; createdAt: string }>;
  // communications_log (pre-canonical) is linked to a household by nothing but
  // householdId — it is NOT unified with canonical `conversations` (no shared key,
  // no migration path). Surfaced honestly as its own array rather than folded into
  // `conversations`, which would misrepresent two unrelated systems as one.
  legacyCommunications: Array<{ id: string; channel: string; direction: string; content: string; timestamp: string }>;
  works: Array<{
    id: string;
    status: string;
    active: boolean;
    initialInstruction: string;
    createdAt: string;
    updatedAt: string;
    actions: Array<{ id: string; actionType: string; status: string }>;
    operations: Array<{ id: string; operationType: string; status: string; targetCount: number }>;
    receipts: Array<{ id: string; domainActionId: string | null; operationId: string | null; finalizedAt: string | null }>;
  }>;
  operationTargets: Array<{ id: string; operationId: string; status: string }>;
  timeline: Array<{ id: string; entityType: string; entityId: string; eventType: string; occurredAt: string; payload: Record<string, unknown> }>;
  queryMs: number;
}

const toNum = (v: string | null): number | null => (v === null ? null : Number(v));

export async function household360(tenantId: string, householdId: string): Promise<Household360 | null> {
  const start = performance.now();
  const result = await withTenant(tenantId, async (db) => {
    const [hh] = await db
      .select()
      .from(households)
      .where(and(eq(households.id, householdId), eq(households.tenantId, tenantId)));
    if (!hh) return null;

    // One transaction owns one pg client. Promise.all on that client does not make
    // these queries parallel; pg queues them and pg@9 warns that the pattern will be
    // removed. Keep the sequence explicit and deterministic until this traversal is
    // projected into a single materialized read model.
    const contactRows = await db.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.householdId, householdId)));
    const equipmentRows = await db.select().from(equipment).where(and(eq(equipment.tenantId, tenantId), eq(equipment.householdId, householdId)));
    const leadRows = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.householdId, householdId)));
    const opportunityRows = await db.select().from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.householdId, householdId)));
    const quoteRows = await db.select().from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.householdId, householdId)));
    const agreementRows = await db.select().from(maintenanceAgreements).where(and(eq(maintenanceAgreements.tenantId, tenantId), eq(maintenanceAgreements.householdId, householdId)));
    const proposalRows = await db.select().from(proposals).where(and(eq(proposals.tenantId, tenantId), eq(proposals.householdId, householdId)));
    const invoiceRows = await db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.householdId, householdId)));
    const workOrderRows = await db.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.householdId, householdId)));
    const serviceVisitRows = await db.select().from(serviceVisits).where(and(eq(serviceVisits.tenantId, tenantId), eq(serviceVisits.householdId, householdId)));
    const conversationRows = await db.select().from(conversations).where(and(eq(conversations.tenantId, tenantId), eq(conversations.householdId, householdId)));
    const documentRows = await db.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.householdId, householdId)));
    const legacyCommsRows = await db.select().from(communicationsLog).where(and(eq(communicationsLog.tenantId, tenantId), eq(communicationsLog.householdId, householdId)));

    const contactIds = contactRows.map((c) => c.id);
    const invoiceIds = invoiceRows.map((i) => i.id);
    const conversationIds = conversationRows.map((c) => c.id);
    const leadIds = leadRows.map((l) => l.id);
    const workOrderIds = workOrderRows.map((w) => w.id);

    // Stage 2: children-of-children. Appointments are polymorphic (subjectType/
    // subjectId, no householdId) — match direct household holds, plus holds whose
    // subject is one of this household's leads or work orders (the two-stage hop).
    const subjectConditions = [and(eq(appointments.subjectType, "household"), eq(appointments.subjectId, householdId))];
    if (leadIds.length > 0) subjectConditions.push(and(eq(appointments.subjectType, "lead"), inArray(appointments.subjectId, leadIds)));
    if (workOrderIds.length > 0) subjectConditions.push(and(eq(appointments.subjectType, "work_order"), inArray(appointments.subjectId, workOrderIds)));

    const methodRows = contactIds.length > 0 ? await db.select().from(contactMethods).where(inArray(contactMethods.contactId, contactIds)) : [];
    const paymentRows = invoiceIds.length > 0 ? await db.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)) : [];
    const messageRows = conversationIds.length > 0 ? await db.select().from(messages).where(inArray(messages.conversationId, conversationIds)) : [];
    const callRows = conversationIds.length > 0 ? await db.select().from(calls).where(and(eq(calls.tenantId, tenantId), inArray(calls.conversationId, conversationIds))) : [];
    const appointmentRows = await db.select().from(appointments).where(and(eq(appointments.tenantId, tenantId), or(...subjectConditions)));
    const taskRows = await db.select().from(tasks).where(and(eq(tasks.tenantId, tenantId), or(
      and(eq(tasks.subjectType, "household"), eq(tasks.subjectId, householdId)),
      ...(leadIds.length > 0 ? [and(eq(tasks.subjectType, "lead"), inArray(tasks.subjectId, leadIds))] : []),
      ...(workOrderIds.length > 0 ? [and(eq(tasks.subjectType, "work_order"), inArray(tasks.subjectId, workOrderIds))] : []),
      ...(invoiceIds.length > 0 ? [and(eq(tasks.subjectType, "invoice"), inArray(tasks.subjectId, invoiceIds))] : []),
    )));

    const entityRefs: Array<[string, string]> = [
      ["household", householdId],
      ...contactIds.map((id) => ["contact", id] as [string, string]),
      ...equipmentRows.map((row) => ["equipment", row.id] as [string, string]),
      ...serviceVisitRows.map((row) => ["service_visit", row.id] as [string, string]),
      ...agreementRows.map((row) => ["maintenance_agreement", row.id] as [string, string]),
      ...leadIds.map((id) => ["lead", id] as [string, string]),
      ...opportunityRows.map((row) => ["opportunity", row.id] as [string, string]),
      ...quoteRows.map((row) => ["quote", row.id] as [string, string]),
      ...proposalRows.map((row) => ["proposal", row.id] as [string, string]),
      ...invoiceIds.map((id) => ["invoice", id] as [string, string]),
      ...paymentRows.map((row) => ["payment", row.id] as [string, string]),
      ...workOrderIds.map((id) => ["work_order", id] as [string, string]),
      ...serviceVisitRows.map((row) => ["service_visit", row.id] as [string, string]),
      ...appointmentRows.map((row) => ["appointment", row.id] as [string, string]),
      ...taskRows.map((row) => ["task", row.id] as [string, string]),
      ...conversationIds.map((id) => ["conversation", id] as [string, string]),
      ...messageRows.map((row) => ["message", row.id] as [string, string]),
      ...callRows.map((row) => ["call", row.id] as [string, string]),
      ...documentRows.map((row) => ["document", row.id] as [string, string]),
    ];
    const directWorkLinks = await db.select().from(workEntityLinks).where(and(
      eq(workEntityLinks.tenantId, tenantId),
      or(...entityRefs.map(([entityType, entityId]) => and(eq(workEntityLinks.entityType, entityType), eq(workEntityLinks.entityId, entityId)))),
    ));
    const operationTargetRows = await db.select({ id: businessOperationTargets.id, operationId: businessOperationTargets.operationId, status: businessOperationTargets.status })
      .from(businessOperationTargets)
      .where(and(eq(businessOperationTargets.tenantId, tenantId), eq(businessOperationTargets.targetId, householdId)));
    const targetOperationIds = operationTargetRows.map((row) => row.operationId);
    const targetOperationRows = targetOperationIds.length > 0
      ? await db.select().from(businessOperations).where(and(eq(businessOperations.tenantId, tenantId), inArray(businessOperations.id, targetOperationIds)))
      : [];
    const relatedWorkIds = [...new Set([
      ...directWorkLinks.map((row) => row.workId),
      ...targetOperationRows.map((row) => row.workId).filter((id): id is string => Boolean(id)),
    ])];
    const relatedWorkRows = relatedWorkIds.length > 0
      ? await db.select().from(works).where(and(eq(works.tenantId, tenantId), inArray(works.id, relatedWorkIds)))
      : [];
    const relatedActionRows = relatedWorkIds.length > 0
      ? await db.select().from(domainActions).where(and(eq(domainActions.tenantId, tenantId), inArray(domainActions.workId, relatedWorkIds)))
      : [];
    const relatedOperationRows = relatedWorkIds.length > 0
      ? await db.select().from(businessOperations).where(and(eq(businessOperations.tenantId, tenantId), inArray(businessOperations.workId, relatedWorkIds)))
      : [];
    const relatedReceiptRows = relatedWorkIds.length > 0
      ? await db.select().from(decisionReceipts).where(and(eq(decisionReceipts.tenantId, tenantId), inArray(decisionReceipts.workId, relatedWorkIds)))
      : [];

    // Timeline: business_events for the union of every entity collected above,
    // batched per entityType so each batch hits business_events_entity_idx.
    const entityBatches: Array<[string, string[]]> = [
      ["household", [householdId]],
      ["contact", contactIds],
      ["equipment", equipmentRows.map((row) => row.id)],
      ["service_visit", serviceVisitRows.map((row) => row.id)],
      ["maintenance_agreement", agreementRows.map((row) => row.id)],
      ["lead", leadIds],
      ["opportunity", opportunityRows.map((o) => o.id)],
      ["quote", quoteRows.map((q) => q.id)],
      ["invoice", invoiceIds],
      ["payment", paymentRows.map((row) => row.id)],
      ["proposal", proposalRows.map((row) => row.id)],
      ["work_order", workOrderIds],
      ["appointment", appointmentRows.map((a) => a.id)],
      ["task", taskRows.map((row) => row.id)],
      ["conversation", conversationIds],
      ["message", messageRows.map((row) => row.id)],
      ["call", callRows.map((call) => call.id)],
      ["document", documentRows.map((row) => row.id)],
    ].filter(([, ids]) => (ids?.length ?? 0) > 0) as Array<[string, string[]]>;

    const eventBatches = [] as Array<Array<typeof businessEvents.$inferSelect>>;
    for (const [entityType, ids] of entityBatches) {
      eventBatches.push(await db
        .select()
        .from(businessEvents)
        .where(and(eq(businessEvents.tenantId, tenantId), eq(businessEvents.entityType, entityType), inArray(businessEvents.entityId, ids))));
    }
    const timeline = eventBatches
      .flat()
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 100)
      .map((e) => ({
        id: e.id,
        entityType: e.entityType,
        entityId: e.entityId,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
        payload: e.payload as Record<string, unknown>,
      }));

    const methodsByContact = new Map<string, typeof methodRows>();
    for (const m of methodRows) {
      const list = methodsByContact.get(m.contactId) ?? [];
      list.push(m);
      methodsByContact.set(m.contactId, list);
    }
    const paymentsByInvoice = new Map<string, typeof paymentRows>();
    for (const p of paymentRows) {
      const list = paymentsByInvoice.get(p.invoiceId) ?? [];
      list.push(p);
      paymentsByInvoice.set(p.invoiceId, list);
    }
    const messageCountByConversation = new Map<string, number>();
    const messagesByConversation = new Map<string, typeof messageRows>();
    for (const m of messageRows) {
      messageCountByConversation.set(m.conversationId!, (messageCountByConversation.get(m.conversationId!) ?? 0) + 1);
      if (m.conversationId) {
        const list = messagesByConversation.get(m.conversationId) ?? [];
        list.push(m);
        messagesByConversation.set(m.conversationId, list);
      }
    }

    const household360Result: Household360 = {
      household: {
        id: hh.id,
        address: hh.address,
        contactInfo: hh.contactInfo as Record<string, unknown>,
        marketingConsent: hh.marketingConsent,
        createdAt: hh.createdAt.toISOString(),
      },
      contacts: contactRows.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        methods: (methodsByContact.get(c.id) ?? []).map((m) => ({ methodType: m.methodType, value: m.value, consent: m.consent })),
      })),
      equipment: equipmentRows.map((e) => ({
        id: e.id,
        type: e.type,
        model: e.model,
        installDate: e.installDate ? e.installDate.toISOString() : null,
        source: e.source,
      })),
      leads: leadRows.map((l) => ({ id: l.id, name: l.name, status: l.status, source: l.source, createdAt: l.createdAt.toISOString() })),
      opportunities: opportunityRows.map((o) => ({
        id: o.id,
        pipelineStage: o.pipelineStage,
        expectedValueUsd: toNum(o.expectedValueUsd),
        createdAt: o.createdAt.toISOString(),
      })),
      quotes: quoteRows.map((q) => ({ id: q.id, status: q.status, totalUsd: toNum(q.totalUsd), createdAt: q.createdAt.toISOString() })),
      agreements: agreementRows.map((row) => ({ id: row.id, cadence: row.cadence, status: row.status, renewalDate: row.renewalDate?.toISOString() ?? null })),
      proposals: proposalRows.map((row) => ({ id: row.id, quoteId: row.quoteId, status: row.status, sentAt: row.sentAt?.toISOString() ?? null })),
      invoices: invoiceRows.map((i) => ({
        id: i.id,
        status: i.status,
        amountUsd: Number(i.amountUsd),
        memo: i.memo,
        createdAt: i.createdAt.toISOString(),
        dueDate: i.dueDate ? i.dueDate.toISOString() : null,
        payments: (paymentsByInvoice.get(i.id) ?? []).map((p) => ({
          id: p.id,
          amountUsd: Number(p.amountUsd),
          method: p.method,
          status: p.status,
          receivedAt: p.receivedAt.toISOString(),
        })),
      })),
      workOrders: workOrderRows.map((w) => ({
        id: w.id,
        type: w.type,
        status: w.status,
        technicianId: w.technicianId,
        depositAmountUsd: toNum(w.depositAmountUsd),
        createdAt: w.createdAt.toISOString(),
        scheduledAt: w.scheduledAt ? w.scheduledAt.toISOString() : null,
        completedAt: w.completedAt ? w.completedAt.toISOString() : null,
      })),
      serviceVisits: serviceVisitRows.map((v) => ({
        id: v.id,
        type: v.type,
        technicianId: v.technicianId,
        scheduledAt: v.scheduledAt ? v.scheduledAt.toISOString() : null,
        completedAt: v.completedAt ? v.completedAt.toISOString() : null,
        notes: v.notes,
      })),
      appointments: appointmentRows.map((a) => ({
        id: a.id,
        subjectType: a.subjectType,
        status: a.status,
        scheduledAt: a.scheduledAt.toISOString(),
        durationMinutes: a.durationMinutes,
        technicianId: a.technicianId,
        notes: a.notes,
        createdAt: a.createdAt.toISOString(),
      })),
      tasks: taskRows.map((row) => ({ id: row.id, subjectType: row.subjectType, subjectId: row.subjectId, title: row.title, status: row.status, priority: row.priority, dueAt: row.dueAt?.toISOString() ?? null })),
      conversations: conversationRows.map((c) => ({
        id: c.id,
        channel: c.channel,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        lastActivityAt: c.lastActivityAt.toISOString(),
        messageCount: messageCountByConversation.get(c.id) ?? 0,
        recentMessages: (messagesByConversation.get(c.id) ?? [])
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
          .slice(0, 20)
          .map((message) => ({ id: message.id, direction: message.direction, channel: message.channel, content: message.content, sentAt: message.sentAt.toISOString() })),
      })),
      calls: callRows
        .sort((a, b) => (b.startedAt?.getTime() ?? b.createdAt.getTime()) - (a.startedAt?.getTime() ?? a.createdAt.getTime()))
        .slice(0, 50)
        .map((call) => ({
          id: call.id,
          conversationId: call.conversationId,
          direction: call.direction,
          transcript: call.transcript,
          startedAt: call.startedAt?.toISOString() ?? null,
          endedAt: call.endedAt?.toISOString() ?? null,
          endedReason: call.endedReason,
          raw: call.raw as Record<string, unknown>,
        })),
      documents: documentRows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, createdAt: d.createdAt.toISOString() })),
      legacyCommunications: legacyCommsRows.map((c) => ({
        id: c.id,
        channel: c.channel,
        direction: c.direction,
        content: c.content,
        timestamp: c.timestamp.toISOString(),
      })),
      works: relatedWorkRows.map((work) => ({
        id: work.id,
        status: work.status,
        active: !["completed", "failed"].includes(work.status),
        initialInstruction: work.initialInstruction,
        createdAt: work.createdAt.toISOString(),
        updatedAt: work.updatedAt.toISOString(),
        actions: relatedActionRows.filter((row) => row.workId === work.id).map((row) => ({ id: row.id, actionType: row.actionType, status: row.status })),
        operations: relatedOperationRows.filter((row) => row.workId === work.id).map((row) => ({ id: row.id, operationType: row.operationType, status: row.status, targetCount: row.targetCount })),
        receipts: relatedReceiptRows.filter((row) => row.workId === work.id).map((row) => ({ id: row.id, domainActionId: row.domainActionId, operationId: row.operationId, finalizedAt: row.finalizedAt?.toISOString() ?? null })),
      })),
      operationTargets: operationTargetRows,
      timeline,
      queryMs: 0, // set below, outside withTenant, so it reflects the whole call
    };
    return household360Result;
  });

  if (result === null) return null;
  const queryMs = performance.now() - start;
  if (queryMs > 500) {
    // eslint-disable-next-line no-console
    console.warn(`[household360] slow traversal for tenant ${tenantId}, household ${householdId}: ${queryMs.toFixed(1)}ms`);
  }
  return { ...result, queryMs };
}

const COMPANY_CONTEXT_NODE_CAP = 250;

/** Resolve any supported row back to its unique customer scope using typed edges.
 * A multi-customer Work/operation is intentionally ambiguous instead of silently
 * selecting one campaign target. */
export async function resolveCanonicalHousehold(
  tenantId: string,
  anchor: CanonicalEntityRef,
): Promise<string | null> {
  const rows = await withTenant(tenantId, async (db) => {
    const result = await db.execute<{ household_id: string }>(sql`
      WITH RECURSIVE path(entity_type, entity_id, depth, visited) AS (
        SELECT ${anchor.entityType}::text, ${anchor.entityId}::uuid, 0,
               ARRAY[${anchor.entityType}::text || ':' || ${anchor.entityId}::text]
        UNION ALL
        SELECT edge.to_entity_type,
               edge.to_entity_id,
               p.depth + 1,
               p.visited || (edge.to_entity_type || ':' || edge.to_entity_id::text)
        FROM path p
        JOIN finnor_os.company_graph_edges edge
          ON edge.tenant_id=${tenantId}::uuid
         AND edge.from_entity_type=p.entity_type AND edge.from_entity_id=p.entity_id
        WHERE p.depth < 8
          AND edge.relationship IN ('member_of','installed_at','service_for','covers','for_customer','from_lead','for_lead','for_opportunity','proposed_to','from_quote','scheduled_for','billed_to','pays','with_customer','with_contact','part_of','about_customer','about','target','targets','authorized_by','receipts','executes','records')
          AND NOT (edge.to_entity_type || ':' || edge.to_entity_id::text = ANY(p.visited))
      )
      SELECT DISTINCT entity_id::text AS household_id
      FROM path WHERE entity_type='household' LIMIT 2
    `);
    return result.rows;
  });
  if (rows.length > 1) throw new Error("Canonical entity belongs to more than one customer context");
  return rows[0]?.household_id ?? null;
}

function householdDisplayName(contactInfo: Record<string, unknown>): string | null {
  return typeof contactInfo.name === "string" && contactInfo.name.trim() ? contactInfo.name.trim() : null;
}

function canonicalContextAnchor(anchor: CompanyContextAnchor): CanonicalEntityRef {
  return "partyType" in anchor ? partyRefToCanonicalEntityRef(anchor) : anchor;
}

/** Company-only graph projection for canonical parties that do not belong to a
 * household. The database view exposes bounded labels/status only; private contact
 * fields and profile/auth material never enter CompanyContext. */
async function companyWorldContext(
  tenantId: string,
  anchor: CompanyContextAnchor,
  canonicalAnchor: CanonicalEntityRef,
): Promise<CompanyContext | null> {
  const rows = await withTenant(tenantId, async (db) => {
    const result = await db.execute<{
      entity_type: CanonicalEntityRef["entityType"];
      entity_id: string;
      depth: number | string;
      label: string | null;
      status: string | null;
      occurred_at: Date | string | null;
      source_table: string;
    }>(sql`
      WITH RECURSIVE reached(entity_type, entity_id, depth) AS (
        SELECT ${canonicalAnchor.entityType}::text, ${canonicalAnchor.entityId}::uuid, 0
        WHERE finnor_os.canonical_entity_tenant(${canonicalAnchor.entityType}, ${canonicalAnchor.entityId}::uuid)=${tenantId}::uuid
        UNION
        SELECT CASE WHEN edge.from_entity_type=r.entity_type AND edge.from_entity_id=r.entity_id
                    THEN edge.to_entity_type ELSE edge.from_entity_type END,
               CASE WHEN edge.from_entity_type=r.entity_type AND edge.from_entity_id=r.entity_id
                    THEN edge.to_entity_id ELSE edge.from_entity_id END,
               r.depth + 1
        FROM reached r
        JOIN finnor_os.company_graph_edges edge
          ON edge.tenant_id=${tenantId}::uuid
         AND ((edge.from_entity_type=r.entity_type AND edge.from_entity_id=r.entity_id)
           OR (edge.to_entity_type=r.entity_type AND edge.to_entity_id=r.entity_id))
        WHERE r.depth < 3
      ), nearest AS (
        SELECT entity_type, entity_id, min(depth)::int AS depth
        FROM reached GROUP BY entity_type, entity_id
      )
      SELECT n.entity_type, n.entity_id, nearest.depth, n.label, n.status,
             n.occurred_at, n.source_table
      FROM nearest
      JOIN finnor_os.company_graph_nodes n
        ON n.tenant_id=${tenantId}::uuid
       AND n.entity_type=nearest.entity_type AND n.entity_id=nearest.entity_id
      ORDER BY nearest.depth, n.entity_type, n.entity_id
      LIMIT ${COMPANY_CONTEXT_NODE_CAP + 1}
    `);
    return result.rows;
  });
  if (rows.length === 0) return null;

  const truncatedNodes = rows.length > COMPANY_CONTEXT_NODE_CAP;
  const selected = rows.slice(0, COMPANY_CONTEXT_NODE_CAP);
  const nodes: CanonicalEntityNode[] = selected.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    label: row.label,
    status: row.status,
    occurredAt: row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : row.occurred_at
        ? new Date(row.occurred_at).toISOString()
        : null,
  }));
  const wanted = new Set(nodes.map((node) => `${node.entityType}:${node.entityId}`));
  const relationships = await withTenant(tenantId, async (db) => {
    if (nodes.length === 0) return [] as CanonicalRelationship[];
    const wantedValues = sql.join(nodes.map((node) => sql`(${node.entityType}::text, ${node.entityId}::uuid)`), sql`, `);
    const result = await db.execute<{
      from_entity_type: CanonicalEntityRef["entityType"];
      from_entity_id: string;
      relationship: string;
      to_entity_type: CanonicalEntityRef["entityType"];
      to_entity_id: string;
      source_table: string;
      source_column: string;
    }>(sql`
      WITH wanted(entity_type, entity_id) AS (VALUES ${wantedValues})
      SELECT edge.from_entity_type, edge.from_entity_id, edge.relationship,
             edge.to_entity_type, edge.to_entity_id, edge.source_table, edge.source_column
      FROM finnor_os.company_graph_edges edge
      JOIN wanted from_ref ON from_ref.entity_type=edge.from_entity_type AND from_ref.entity_id=edge.from_entity_id
      JOIN wanted to_ref ON to_ref.entity_type=edge.to_entity_type AND to_ref.entity_id=edge.to_entity_id
      WHERE edge.tenant_id=${tenantId}::uuid
      ORDER BY edge.source_table, edge.from_entity_id, edge.to_entity_id
      LIMIT 500
    `);
    return result.rows.map((row) => ({
      from: { entityType: row.from_entity_type, entityId: row.from_entity_id },
      relationship: row.relationship,
      to: { entityType: row.to_entity_type, entityId: row.to_entity_id },
      source: { table: row.source_table, column: row.source_column },
    })).filter((edge) => wanted.has(`${edge.from.entityType}:${edge.from.entityId}`)
      && wanted.has(`${edge.to.entityType}:${edge.to.entityId}`));
  });
  const sourceTables = [...new Set([
    ...selected.map((row) => row.source_table),
    ...relationships.map((edge) => edge.source.table),
  ])].sort();
  return {
    anchor,
    household: null,
    nodes,
    relationships,
    truncated: truncatedNodes || relationships.length >= 500,
    source: { kind: "canonical_postgres", tables: sourceTables },
    asOf: new Date().toISOString(),
  };
}

/** The reusable read contract consumed by query/runtime/workspace layers. It is a
 * bounded projection of canonical rows plus exact FK provenance, not a second data
 * store. */
export async function companyContext(
  tenantId: string,
  anchor: CompanyContextAnchor,
): Promise<CompanyContext | null> {
  const canonicalAnchor = canonicalContextAnchor(anchor);
  if (["user", "org_unit", "tenant_location", "external_organization", "external_contact"].includes(canonicalAnchor.entityType)) {
    return companyWorldContext(tenantId, anchor, canonicalAnchor);
  }
  const householdId = await resolveCanonicalHousehold(tenantId, canonicalAnchor);
  if (!householdId) return companyWorldContext(tenantId, anchor, canonicalAnchor);
  const snapshot = await household360(tenantId, householdId);
  if (!snapshot) return null;

  const nodeMap = new Map<string, CanonicalEntityNode>();
  const add = (node: CanonicalEntityNode) => nodeMap.set(`${node.entityType}:${node.entityId}`, node);
  add({ entityType: "household", entityId: householdId, label: householdDisplayName(snapshot.household.contactInfo) ?? snapshot.household.address, status: null, occurredAt: snapshot.household.createdAt });
  snapshot.contacts.forEach((row) => add({ entityType: "contact", entityId: row.id, label: row.name, status: null, occurredAt: null }));
  snapshot.equipment.forEach((row) => add({ entityType: "equipment", entityId: row.id, label: [row.type, row.model].filter(Boolean).join(" "), status: row.source, occurredAt: row.installDate }));
  snapshot.serviceVisits.forEach((row) => {
    add({ entityType: "service_visit", entityId: row.id, label: row.type, status: row.completedAt ? "completed" : "scheduled", occurredAt: row.completedAt ?? row.scheduledAt });
    if (row.technicianId) add({ entityType: "technician", entityId: row.technicianId, label: null, status: null, occurredAt: null });
  });
  snapshot.agreements.forEach((row) => add({ entityType: "maintenance_agreement", entityId: row.id, label: row.cadence, status: row.status, occurredAt: row.renewalDate }));
  snapshot.leads.forEach((row) => add({ entityType: "lead", entityId: row.id, label: row.name, status: row.status, occurredAt: row.createdAt }));
  snapshot.opportunities.forEach((row) => add({ entityType: "opportunity", entityId: row.id, label: row.expectedValueUsd === null ? null : `$${row.expectedValueUsd}`, status: row.pipelineStage, occurredAt: row.createdAt }));
  snapshot.quotes.forEach((row) => add({ entityType: "quote", entityId: row.id, label: row.totalUsd === null ? null : `$${row.totalUsd}`, status: row.status, occurredAt: row.createdAt }));
  snapshot.proposals.forEach((row) => add({ entityType: "proposal", entityId: row.id, label: null, status: row.status, occurredAt: row.sentAt }));
  snapshot.invoices.forEach((row) => {
    add({ entityType: "invoice", entityId: row.id, label: `$${row.amountUsd}`, status: row.status, occurredAt: row.createdAt });
    row.payments.forEach((payment) => add({ entityType: "payment", entityId: payment.id, label: `$${payment.amountUsd}`, status: payment.status, occurredAt: payment.receivedAt }));
  });
  snapshot.workOrders.forEach((row) => {
    add({ entityType: "work_order", entityId: row.id, label: row.type, status: row.status, occurredAt: row.completedAt ?? row.scheduledAt ?? row.createdAt });
    if (row.technicianId) add({ entityType: "technician", entityId: row.technicianId, label: null, status: null, occurredAt: null });
  });
  snapshot.appointments.forEach((row) => {
    add({ entityType: "appointment", entityId: row.id, label: row.subjectType, status: row.status, occurredAt: row.scheduledAt });
    if (row.technicianId) add({ entityType: "technician", entityId: row.technicianId, label: null, status: null, occurredAt: null });
  });
  snapshot.tasks.forEach((row) => add({ entityType: "task", entityId: row.id, label: row.title, status: row.status, occurredAt: row.dueAt }));
  snapshot.conversations.forEach((row) => {
    add({ entityType: "conversation", entityId: row.id, label: row.channel, status: row.status, occurredAt: row.lastActivityAt });
    row.recentMessages.forEach((message) => add({ entityType: "message", entityId: message.id, label: message.content.slice(0, 240), status: message.direction, occurredAt: message.sentAt }));
  });
  snapshot.calls.forEach((row) => add({ entityType: "call", entityId: row.id, label: row.direction, status: row.endedReason, occurredAt: row.startedAt }));
  snapshot.legacyCommunications.forEach((row) => add({ entityType: "communication", entityId: row.id, label: row.content.slice(0, 240), status: row.direction, occurredAt: row.timestamp }));
  snapshot.documents.forEach((row) => add({ entityType: "document", entityId: row.id, label: row.title, status: row.kind, occurredAt: row.createdAt }));
  snapshot.works.forEach((work) => {
    add({ entityType: "work", entityId: work.id, label: work.initialInstruction, status: work.status, occurredAt: work.updatedAt });
    work.actions.forEach((row) => add({ entityType: "domain_action", entityId: row.id, label: row.actionType, status: row.status, occurredAt: null }));
    work.operations.forEach((row) => add({ entityType: "business_operation", entityId: row.id, label: row.operationType, status: row.status, occurredAt: null }));
    work.receipts.forEach((row) => add({ entityType: "decision_receipt", entityId: row.id, label: null, status: row.finalizedAt ? "finalized" : "pending", occurredAt: row.finalizedAt }));
  });
  snapshot.operationTargets.forEach((row) => add({ entityType: "business_operation_target", entityId: row.id, label: null, status: row.status, occurredAt: null }));
  snapshot.timeline.forEach((row) => add({ entityType: "business_event", entityId: row.id, label: row.eventType, status: null, occurredAt: row.occurredAt }));

  const allNodes = [...nodeMap.values()];
  const nodes = allNodes.slice(0, COMPANY_CONTEXT_NODE_CAP);
  const wanted = new Set(nodes.map((node) => `${node.entityType}:${node.entityId}`));
  const relationships = await withTenant(tenantId, async (db) => {
    if (nodes.length === 0) return [] as CanonicalRelationship[];
    const wantedValues = sql.join(nodes.map((node) => sql`(${node.entityType}::text, ${node.entityId}::uuid)`), sql`, `);
    const result = await db.execute<{
      from_entity_type: CanonicalEntityRef["entityType"];
      from_entity_id: string;
      relationship: string;
      to_entity_type: CanonicalEntityRef["entityType"];
      to_entity_id: string;
      source_table: string;
      source_column: string;
    }>(sql`
      WITH wanted(entity_type, entity_id) AS (VALUES ${wantedValues})
      SELECT edge.from_entity_type, edge.from_entity_id, edge.relationship,
             edge.to_entity_type, edge.to_entity_id, edge.source_table, edge.source_column
      FROM finnor_os.company_graph_edges edge
      JOIN wanted from_ref ON from_ref.entity_type=edge.from_entity_type AND from_ref.entity_id=edge.from_entity_id
      JOIN wanted to_ref ON to_ref.entity_type=edge.to_entity_type AND to_ref.entity_id=edge.to_entity_id
      WHERE edge.tenant_id=${tenantId}::uuid
      ORDER BY edge.source_table, edge.from_entity_id, edge.to_entity_id
      LIMIT 500
    `);
    return result.rows.map((row) => ({
      from: { entityType: row.from_entity_type, entityId: row.from_entity_id },
      relationship: row.relationship,
      to: { entityType: row.to_entity_type, entityId: row.to_entity_id },
      source: { table: row.source_table, column: row.source_column },
    })).filter((edge) => wanted.has(`${edge.from.entityType}:${edge.from.entityId}`) && wanted.has(`${edge.to.entityType}:${edge.to.entityId}`));
  });
  const sourceTables = [...new Set(["households", "communications_log", ...relationships.map((edge) => edge.source.table)])].sort();
  return {
    anchor,
    household: { id: snapshot.household.id, displayName: householdDisplayName(snapshot.household.contactInfo), address: snapshot.household.address },
    nodes,
    relationships,
    truncated: allNodes.length > nodes.length || relationships.length >= 500,
    source: { kind: "canonical_postgres", tables: sourceTables },
    asOf: new Date().toISOString(),
  };
}

const BUSINESS_WORLD_OBJECT_CAP = 200;
const BUSINESS_WORLD_RELATIONSHIP_CAP = 500;
const BUSINESS_SCENE_TYPES: Record<BusinessScene, CanonicalEntityRef["entityType"][]> = {
  customer: ["household", "contact", "equipment", "service_visit", "maintenance_agreement", "lead", "opportunity", "quote", "proposal", "work_order", "appointment", "invoice", "payment", "conversation", "call", "message", "communication", "document", "task", "work", "decision_receipt"],
  schedule: ["service_visit", "appointment", "internal_event", "technician", "household", "work_order", "task", "work", "delegation", "acknowledgement_request"],
  money: ["quote", "proposal", "invoice", "payment", "household", "work", "domain_action", "decision_receipt", "business_operation"],
  work: ["work", "task", "domain_action", "workflow_run", "workflow_step", "business_operation", "business_operation_target", "decision_receipt", "delegation", "acknowledgement_request", "communication_delivery", "internal_event", "document_share", "computer_run"],
  inventory: ["inventory_item", "work", "task", "service_visit", "work_order", "domain_action", "decision_receipt"],
  computer: ["computer_run", "work", "domain_action", "decision_receipt", "document", "communication_delivery"],
};

interface BusinessWorldNodeRow extends Record<string, unknown> {
  entity_type: CanonicalEntityRef["entityType"];
  entity_id: string;
  label: string | null;
  status: string | null;
  occurred_at: Date | string | null;
  source_table: string;
}

/** One bounded projection contract for all six scenes. It is assembled at read time
 * from the existing Company Graph plus Phase 2/3 canonical tables that predate this
 * contract. It neither persists nor infers business facts. */
export async function businessWorld(
  tenantId: string,
  scene: BusinessScene,
): Promise<BusinessWorldProjection> {
  const types = BUSINESS_SCENE_TYPES[scene];
  const typeValues = sql.join(types.map((type) => sql`${type}`), sql`, `);
  const selected = await withTenant(tenantId, async (db) => {
    const result = await db.execute<BusinessWorldNodeRow>(sql`
      WITH all_nodes AS (
        SELECT tenant_id,entity_type,entity_id,label,status,occurred_at,source_table
          FROM finnor_os.company_graph_nodes
        UNION ALL SELECT tenant_id,'delegation',id,'Delegation',status,updated_at,'delegations' FROM finnor_os.delegations
        UNION ALL SELECT tenant_id,'acknowledgement_request',id,'Acknowledgement request',status,updated_at,'acknowledgement_requests' FROM finnor_os.acknowledgement_requests
        UNION ALL SELECT tenant_id,'communication_delivery',id,'Communication delivery',status,updated_at,'communication_deliveries' FROM finnor_os.communication_deliveries
        UNION ALL SELECT tenant_id,'internal_event',id,title,status,starts_at,'internal_events' FROM finnor_os.internal_events
        UNION ALL SELECT tenant_id,'document_share',id,'Document share',status,updated_at,'document_shares' FROM finnor_os.document_shares
        UNION ALL SELECT tenant_id,'inventory_item',id,name,
          CASE WHEN quantity<=reorder_threshold THEN 'low_stock' ELSE 'in_stock' END,NULL::timestamptz,'inventory_items'
          FROM finnor_os.inventory_items
        UNION ALL SELECT tenant_id,'computer_run',id,'Computer run · '||application,status,updated_at,'computer_runs'
          FROM finnor_os.computer_runs
      )
      SELECT entity_type,entity_id,label,status,occurred_at,source_table
      FROM all_nodes WHERE tenant_id=${tenantId}::uuid AND entity_type IN (${typeValues})
      ORDER BY occurred_at DESC NULLS LAST,entity_type,entity_id
      LIMIT ${BUSINESS_WORLD_OBJECT_CAP + 1}
    `);
    return result.rows;
  });
  const truncatedObjects = selected.length > BUSINESS_WORLD_OBJECT_CAP;
  const nodeRows = selected.slice(0, BUSINESS_WORLD_OBJECT_CAP);
  const wantedValues = nodeRows.length > 0
    ? sql.join(nodeRows.map((row) => sql`(${row.entity_type}::text,${row.entity_id}::uuid)`), sql`, `)
    : null;
  const relationships = wantedValues ? await withTenant(tenantId, async (db) => {
    const result = await db.execute<{
      from_entity_type: CanonicalEntityRef["entityType"];
      from_entity_id: string;
      relationship: string;
      to_entity_type: CanonicalEntityRef["entityType"];
      to_entity_id: string;
      source_table: string;
      source_column: string;
    }>(sql`
      WITH wanted(entity_type,entity_id) AS (VALUES ${wantedValues}), all_edges AS (
        SELECT tenant_id,from_entity_type,from_entity_id,relationship,to_entity_type,to_entity_id,source_table,source_column
          FROM finnor_os.company_graph_edges
        UNION ALL SELECT tenant_id,'delegation',id,'part_of','work',work_id,'delegations','work_id' FROM finnor_os.delegations WHERE work_id IS NOT NULL
        UNION ALL SELECT tenant_id,'delegation',id,'authorized_by','domain_action',domain_action_id,'delegations','domain_action_id' FROM finnor_os.delegations
        UNION ALL SELECT tenant_id,'acknowledgement_request',id,'part_of','work',work_id,'acknowledgement_requests','work_id' FROM finnor_os.acknowledgement_requests WHERE work_id IS NOT NULL
        UNION ALL SELECT tenant_id,'communication_delivery',id,'part_of','work',work_id,'communication_deliveries','work_id' FROM finnor_os.communication_deliveries WHERE work_id IS NOT NULL
        UNION ALL SELECT tenant_id,'internal_event',id,'part_of','work',work_id,'internal_events','work_id' FROM finnor_os.internal_events WHERE work_id IS NOT NULL
        UNION ALL SELECT tenant_id,'document_share',id,'shares','document',document_id,'document_shares','document_id' FROM finnor_os.document_shares
        UNION ALL SELECT tenant_id,'computer_run',id,'part_of','work',work_id,'computer_runs','work_id' FROM finnor_os.computer_runs WHERE work_id IS NOT NULL
        UNION ALL SELECT tenant_id,'computer_run',id,'executes','domain_action',domain_action_id,'computer_runs','domain_action_id' FROM finnor_os.computer_runs
      )
      SELECT edge.from_entity_type,edge.from_entity_id,edge.relationship,edge.to_entity_type,edge.to_entity_id,edge.source_table,edge.source_column
      FROM all_edges edge
      JOIN wanted f ON f.entity_type=edge.from_entity_type AND f.entity_id=edge.from_entity_id
      JOIN wanted t ON t.entity_type=edge.to_entity_type AND t.entity_id=edge.to_entity_id
      WHERE edge.tenant_id=${tenantId}::uuid
      ORDER BY edge.source_table,edge.from_entity_id,edge.to_entity_id
      LIMIT ${BUSINESS_WORLD_RELATIONSHIP_CAP + 1}
    `);
    return result.rows.slice(0, BUSINESS_WORLD_RELATIONSHIP_CAP).map((row) => ({
      from: { entityType: row.from_entity_type, entityId: row.from_entity_id },
      relationship: row.relationship,
      to: { entityType: row.to_entity_type, entityId: row.to_entity_id },
      source: { table: row.source_table, column: row.source_column },
    }));
  }) : [];
  const workByObject = new Map<string, CanonicalEntityRef[]>();
  for (const edge of relationships) {
    if (edge.from.entityType === "work") {
      const key = `${edge.to.entityType}:${edge.to.entityId}`;
      workByObject.set(key, [...(workByObject.get(key) ?? []), edge.from]);
    }
    if (edge.to.entityType === "work") {
      const key = `${edge.from.entityType}:${edge.from.entityId}`;
      workByObject.set(key, [...(workByObject.get(key) ?? []), edge.to]);
    }
  }
  const objects: BusinessWorldObject[] = nodeRows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    label: row.label,
    status: row.status,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
    provenance: { kind: "canonical_postgres", table: row.source_table },
    relatedWork: row.entity_type === "work" ? [{ entityType: "work", entityId: row.entity_id }] : workByObject.get(`${row.entity_type}:${row.entity_id}`) ?? [],
    interactionEligible: true,
  }));
  const sourceTables = [...new Set([...objects.map((row) => row.provenance.table), ...relationships.map((edge) => edge.source.table)])].sort();
  return {
    version: 1,
    scene,
    objects,
    relationships,
    truncated: truncatedObjects || relationships.length >= BUSINESS_WORLD_RELATIONSHIP_CAP,
    limits: { objects: BUSINESS_WORLD_OBJECT_CAP, relationships: BUSINESS_WORLD_RELATIONSHIP_CAP },
    source: { kind: "canonical_postgres", tables: sourceTables },
    asOf: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reliability (Phase 6, JARVIS 95% MAESTRO PACK §6.6): per-tenant operational
// health, grounded entirely in tables the durable runtime (Phase 2) and receipt
// pipeline already write for real — no metric here is invented or sampled.
// windowDays scopes the THROUGHPUT metrics (success rate, latency, retry rate,
// human-intervention rate, receipt completeness) to recent activity; the two
// backlog gauges (reconciliationBacklog, dlqDepth) are deliberately NOT windowed
// — a backlog is a current-state count, not a rate, and windowing it would hide
// an old unresolved case sitting past the window boundary.
// ---------------------------------------------------------------------------

export interface ReliabilityMetrics {
  tenantId: string;
  windowDays: number;
  workflowSuccessRate: number | null;
  stepLatencyMs: { p50: number | null; p95: number | null; sampleSize: number };
  retryRate: number | null;
  humanInterventionRate: number | null;
  reconciliationBacklog: number;
  dlqDepth: number;
  receiptCompleteness: number | null;
  predictionAccuracy: Array<{ actionType: string; comparedFields: number; matchedFields: number; accuracy: number | null }>;
  asOf: string;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export async function reliability(tenantId: string, windowDays = 1): Promise<ReliabilityMetrics> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  return withTenant(tenantId, async (db) => {
    const runRows = await db
      .select({ status: workflowRuns.status, count: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(and(eq(workflowRuns.tenantId, tenantId), gte(workflowRuns.createdAt, cutoff)))
      .groupBy(workflowRuns.status);
    const byStatus = Object.fromEntries(runRows.map((r) => [r.status, r.count]));
    // "Terminal" excludes still-running/paused/escalated runs — those haven't
    // resolved yet, so counting them as failures (or successes) would be a guess.
    const terminal = (byStatus.completed ?? 0) + (byStatus.failed ?? 0) + (byStatus.compensated ?? 0) + (byStatus.cancelled ?? 0);
    const workflowSuccessRate = terminal > 0 ? (byStatus.completed ?? 0) / terminal : null;

    const completedSteps = await db
      .select({ createdAt: workflowSteps.createdAt, updatedAt: workflowSteps.updatedAt })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.status, "completed"), gte(workflowSteps.createdAt, cutoff)));
    // Proxy for step latency: createdAt (queued) -> updatedAt (last write, which for a
    // completed step is its completion). Not a dedicated "started executing" timestamp
    // (none exists on this table) — stated honestly rather than fabricating one.
    const latencies = completedSteps.map((s) => s.updatedAt.getTime() - s.createdAt.getTime()).sort((a, b) => a - b);

    const [retryRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        retried: sql<number>`count(*) filter (where ${workflowSteps.attempts} > 1)::int`,
      })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.tenantId, tenantId), inArray(workflowSteps.status, ["completed", "failed"]), gte(workflowSteps.createdAt, cutoff)));
    const retryRate = retryRow!.total > 0 ? retryRow!.retried / retryRow!.total : null;

    const [humanRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        needsHuman: sql<number>`count(*) filter (where ${domainActions.status} = 'needs_human_review')::int`,
      })
      .from(domainActions)
      .where(and(eq(domainActions.tenantId, tenantId), gte(domainActions.createdAt, cutoff)));
    const humanInterventionRate = humanRow!.total > 0 ? humanRow!.needsHuman / humanRow!.total : null;

    const [reconRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reconciliationCases)
      .where(and(eq(reconciliationCases.tenantId, tenantId), eq(reconciliationCases.status, "open")));

    const [dlqRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deadLetters)
      .where(and(eq(deadLetters.tenantId, tenantId), eq(deadLetters.status, "open")));

    const [receiptRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        finalized: sql<number>`count(*) filter (where ${decisionReceipts.finalizedAt} is not null)::int`,
      })
      .from(decisionReceipts)
      .where(and(eq(decisionReceipts.tenantId, tenantId), gte(decisionReceipts.createdAt, cutoff)));
    const receiptCompleteness = receiptRow!.total > 0 ? receiptRow!.finalized / receiptRow!.total : null;

    // B2.T3: only explicitly comparable simulation fields contribute. Schema-only
    // predictions and actions that have not executed yet are excluded, rather than
    // being silently counted as correct or incorrect.
    const predictionRows = await db
      .select({ actionType: domainActions.actionType, diff: domainActions.predictionDiff })
      .from(domainActions)
      .where(and(eq(domainActions.tenantId, tenantId), isNotNull(domainActions.predictionDiff), gte(domainActions.createdAt, cutoff)));
    const byActionType = new Map<string, { comparedFields: number; matchedFields: number }>();
    for (const row of predictionRows) {
      const diff = row.diff as { compared?: number; matched?: number };
      if (!diff.compared) continue;
      const current = byActionType.get(row.actionType) ?? { comparedFields: 0, matchedFields: 0 };
      current.comparedFields += diff.compared;
      current.matchedFields += diff.matched ?? 0;
      byActionType.set(row.actionType, current);
    }
    const predictionAccuracy = [...byActionType.entries()].map(([actionType, metrics]) => ({
      actionType,
      ...metrics,
      accuracy: metrics.matchedFields / metrics.comparedFields,
    }));

    return {
      tenantId,
      windowDays,
      workflowSuccessRate,
      stepLatencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), sampleSize: latencies.length },
      retryRate,
      humanInterventionRate,
      reconciliationBacklog: reconRow!.count,
      dlqDepth: dlqRow!.count,
      receiptCompleteness,
      predictionAccuracy,
      asOf: new Date().toISOString(),
    };
  });
}

export interface ActivitySnapshotItem {
  source: "action_log" | "workflow_step" | "computer_step" | "call";
  id: string;
  occurredAt: string;
  detail: Record<string, unknown>;
}

export interface ActivitySnapshot {
  items: ActivitySnapshotItem[];
  asOf: string;
}

// B1.T3: a fast "what just happened" snapshot — the most recent `limit` items across
// the same 4 sources GET /api/activity (A2.T6) merges, but a plain snapshot (no cursor
// paging). Does NOT replace /api/activity — that route's forward-cursor semantics are
// what D1.T3's live Activity Theater actually polls for new items; this is what a CQRS
// projection wants to cache for a fast first paint (packages/projections).
export async function activitySnapshot(tenantId: string, limit = 50): Promise<ActivitySnapshot> {
  return withTenant(tenantId, async (db) => {
    const actionLogRows = await db.select().from(actionLog).where(eq(actionLog.tenantId, tenantId)).orderBy(desc(actionLog.timestamp)).limit(limit);
    const stepRows = await db.select().from(workflowSteps).where(eq(workflowSteps.tenantId, tenantId)).orderBy(desc(workflowSteps.updatedAt)).limit(limit);
    const computerStepRows = await db.select().from(computerSteps).where(eq(computerSteps.tenantId, tenantId)).orderBy(desc(computerSteps.createdAt)).limit(limit);
    const callRows = await db.select().from(calls).where(eq(calls.tenantId, tenantId)).orderBy(desc(calls.createdAt)).limit(limit);
    const items: ActivitySnapshotItem[] = [
      ...actionLogRows.map((r) => ({
        source: "action_log" as const,
        id: r.id,
        occurredAt: r.timestamp.toISOString(),
        detail: { domainActionId: r.domainActionId, step: r.step, output: r.output },
      })),
      ...stepRows.map((r) => ({
        source: "workflow_step" as const,
        id: r.id,
        occurredAt: r.updatedAt.toISOString(),
        detail: { workflowRunId: r.workflowRunId, stepType: r.stepType, status: r.status, terminalReason: r.terminalReason },
      })),
      ...computerStepRows.map((r) => ({
        source: "computer_step" as const,
        id: r.id,
        occurredAt: r.createdAt.toISOString(),
        detail: { runId: r.runId, seq: r.seq, phase: r.phase, operation: r.operation, status: r.status, summary: r.summary, pageUrl: r.pageUrl, detail: r.detail },
      })),
      ...callRows.map((r) => ({
        source: "call" as const,
        id: r.id,
        occurredAt: r.createdAt.toISOString(),
        detail: { direction: r.direction, endedReason: r.endedReason, fromNumber: r.fromNumber, toNumber: r.toNumber },
      })),
    ]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
    return { items, asOf: new Date().toISOString() };
  });
}

// Phase 8 (§8.3): the daily scorecard trend the cockpit renders. Reads back exactly
// what apps/worker/src/handlers/daily-scorecard.ts wrote — this function never
// recomputes anything itself, it's a plain read of the historical log.
export interface ReadinessDay {
  logDate: string;
  workflowSuccessRate: number | null;
  stepLatencyP95Ms: number | null;
  retryRate: number | null;
  humanInterventionRate: number | null;
  reconciliationBacklog: number;
  dlqDepth: number;
  receiptCompleteness: number | null;
  incidentNotes: string | null;
}

export async function readinessTrend(tenantId: string, days = 30): Promise<ReadinessDay[]> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .select({
        logDate: readinessLog.logDate,
        workflowSuccessRate: readinessLog.workflowSuccessRate,
        stepLatencyP95Ms: readinessLog.stepLatencyP95Ms,
        retryRate: readinessLog.retryRate,
        humanInterventionRate: readinessLog.humanInterventionRate,
        reconciliationBacklog: readinessLog.reconciliationBacklog,
        dlqDepth: readinessLog.dlqDepth,
        receiptCompleteness: readinessLog.receiptCompleteness,
        incidentNotes: readinessLog.incidentNotes,
      })
      .from(readinessLog)
      .where(eq(readinessLog.tenantId, tenantId))
      .orderBy(desc(readinessLog.logDate))
      .limit(days),
  );
  return rows;
}

export interface ReadinessSlo {
  id: string;
  label: string;
  value: number | null;
  target: { operator: ">=" | "<=" | "<"; value: number; unit: "ratio" | "ms" | "count" | "seconds" | "minutes" } | null;
  trend30d: Array<{ logDate: string; value: number | null }>;
  errorBudgetBurn: number | null;
  unavailableReason?: string;
}

function ratioBurn(value: number | null, target: number): number | null {
  if (value === null) return null;
  if (value >= target) return 0;
  // A value at 98% against a 99% objective burns one whole day's error budget.
  return (target - value) / (1 - target);
}

/** A7: scorecard rows are derived from durable readiness history. Claims without a
 * durable source are emitted as unavailable rather than guessed or painted green. */
export async function readinessSloScorecard(tenantId: string): Promise<ReadinessSlo[]> {
  const trend = await readinessTrend(tenantId, 30);
  const chronological = [...trend].reverse();
  const workflowTrend = chronological.map((day) => ({ logDate: day.logDate, value: day.workflowSuccessRate }));
  const latencyTrend = chronological.map((day) => ({ logDate: day.logDate, value: day.stepLatencyP95Ms }));
  const dlqTrend = chronological.map((day) => ({ logDate: day.logDate, value: day.dlqDepth }));
  const latest = chronological.at(-1);
  const live = await reliability(tenantId, 30);
  const predictionCompared = live.predictionAccuracy.reduce((sum, row) => sum + row.comparedFields, 0);
  const predictionMatched = live.predictionAccuracy.reduce((sum, row) => sum + row.matchedFields, 0);
  const predictionValue = predictionCompared > 0 ? predictionMatched / predictionCompared : null;

  return [
    { id: "post_approval_success", label: "Post-approval success", value: latest?.workflowSuccessRate ?? null, target: { operator: ">=", value: 0.99, unit: "ratio" }, trend30d: workflowTrend, errorBudgetBurn: ratioBurn(latest?.workflowSuccessRate ?? null, 0.99) },
    { id: "workflow_p95", label: "Workflow p95 latency", value: latest?.stepLatencyP95Ms ?? null, target: null, trend30d: latencyTrend, errorBudgetBurn: null, unavailableReason: "Per-workflow-kind latency budgets have not been configured; existing scorecard is aggregate." },
    { id: "queue_oldest_pending", label: "Queue oldest pending", value: null, target: { operator: "<", value: 60, unit: "seconds" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "Jobs are global and do not carry tenant_id, so a tenant readiness view cannot truthfully attribute this metric." },
    { id: "worker_heartbeat", label: "Worker heartbeat", value: null, target: { operator: ">=", value: 0.999, unit: "ratio" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "Heartbeat freshness is global and has no durable daily availability series." },
    { id: "dlq_depth", label: "DLQ depth", value: latest?.dlqDepth ?? null, target: { operator: "<=", value: 0, unit: "count" }, trend30d: dlqTrend, errorBudgetBurn: latest ? (latest.dlqDepth === 0 ? 0 : null) : null },
    { id: "dlq_triage", label: "DLQ triage", value: null, target: { operator: "<", value: 24, unit: "minutes" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "No durable triage-completed timestamp exists yet." },
    { id: "api_5xx", label: "API 5xx rate", value: null, target: { operator: "<", value: 0.001, unit: "ratio" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "No durable HTTP request-status series exists in the application database." },
    { id: "planner_eval", label: "Planner eval", value: null, target: { operator: ">=", value: 0.95, unit: "ratio" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "Planner CI results are not persisted as a tenant readiness metric." },
    { id: "critic_catch", label: "Critic catch", value: null, target: { operator: ">=", value: 0.9, unit: "ratio" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "Critic eval results are not persisted as a tenant readiness metric." },
    { id: "cross_tenant_leaks", label: "Cross-tenant leaks", value: null, target: { operator: "<=", value: 0, unit: "count" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "Nightly isolation-probe outcomes are not persisted in the tenant database." },
    { id: "restore_drill", label: "Restore drill", value: null, target: { operator: "<", value: 30, unit: "minutes" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "Restore duration is recorded in failure-injection detail, not yet projected into a scalar series." },
    { id: "event_to_pixel", label: "Event to pixel", value: null, target: { operator: "<", value: 2, unit: "seconds" }, trend30d: [], errorBudgetBurn: null, unavailableReason: "No client telemetry currently records event-to-pixel latency." },
    { id: "prediction_accuracy", label: "Prediction accuracy", value: predictionValue, target: null, trend30d: [], errorBudgetBurn: null, unavailableReason: predictionValue === null ? "No comparable prediction diffs in the 30-day window." : undefined },
  ];
}

// Phase 8 (§8.2): the failure-injection calendar's real log, newest first.
export interface FailureInjectionRow {
  id: string;
  kind: string;
  injectedAt: string;
  detectedAt: string | null;
  recoveredAt: string | null;
  outcome: string | null;
  detail: unknown;
  receiptIds: unknown;
}

export async function failureInjectionLog(tenantId: string, limit = 50): Promise<FailureInjectionRow[]> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .select({
        id: failureInjections.id,
        kind: failureInjections.kind,
        injectedAt: failureInjections.injectedAt,
        detectedAt: failureInjections.detectedAt,
        recoveredAt: failureInjections.recoveredAt,
        outcome: failureInjections.outcome,
        detail: failureInjections.detail,
        receiptIds: failureInjections.receiptIds,
      })
      .from(failureInjections)
      .where(eq(failureInjections.tenantId, tenantId))
      .orderBy(desc(failureInjections.injectedAt))
      .limit(limit),
  );
  return rows.map((r) => ({ ...r, injectedAt: r.injectedAt.toISOString(), detectedAt: r.detectedAt?.toISOString() ?? null, recoveredAt: r.recoveredAt?.toISOString() ?? null }));
}
