// bulk_notify_existing_customers: consent-filtered promotional outreach — the real
// "win-back campaign" primitive (find everyone inactive N-M months, call/text them
// with a specific offer). The consent filter (households.marketing_consent = true)
// is NON-NEGOTIABLE — TCPA exposure on unconsented promotional calls/texts. draft()
// speaks the count and a sample line before anything executes; the batch is always
// confirmation-gated.
//
// Personalization (added alongside the certification pass): each target's own most
// recent equipment record is pulled and woven into THEIR call/text only — never
// shared across targets, matching the household-privacy boundary every other call
// in this system already respects. discountPercent is a real, separately-typed
// field specifically so a live offer number is always a value the owner actually
// gave (typed or spoken, either way through the same planner), never an LLM
// improvisation — the assistant's own system prompt already refuses to invent one;
// this is what gives it something real to say instead.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { agentKeyForPersona, personaAssistantId, reserveBudget, releaseBudget, DAILY_VAPI_CALL_CAP } from "@finnor/tools";
import { withTenant, households, communicationsLog, serviceVisits, equipment, tenants } from "@finnor/db";
import { invoices, maintenanceAgreements } from "@finnor/db";
import { churnRisk } from "@finnor/read-models";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { nextCallingWindow } from "../shared/time";

const ACTION = "bulk_notify_existing_customers";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const BulkNotifyPayloadSchema = z
  .object({
    // Optional now: when omitted, a personalized default is composed per-target from
    // their name + equipment + discountPercent (see composeMessage below) — the
    // owner can still hand-write exact wording, which always wins verbatim (with
    // {name}/{equipment}/{discount} placeholders substituted per target if present).
    offerScript: opt(z.string().min(10).max(1000)),
    channel: z.enum(["sms", "call"]).default("sms"),
    // Selects a specialized voice persona for channel="call" — falls back to the
    // default Finnor assistant if omitted or unrecognized. Auto-selects "winback"
    // when discountPercent is set and no persona was explicitly chosen.
    voicePersona: opt(z.enum(["winback", "service_reminder", "install_followup"])),
    // Inactivity window in months since last logged interaction (communications_log
    // or a service visit). Omit either bound to leave it open-ended.
    minMonthsInactive: opt(z.number().min(0).max(60)),
    maxMonthsInactive: opt(z.number().min(0).max(60)),
    // Exact day bounds win over month bounds. This is the path for instructions such
    // as "more than 90 days" — 90 stays 90, never rounded to three calendar months.
    minDaysInactive: opt(z.number().int().min(0).max(3650).describe("Exact minimum days since the customer's last recorded communication or completed service visit")),
    maxDaysInactive: opt(z.number().int().min(0).max(3650).describe("Exact maximum days since the customer's last recorded communication or completed service visit")),
    // The one real number the whole campaign is allowed to state — set by the owner
    // (typed or spoken), never invented downstream. Omit for a non-discount check-in.
    discountPercent: opt(z.number().min(0).max(100)),
  })
  .refine((p) => Boolean(p.offerScript) || p.discountPercent !== undefined, {
    message: "Provide either offerScript or discountPercent — a campaign needs real content, not a blank call.",
  })
  .refine((p) => p.minDaysInactive === undefined || p.maxDaysInactive === undefined || p.minDaysInactive <= p.maxDaysInactive, {
    message: "minDaysInactive cannot be greater than maxDaysInactive",
  })
  .refine((p) => p.minMonthsInactive === undefined || p.maxMonthsInactive === undefined || p.minMonthsInactive <= p.maxMonthsInactive, {
    message: "minMonthsInactive cannot be greater than maxMonthsInactive",
  });

export interface ConsentedTarget {
  householdId: string;
  label: string;
  phone: string;
  /** Their own most recent equipment type only — e.g. "water softener". Undefined
   *  when the household has no equipment on file (never another household's). */
  equipmentSummary?: string;
  equipmentModel?: string;
  installedAt?: string;
  lastInteractionAt?: string;
  daysInactive?: number | null;
  lastService?: { type: string; scheduledAt?: string; completedAt?: string; note?: string };
  lastCommunication?: { channel: string; direction: string; at: string; note: string };
  latestInvoice?: { status: string; amountUsd: number; createdAt: string; memo?: string };
  dealerName?: string;
  dealerTimezone?: string;
  riskScore?: number;
  riskFactors?: string[];
}

