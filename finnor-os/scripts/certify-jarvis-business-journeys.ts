/** Read-only data certification for the three high-risk conversational journeys:
 * exact inactivity cohort, named Household 360, and full-team schedule range. This
 * never creates a domain action or contacts a customer. */

import { closePool, households, withTenant } from "@finnor/db";
import { household360, resolveHouseholdMention } from "@finnor/read-models";
import { findConsentedTargets } from "../packages/domain-plugins/bulk-notify/index";
import { schedulingPlugin } from "../packages/domain-plugins/scheduling/index";
import { opsOverviewPlugin } from "../packages/domain-plugins/ops-overview/index";

async function main(): Promise<void> {
  const tenantId = process.env.JARVIS_CERT_TENANT_ID ?? process.env.VAPI_DEFAULT_TENANT_ID;
  if (!tenantId || tenantId === "PLACEHOLDER_NEEDS_REAL_VALUE") throw new Error("JARVIS_CERT_TENANT_ID or VAPI_DEFAULT_TENANT_ID is required");
  const startDate = process.env.JARVIS_CERT_START_DATE ?? new Date().toISOString().slice(0, 10);
  const endDate = process.env.JARVIS_CERT_END_DATE ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const named = await resolveHouseholdMention(tenantId, "Tell me the exact history for Daniel Beckham");
  const nearbyNames = named ? [] : await withTenant(tenantId, async (db) => {
    const rows = await db.select({ id: households.id, contactInfo: households.contactInfo }).from(households);
    return rows
      .map((row) => ({ id: row.id, name: typeof (row.contactInfo as Record<string, unknown>).name === "string" ? String((row.contactInfo as Record<string, unknown>).name) : "" }))
      .filter((row) => /daniel|beckham/i.test(row.name))
      .slice(0, 20);
  });
  const [customer, cohort] = await Promise.all([
    named ? household360(tenantId, named.householdId) : Promise.resolve(null),
    findConsentedTargets(tenantId, { minDaysInactive: 90 }),
  ]);
  const scheduleDraft = await schedulingPlugin.draft(
    "check_technician_availability",
    { date: startDate, endDate },
    { id: "read-only-cert", tenantId, actionType: "check_technician_availability", policy: {}, requiresConfirmation: false, confirmationTemplate: null, version: 1 },
  );
  const schedule = await schedulingPlugin.execute(scheduleDraft, {} as never);
  const namedCustomerAnswer = process.env.JARVIS_CERT_LLM === "1"
    ? await opsOverviewPlugin.execute(
        await opsOverviewPlugin.draft(
          "answer_business_question",
          { question: "Tell me the exact history for Daniel Beckham, including when the customer record was created and every recorded service date.", responseChannel: "text" },
          { id: "read-only-cert", tenantId, actionType: "answer_business_question", policy: {}, requiresConfirmation: false, confirmationTemplate: null, version: 1 },
        ),
        {} as never,
      )
    : null;
  console.log(JSON.stringify({
    cohort: {
      exactMinimumDays: 90,
      eligibleWithConsentAndPhone: cohort.length,
      oldestDaysInactive: cohort.reduce<number | null>((oldest, target) => target.daysInactive === null || target.daysInactive === undefined ? oldest : Math.max(oldest ?? 0, target.daysInactive), null),
      providerBatchesAt200PerDay: Math.ceil(cohort.length / 200),
    },
    namedCustomer: customer ? {
      matched: true,
      householdId: customer.household.id,
      createdAt: customer.household.createdAt,
      equipment: customer.equipment.map((item) => ({ type: item.type, model: item.model, installDate: item.installDate })),
      serviceVisits: customer.serviceVisits.map((visit) => ({ type: visit.type, scheduledAt: visit.scheduledAt, completedAt: visit.completedAt, hasNotes: Boolean(visit.notes) })),
      appointments: customer.appointments.map((appointment) => ({ status: appointment.status, scheduledAt: appointment.scheduledAt })),
      invoices: customer.invoices.map((invoice) => ({ status: invoice.status, createdAt: invoice.createdAt, dueDate: invoice.dueDate, payments: invoice.payments.length })),
      calls: customer.calls.length,
    } : { matched: false, nearbyNames },
    schedule: schedule.status === "success" ? {
      status: schedule.status,
      spokenSummary: schedule.output.spokenSummary,
      total: schedule.output.total,
      dateRange: schedule.output.dateRange,
    } : { status: schedule.status, error: schedule.error },
    ...(namedCustomerAnswer ? { namedCustomerAnswer: { status: namedCustomerAnswer.status, answer: namedCustomerAnswer.output.spokenSummary ?? null } } : {}),
  }, null, 2));
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
