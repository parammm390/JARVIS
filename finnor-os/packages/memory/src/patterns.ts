// Retrieval-based pattern context (Phase 9, docs/jarvis-99-phase-7-9-execution-plan.md).
// Sibling to short-term.ts/long-term.ts/semantic.ts/episodic.ts/consolidated.ts. Two
// real, queryable historical signals — a household's own past proposal/quote outcomes,
// and tenant-wide technician no-show rates — computed live from existing rows on
// every call. No fine-tuning, no "learning," no similarity search: call this
// "pattern context" or "retrieval" everywhere, per the roadmap's own honesty standard.

import { withTenant, proposals, quotes, households, businessEvents, technicians, appointments, scanFindings, type Db } from "@finnor/db";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { PatternContext, HouseholdProposalPattern, TechnicianReliabilityPattern, ScanSignal } from "@finnor/shared-types";

// proposals has no tenant_id column (confirmed: packages/db/schema.ts's proposals
// table only carries householdId) — must join through households to scope by tenant,
// the same pattern read-models/index.ts's pipelineHealth() already uses for
// proposalsByStatus. Filtering only on proposals.householdId (without the tenant
// join) would work by construction here since householdId is already tenant-specific,
// but the households join is kept anyway as an explicit tenant boundary check,
// matching the rest of this codebase's defense-in-depth convention.
async function householdProposalPattern(db: Db, tenantId: string, householdId: string): Promise<HouseholdProposalPattern> {
  const rows = await db
    .select({ proposalId: proposals.id, quoteId: proposals.quoteId, totalUsd: quotes.totalUsd })
    .from(proposals)
    .innerJoin(households, eq(households.id, proposals.householdId))
    .leftJoin(quotes, eq(quotes.id, proposals.quoteId))
    .where(and(eq(households.tenantId, tenantId), eq(proposals.householdId, householdId)));

  // proposals.status is never mirrored to "declined"/"expired" (only ever set to
  // "accepted" — confirmed in applySignatureOutcome()), so the real outcome must be
  // read from quotes.status or the business_events rows the same function writes
  // (entityType: "quote", eventType: "quote_accepted" | "quote_declined" |
  // "quote_expired"). Using the business_events rows here, not quotes.status
  // directly, since a quote can carry other statuses ("draft", "sent") that aren't a
  // signature outcome at all.
  const quoteIds = rows.map((r) => r.quoteId).filter((id): id is string => id !== null);
  const outcomes =
    quoteIds.length === 0
      ? []
      : await db
          .select({ entityId: businessEvents.entityId, eventType: businessEvents.eventType })
          .from(businessEvents)
          .where(
            and(
              eq(businessEvents.tenantId, tenantId),
              eq(businessEvents.entityType, "quote"),
              inArray(businessEvents.entityId, quoteIds),
              inArray(businessEvents.eventType, ["quote_accepted", "quote_declined", "quote_expired"]),
            ),
          );
  const outcomeByQuoteId = new Map(outcomes.map((o) => [o.entityId, o.eventType]));

  let accepted = 0;
  let declined = 0;
  let expired = 0;
  const acceptedTotals: number[] = [];
  for (const r of rows) {
    const outcome = r.quoteId ? outcomeByQuoteId.get(r.quoteId) : undefined;
    if (outcome === "quote_accepted") {
      accepted++;
      if (r.totalUsd !== null) acceptedTotals.push(Number(r.totalUsd));
    } else if (outcome === "quote_declined") {
      declined++;
    } else if (outcome === "quote_expired") {
      expired++;
    }
  }
  return {
    totalSent: rows.length,
    accepted,
    declined,
    expired,
    avgAcceptedTotalUsd: acceptedTotals.length > 0 ? acceptedTotals.reduce((s, n) => s + n, 0) / acceptedTotals.length : null,
  };
}

// Tenant-wide, not household-scoped — technician performance isn't a household fact,
// and computing it tenant-wide sidesteps a real chicken-and-egg problem:
// buildMemorySnapshot() runs BEFORE planning, so the specific technician a
// not-yet-drafted assign_technician_to_visit action will reference isn't known yet. A
// small, bounded, tenant-wide list handed to the LLM (same shape as
// shortTerm/episodic — context for it to use its own judgment on) avoids needing to
// predict the future action_type at all.
//
// No-show rate, not a fabricated "ETA lateness" metric — appointments has
// scheduledAt but no actual-arrival timestamp; service_visits/work_orders have
// completedAt, which measures finish, not arrival. appointments.status = 'no_show'
// per technician is the nearest real, honestly-available signal.
async function technicianReliabilityPattern(db: Db, tenantId: string): Promise<TechnicianReliabilityPattern[]> {
  const rows = await db
    .select({ technicianId: appointments.technicianId, status: appointments.status, name: technicians.name })
    .from(appointments)
    .innerJoin(technicians, eq(technicians.id, appointments.technicianId))
    .where(and(eq(appointments.tenantId, tenantId), isNotNull(appointments.technicianId)));

  const byTech = new Map<string, { name: string; total: number; noShow: number }>();
  for (const r of rows) {
    const key = r.technicianId!;
    const bucket = byTech.get(key) ?? { name: r.name, total: 0, noShow: 0 };
    bucket.total++;
    if (r.status === "no_show") bucket.noShow++;
    byTech.set(key, bucket);
  }
  return [...byTech.entries()].map(([technicianId, b]) => ({
    technicianId,
    name: b.name,
    totalAppointments: b.total,
    noShowCount: b.noShow,
    noShowRate: b.total > 0 ? b.noShow / b.total : 0,
  }));
}

// Phase 12 (loop closure) — undigested scan_findings as soft context. Newest 10 only
// (a planner prompt is not a findings inbox); details jsonb deliberately NOT
// forwarded — summary is already dealer-readable, raw details would bloat the prompt
// for no benefit the LLM can act on.
async function scanSignalsPattern(db: Db, tenantId: string): Promise<ScanSignal[]> {
  const rows = await db
    .select({ scanType: scanFindings.scanType, severity: scanFindings.severity, summary: scanFindings.summary, createdAt: scanFindings.createdAt })
    .from(scanFindings)
    .where(and(eq(scanFindings.tenantId, tenantId), isNull(scanFindings.digestedAt)))
    .orderBy(desc(scanFindings.createdAt))
    .limit(10);
  const now = Date.now();
  return rows.map((r) => ({
    scanType: r.scanType,
    severity: r.severity as ScanSignal["severity"],
    summary: r.summary,
    ageHours: (now - r.createdAt.getTime()) / 3_600_000,
  }));
}

export async function buildPatternContext(tenantId: string, householdId?: string): Promise<PatternContext> {
  return withTenant(tenantId, async (db) => ({
    householdProposals: householdId ? await householdProposalPattern(db, tenantId, householdId) : null,
    technicianReliability: await technicianReliabilityPattern(db, tenantId),
    scanSignals: await scanSignalsPattern(db, tenantId),
  }));
}