/** Per-target message, never a shared broadcast string. If the owner supplied
 *  offerScript, their exact wording wins — {name}/{equipment}/{discount} tokens are
 *  substituted if present, otherwise it's used verbatim. Otherwise a solid default
 *  win-back line is composed from what's actually known about THIS household. */
export function composeMessage(target: ConsentedTarget, offerScript: string | undefined, discountPercent: number | undefined): string {
  if (offerScript) {
    return offerScript
      .replaceAll("{name}", target.label)
      .replaceAll("{equipment}", target.equipmentSummary ?? "your water system")
      .replaceAll("{discount}", discountPercent !== undefined ? `${discountPercent}%` : "a special offer");
  }
  const equipmentLine = target.equipmentSummary ? ` with your ${target.equipmentSummary}` : " with your water system";
  const offerLine =
    discountPercent !== undefined
      ? ` We're running ${discountPercent}% off right now if you'd like to take advantage of it.`
      : "";
  return `Hi ${target.label}, this is ${target.dealerName ?? "your water treatment team"}. It's been a little while, and I wanted to check in${equipmentLine}. How has everything been going?${offerLine}`;
}

/** The call opens like a relationship, not a spreadsheet. Exact dates/history ride in
 * variableValues for the assistant to use only when naturally relevant; they are not
 * dumped into the first sentence. */
export function composeCallOpening(target: ConsentedTarget, offerScript?: string): string {
  if (offerScript) {
    return offerScript
      .replaceAll("{name}", target.label)
      .replaceAll("{equipment}", target.equipmentSummary ?? "water system")
      .replaceAll("{discount}", "the current offer");
  }
  const equipment = target.equipmentSummary ? ` your ${target.equipmentSummary}` : " your water system";
  return `Hi ${target.label}, this is Maya calling from ${target.dealerName ?? "your water treatment team"}. How have you been? I wanted to check in and see how${equipment} has been treating you.`;
}

function cleanContext(value: string | null | undefined, max = 280): string | undefined {
  if (!value) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
}

export function relationshipContext(target: ConsentedTarget): string {
  const facts = [
    target.installedAt && target.equipmentSummary
      ? `${target.equipmentSummary}${target.equipmentModel ? ` model ${target.equipmentModel}` : ""} installed ${target.installedAt}`
      : target.equipmentSummary
        ? `${target.equipmentSummary}${target.equipmentModel ? ` model ${target.equipmentModel}` : ""} on file`
        : undefined,
    target.lastService
      ? `last ${target.lastService.type} service ${target.lastService.completedAt ?? target.lastService.scheduledAt ?? "date not recorded"}`
      : undefined,
    target.lastInteractionAt ? `last recorded interaction ${target.lastInteractionAt}` : "no prior interaction date recorded",
  ].filter(Boolean);
  return facts.join("; ");
}

export function experienceContext(target: ConsentedTarget): string {
  const facts = [
    target.lastService?.note ? `service note: ${cleanContext(target.lastService.note)}` : undefined,
    target.lastCommunication?.note ? `recent conversation: ${cleanContext(target.lastCommunication.note)}` : undefined,
    target.latestInvoice?.memo ? `purchase note: ${cleanContext(target.latestInvoice.memo)}` : undefined,
  ].filter(Boolean);
  return facts.length > 0 ? facts.join("; ") : "No experience note is recorded; ask openly and do not assume satisfaction or dissatisfaction.";
}

export interface InactivityWindow {
  minMonthsInactive?: number;
  maxMonthsInactive?: number;
  minDaysInactive?: number;
  maxDaysInactive?: number;
}

/** Exported so the consent behavior is directly unit-testable. */
export async function findConsentedTargets(tenantId: string, window?: InactivityWindow): Promise<ConsentedTarget[]> {
  return withTenant(tenantId, async (db) => {
    const [tenant] = await db.select({ name: tenants.name, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const rows = await db
      .select({
        id: households.id,
        address: households.address,
        contactInfo: households.contactInfo,
      })
      .from(households)
      // §0.3.5: RLS + an explicit tenant predicate, both, always — never RLS alone.
      // The TCPA consent line is equally non-negotiable — never widened.
      .where(and(eq(households.tenantId, tenantId), eq(households.marketingConsent, true)));
    if (rows.length === 0) return [];

    // Last logged interaction per household — the more recent of any communications_log
    // entry or a completed service visit. Households with no history are inactive too
    // (they're a customer of record but never engaged): treated as maximally inactive.
    const lastSeen = await db.execute<{ household_id: string; last_at: string | null }>(sql`
      SELECT h.id AS household_id, GREATEST(MAX(cl.timestamp), MAX(sv.completed_at)) AS last_at
      FROM households h
      LEFT JOIN communications_log cl ON cl.household_id = h.id
      LEFT JOIN service_visits sv ON sv.household_id = h.id
      WHERE h.tenant_id = ${tenantId}
      GROUP BY h.id
    `);
    const lastSeenById = new Map(lastSeen.rows.map((r) => [r.household_id, r.last_at]));

    // Each household's own most recent equipment type only — one row per household,
    // never leaked across households. equipment has no tenant_id column of its own
    // (RLS scopes it via a household_id subquery, same as service_visits/
    // communications_log above) — explicitly scoped here too via inArray against
    // THIS tenant's own already-fetched household ids, not RLS alone.
    const equipmentRows = await db
      .select({ householdId: equipment.householdId, type: equipment.type, model: equipment.model, installDate: equipment.installDate })
      .from(equipment)
      .where(inArray(equipment.householdId, rows.map((r) => r.id)))
      .orderBy(desc(equipment.installDate));
    const equipmentByHousehold = new Map<string, (typeof equipmentRows)[number]>();
    for (const e of equipmentRows) {
      if (!equipmentByHousehold.has(e.householdId)) equipmentByHousehold.set(e.householdId, e);
    }
    const householdIds = rows.map((row) => row.id);
    // Keep the transaction client single-flight. pg@9 warns when Drizzle queues
    // concurrent queries on one checked-out client; these reads are independent but
    // small and preserving deterministic query order keeps the simulation warning-free.
    const visits = await db
      .select({ householdId: serviceVisits.householdId, type: serviceVisits.type, scheduledAt: serviceVisits.scheduledAt, completedAt: serviceVisits.completedAt, notes: serviceVisits.notes })
      .from(serviceVisits)
      .where(inArray(serviceVisits.householdId, householdIds))
      .orderBy(desc(serviceVisits.completedAt), desc(serviceVisits.scheduledAt));
    const agreements = await db
      .select({ householdId: maintenanceAgreements.householdId, status: maintenanceAgreements.status })
      .from(maintenanceAgreements)
      .where(inArray(maintenanceAgreements.householdId, householdIds));
    const invoiceRows = await db
      .select({ householdId: invoices.householdId, status: invoices.status, amountUsd: invoices.amountUsd, memo: invoices.memo, createdAt: invoices.createdAt })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.householdId, householdIds)))
      .orderBy(desc(invoices.createdAt));
    const communicationRows = await db
      .select({ householdId: communicationsLog.householdId, channel: communicationsLog.channel, direction: communicationsLog.direction, content: communicationsLog.content, timestamp: communicationsLog.timestamp })
      .from(communicationsLog)
      .where(inArray(communicationsLog.householdId, householdIds))
      .orderBy(desc(communicationsLog.timestamp));

    const now = Date.now();
    const daysAgo = (iso: string | null) => (iso ? (now - new Date(iso).getTime()) / 86_400_000 : Infinity);
    const latestVisitByHousehold = new Map<string, (typeof visits)[number]>();
    for (const visit of visits) {
      const candidateAt = visit.completedAt ?? (visit.scheduledAt && visit.scheduledAt.getTime() <= now ? visit.scheduledAt : null);
      if (!candidateAt) continue;
      const prior = latestVisitByHousehold.get(visit.householdId);
      const priorAt = prior?.completedAt ?? prior?.scheduledAt ?? null;
      if (!priorAt || candidateAt > priorAt) latestVisitByHousehold.set(visit.householdId, visit);
    }
    const latestCommunicationByHousehold = new Map<string, (typeof communicationRows)[number]>();
    for (const communication of communicationRows) if (!latestCommunicationByHousehold.has(communication.householdId)) latestCommunicationByHousehold.set(communication.householdId, communication);
    const latestInvoiceByHousehold = new Map<string, (typeof invoiceRows)[number]>();
    for (const invoice of invoiceRows) if (!latestInvoiceByHousehold.has(invoice.householdId)) latestInvoiceByHousehold.set(invoice.householdId, invoice);

    return rows
      .filter((r) => {
        if (!window) return true;
        const days = daysAgo(lastSeenById.get(r.id) ?? null);
        if (window.minDaysInactive !== undefined && days < window.minDaysInactive) return false;
        if (window.maxDaysInactive !== undefined && days > window.maxDaysInactive) return false;
        const months = days / 30.44;
        if (window.minDaysInactive === undefined && window.minMonthsInactive !== undefined && months < window.minMonthsInactive) return false;
        if (window.maxDaysInactive === undefined && window.maxMonthsInactive !== undefined && months > window.maxMonthsInactive) return false;
        return true;
      })
      .map((r) => {
        const contact = (r.contactInfo ?? {}) as Record<string, unknown>;
        const equipmentRow = equipmentByHousehold.get(r.id);
        const lastInteractionAt = lastSeenById.get(r.id) ?? null;
        const latestVisit = latestVisitByHousehold.get(r.id);
        const latestCommunication = latestCommunicationByHousehold.get(r.id);
        const latestInvoice = latestInvoiceByHousehold.get(r.id);
        const completed = visits.filter((visit) => visit.householdId === r.id && visit.completedAt);
        const lastCompleted = completed.reduce<Date | null>((latest, visit) => !latest || visit.completedAt! > latest ? visit.completedAt! : latest, null);
        const risk = churnRisk({ daysSinceVisit: lastCompleted ? (Date.now() - lastCompleted.getTime()) / 86_400_000 : Infinity, visitsLastYear: completed.filter((visit) => visit.completedAt!.getTime() >= Date.now() - 365 * 86_400_000).length, hasActiveAmc: agreements.some((agreement) => agreement.householdId === r.id && agreement.status === "active"), overdueBalanceUsd: invoiceRows.filter((invoice) => invoice.householdId === r.id && invoice.status === "overdue").reduce((sum, invoice) => sum + Number(invoice.amountUsd), 0) });
        return {
          householdId: r.id,
          label: String(contact.name ?? r.address),
          phone: String(contact.phone ?? ""),
          equipmentSummary: equipmentRow?.type,
          equipmentModel: equipmentRow?.model ?? undefined,
          installedAt: equipmentRow?.installDate?.toISOString(),
          lastInteractionAt: lastInteractionAt ? new Date(lastInteractionAt).toISOString() : undefined,
          daysInactive: lastInteractionAt ? Math.floor(daysAgo(lastInteractionAt)) : null,
          lastService: latestVisit
            ? {
                type: latestVisit.type,
                scheduledAt: latestVisit.scheduledAt?.toISOString(),
                completedAt: latestVisit.completedAt?.toISOString(),
                note: cleanContext(latestVisit.notes),
              }
            : undefined,
          lastCommunication: latestCommunication
            ? {
                channel: latestCommunication.channel,
                direction: latestCommunication.direction,
                at: latestCommunication.timestamp.toISOString(),
                note: cleanContext(latestCommunication.content) ?? "",
              }
            : undefined,
          latestInvoice: latestInvoice
            ? {
                status: latestInvoice.status,
                amountUsd: Number(latestInvoice.amountUsd),
                createdAt: latestInvoice.createdAt.toISOString(),
                memo: cleanContext(latestInvoice.memo),
              }
            : undefined,
          dealerName: tenant?.name ?? "your water treatment team",
          dealerTimezone: tenant?.timezone ?? "America/Chicago",
          riskScore: risk.score,
          riskFactors: risk.factors,
        };
      })
      .filter((t) => t.phone.length > 0)
      .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0) || a.label.localeCompare(b.label));
  });
}

const WINBACK_ANALYSIS_PLAN: Record<string, unknown> = {
  structuredDataPlan: {
    enabled: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        outcome: {
          type: "string",
          enum: ["booked", "interested", "follow_up_later", "not_interested", "opted_out", "wrong_number", "voicemail", "no_answer", "unknown"],
          description: "The customer's actual outcome; never infer booked unless they explicitly requested an appointment.",
        },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative", "unknown"] },
        appointmentRequested: { type: "boolean" },
        preferredTimeText: { type: "string" },
        optOut: { type: "boolean" },
        experienceSummary: { type: "string", description: "A short factual summary of what the customer said about their experience." },
      },
      required: ["outcome", "sentiment", "appointmentRequested", "optOut", "experienceSummary"],
    },
  },
};

function campaignCustomer(
  target: ConsentedTarget,
  draft: DraftAction,
  offerScript: string | undefined,
  discountPercent: number | undefined,
  agentKey: string | undefined,
): Record<string, unknown> {
  const domainActionId = draft.domainActionId ?? "unstamped-domain-action";
  const offerDetails = discountPercent !== undefined
    ? `${discountPercent}% discount approved for this win-back campaign. Reconnect first; mention it naturally after learning how the customer is doing. Do not invent exclusions, prices, or urgency.`
    : offerScript
      ? `Owner-approved campaign wording: ${offerScript}`
      : "No discount was approved. This is a warm relationship check-in only.";
  const variableValues = {
    customerName: target.label,
    dealerName: target.dealerName ?? "the water treatment team",
    equipmentType: target.equipmentSummary ?? "water system",
    relationshipContext: relationshipContext(target),
    experienceContext: experienceContext(target),
    offerDetails,
    householdId: target.householdId,
    campaignActionId: domainActionId,
  };
  return {
    number: target.phone,
    name: target.label,
    externalId: target.householdId,
    assistantOverrides: {
      firstMessage: composeCallOpening(target, offerScript),
      variableValues,
      metadata: {
        direction: "outbound",
        purpose: "winback",
        ...(agentKey ? { agentKey } : {}),
        domainActionId,
        householdId: target.householdId,
      },
      analysisPlan: WINBACK_ANALYSIS_PLAN,
    },
  };
}

export const bulkNotifyPlugin: DomainEnginePlugin = {
  name: "bulk-notify",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: BulkNotifyPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = BulkNotifyPayloadSchema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  async draft(actionType, payload, policy: DomainPolicy): Promise<DraftAction> {
    const p = BulkNotifyPayloadSchema.parse(payload);
    const targets = await findConsentedTargets(policy.tenantId, {
      minMonthsInactive: p.minMonthsInactive as number | undefined,
      maxMonthsInactive: p.maxMonthsInactive as number | undefined,
      minDaysInactive: p.minDaysInactive as number | undefined,
      maxDaysInactive: p.maxDaysInactive as number | undefined,
    });
    const sample = targets[0];
    const windowNote = p.minDaysInactive !== undefined || p.maxDaysInactive !== undefined
      ? ` inactive ${p.minDaysInactive ?? 0}-${p.maxDaysInactive ?? "∞"} exact days`
      : p.minMonthsInactive !== undefined || p.maxMonthsInactive !== undefined
        ? ` inactive ${p.minMonthsInactive ?? 0}-${p.maxMonthsInactive ?? "∞"} months`
        : "";
    const discountNote = p.discountPercent !== undefined ? ` at ${p.discountPercent}% off` : "";
    const sampleLine = sample
      ? p.channel === "call"
        ? composeCallOpening(sample, p.offerScript as string | undefined)
        : composeMessage(sample, p.offerScript as string | undefined, p.discountPercent as number | undefined)
      : "";
    const batchCount = Math.ceil(targets.length / DAILY_VAPI_CALL_CAP);
    const cappedNote = targets.length > DAILY_VAPI_CALL_CAP && p.channel === "call"
      ? ` (${batchCount} provider-managed weekday batches, at most ${DAILY_VAPI_CALL_CAP} calls per day)`
      : "";
    const summary =
      targets.length === 0
        ? "No customers match — either no marketing consent on file, or none fall in that inactivity window. Nothing will be sent."
        : `Reach ${targets.length} customer${targets.length === 1 ? "" : "s"} with marketing consent${windowNote}${discountNote}` +
          ` via ${p.channel}${p.voicePersona ? ` (${p.voicePersona} persona)` : ""}${cappedNote} — each gets their own personalized message` +
          ` (sample opening, ${sample?.label}): "${sampleLine}" — exact purchase/service context is available to that customer's call only. Approve to queue the full cohort?`;
    return {
      actionType,
      summary,
      // Freeze only the approved cohort IDs, not thousands of full customer histories
      // inside one domain_action row. Execution rehydrates current data and rechecks
      // consent, so a customer who opts out before approval is still excluded.
      payload: {
        ...p,
        tenantId: policy.tenantId,
        targetHouseholdIds: targets.map((target) => target.householdId),
        approvedTargetCount: targets.length,
        preview: targets.slice(0, 3).map((target) => ({
          householdId: target.householdId,
          label: target.label,
          daysInactive: target.daysInactive,
          equipment: target.equipmentSummary ?? null,
          opening: p.channel === "call" ? composeCallOpening(target, p.offerScript as string | undefined) : composeMessage(target, p.offerScript as string | undefined, p.discountPercent as number | undefined),
        })),
      },
      requiresConfirmation: true, // the fixed hardening floor also enforces typed approval
    };
  },

  async simulate(actionType, payload, policy) {
    const p = BulkNotifyPayloadSchema.parse(payload);
    const targets = await findConsentedTargets(policy.tenantId, {
      minMonthsInactive: p.minMonthsInactive as number | undefined,
      maxMonthsInactive: p.maxMonthsInactive as number | undefined,
      minDaysInactive: p.minDaysInactive as number | undefined,
      maxDaysInactive: p.maxDaysInactive as number | undefined,
    });
    const callable = targets.length;
    const batches = p.channel === "call" ? Math.ceil(targets.length / DAILY_VAPI_CALL_CAP) : 1;
    return {
      mode: "dry_run" as const,
      summary: `Dry run: ${targets.length} consented customer${targets.length === 1 ? "" : "s"} match; ${callable} ${p.channel} delivery${callable === 1 ? "" : "ies"} would be queued${p.channel === "call" ? ` across ${batches} weekday batch${batches === 1 ? "" : "es"}` : ""}. No message or call was sent.`,
      predicted: {
        channel: p.channel,
        matchingConsentedTargets: targets.length,
        wouldAttempt: callable,
        batches,
        capped: 0,
        fieldChanges: [],
        expectedResult: { queued: callable, batches },
      },
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const offerScript = draft.payload.offerScript ? String(draft.payload.offerScript) : undefined;
    const discountPercent = typeof draft.payload.discountPercent === "number" ? draft.payload.discountPercent : undefined;
    const channel = String(draft.payload.channel ?? "sms");
    const tenantId = String(draft.payload.tenantId ?? "");
    const approvedIds = new Set(
      Array.isArray(draft.payload.targetHouseholdIds)
        ? draft.payload.targetHouseholdIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    const refreshed = await findConsentedTargets(tenantId, {
      minMonthsInactive: typeof draft.payload.minMonthsInactive === "number" ? draft.payload.minMonthsInactive : undefined,
      maxMonthsInactive: typeof draft.payload.maxMonthsInactive === "number" ? draft.payload.maxMonthsInactive : undefined,
      minDaysInactive: typeof draft.payload.minDaysInactive === "number" ? draft.payload.minDaysInactive : undefined,
      maxDaysInactive: typeof draft.payload.maxDaysInactive === "number" ? draft.payload.maxDaysInactive : undefined,
    });
    // Backward-compatible rehydration for pre-upgrade pending drafts that stored full
    // targets. New drafts always use the compact frozen ID cohort above.
    const legacyTargets = Array.isArray(draft.payload.targets) ? (draft.payload.targets as unknown as ConsentedTarget[]) : [];
    const targets = approvedIds.size > 0
      ? refreshed.filter((target) => approvedIds.has(target.householdId))
      : legacyTargets.length > 0
        ? refreshed.filter((target) => legacyTargets.some((legacy) => legacy.householdId === target.householdId))
        : [];
    const approvedTargetCount = typeof draft.payload.approvedTargetCount === "number" ? draft.payload.approvedTargetCount : targets.length;
    const excludedSinceApproval = Math.max(0, approvedTargetCount - targets.length);
    // Marketing calls always use the real win-back assistant unless the owner chose a
    // narrower specialized persona. There is no invented sixth/ninth calling agent.
    const voicePersona = draft.payload.voicePersona ? String(draft.payload.voicePersona) : "winback";
    const assistantId = personaAssistantId(voicePersona) ?? process.env.VAPI_ASSISTANT_ID;
    const agentKey = agentKeyForPersona(voicePersona);
    if (targets.length === 0) {
      return {
        status: "success",
        output: { queued: 0, sent: 0, excludedSinceApproval, reason: "No approved recipient still has marketing consent and matches the approved inactivity window." },
        expected: { queued: 0 },
      };
    }

    if (channel === "call") {
      if (!assistantId) {
        return { status: "integration_unavailable", output: { queued: 0 }, error: "The Vapi win-back assistant is not configured." };
      }
      const campaigns: Array<Record<string, unknown>> = [];
      const failures: string[] = [];
      let queued = 0;
      let batchIndex = 0;
      let weekdayOffset = 0;
      const domainActionId = draft.domainActionId ?? "unstamped-domain-action";
      while (queued < targets.length && weekdayOffset < 60) {
        const window = nextCallingWindow(targets[0]?.dealerTimezone ?? "America/Chicago", new Date(), weekdayOffset);
        const requested = Math.min(DAILY_VAPI_CALL_CAP, targets.length - queued);
        const budgetDate = window.earliestAt.toISOString().slice(0, 10);
        const reservationKey = `${domainActionId}:batch:${batchIndex}`;
        const reservation = await reserveBudget(
          tenantId,
          "vapi",
          "call",
          DAILY_VAPI_CALL_CAP,
          requested,
          budgetDate,
          reservationKey,
        );
        if (reservation.granted === 0) {
          weekdayOffset++;
          continue;
        }
        const batch = targets.slice(queued, queued + reservation.granted);
        const campaignName = `finnor-winback-${domainActionId}-${window.localDate}-${batchIndex}`;
        const result = await tools.call("vapi_create_campaign", {
          name: campaignName,
          assistantId,
          schedulePlan: { earliestAt: window.earliestAt.toISOString(), latestAt: window.latestAt.toISOString() },
          customers: batch.map((target) => campaignCustomer(target, draft, offerScript, discountPercent, agentKey)),
        });
        if (!result.ok) {
          await releaseBudget(tenantId, "vapi", "call", reservation.granted, budgetDate, reservationKey).catch(() => undefined);
          failures.push(`${campaignName}: ${result.error ?? "Vapi did not accept the batch"}`);
        } else {
          campaigns.push({
            campaignId: String(result.output.id ?? "provider-id-not-returned"),
            name: campaignName,
            customers: batch.length,
            localDate: window.localDate,
            earliestAt: window.earliestAt.toISOString(),
            latestAt: window.latestAt.toISOString(),
          });
          queued += batch.length;
          batchIndex++;
        }
        weekdayOffset++;
        if (!result.ok) break;
      }
      if (failures.length > 0) {
        return {
          status: "integration_unavailable",
          output: { queued, campaigns, failures, excludedSinceApproval, remaining: targets.length - queued },
          error: failures[0],
          expected: { queued: targets.length },
        };
      }
      return {
        status: "success",
        output: {
          queued,
          sent: 0,
          providerManaged: true,
          campaigns,
          excludedSinceApproval,
          spokenSummary: `${queued} personalized win-back call${queued === 1 ? "" : "s"} queued across ${campaigns.length} weekday Vapi campaign${campaigns.length === 1 ? "" : "s"}. Each call has that customer's exact equipment, service, interaction, and experience context; ${excludedSinceApproval} recipient${excludedSinceApproval === 1 ? " was" : "s were"} excluded after the approval recheck.`,
        },
        expected: { queued: targets.length, batches: campaigns.length },
      };
    }

    let sent = 0;
    const failures: string[] = [];
    for (const t of targets) {
      const message = composeMessage(t, offerScript, discountPercent);
      const contact = await tools.call("ghl_create_contact", { phone: t.phone, firstName: t.label, tenantId });
      const sms = contact.ok
        ? await tools.call("ghl_send_sms", {
            contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
            message,
            tenantId,
          })
        : contact;
      sms.ok ? sent++ : failures.push(`${t.label}: ${sms.error}`);
    }
    if (sent === 0 && failures.length > 0) {
      return { status: "integration_unavailable", output: { failures }, error: failures[0] };
    }
    return { status: "success", output: { sent, failures, excludedSinceApproval }, expected: { sent: targets.length } };
  },
};

export default bulkNotifyPlugin;
