// Water Test domain plugin: schedule_water_test — one of the two proven action types.

import type { DomainEnginePlugin, } from "../shared/plugin-interface";
import { renderTemplate } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, DomainPolicy, ValidationResult } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { WaterTestPayloadSchema, WaterTestPolicySchema } from "./policy.schema";

export * from "./policy.schema";

const ACTION = "schedule_water_test";

export const waterTestPlugin: DomainEnginePlugin = {
  name: "water-test",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: WaterTestPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload, policy: DomainPolicy): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const errors: string[] = [];
    const p = WaterTestPayloadSchema.safeParse(payload);
    if (!p.success) errors.push(...p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`));
    const pol = WaterTestPolicySchema.safeParse(policy.policy);
    if (!pol.success) errors.push(...pol.error.issues.map((i) => `policy.${i.path.join(".")}: ${i.message}`));
    return { valid: errors.length === 0, errors };
  },

  draft(actionType, payload, policy): DraftAction {
    const p = WaterTestPayloadSchema.parse(payload);
    const scheduledAt = p.requestedAt ?? "next available window";
    const template =
      policy.confirmationTemplate ??
      "Schedule a water test at {{address}} on {{scheduled_at}} with {{technician}}. Approve?";
    return {
      actionType,
      summary: renderTemplate(template, {
        address: p.address,
        scheduled_at: scheduledAt,
        technician: p.technicianId ?? "the next available technician",
      }),
      payload: { ...p, scheduledAt, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    // 1. Ensure the contact exists in GHL; 2. book the calendar slot; 3. text confirmation.
    const contact = await tools.call("ghl_create_contact", {
      firstName: (draft.payload.contactName as string | undefined) ?? "Customer",
      phone: draft.payload.contactPhone,
      address: draft.payload.address,
      tenantId: draft.payload.tenantId,
    });
    if (!contact.ok) {
      return {
        status: contact.integrationUnavailable ? "integration_unavailable" : "failure",
        output: {},
        error: `Could not reach the CRM to create the contact: ${contact.error}`,
      };
    }
    const booking = await tools.call("ghl_book_appointment", {
      calendarId: process.env.GHL_WATER_TEST_CALENDAR_ID ?? "PLACEHOLDER_NEEDS_REAL_VALUE",
      contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
      startTime: String(draft.payload.scheduledAt ?? ""),
      tenantId: draft.payload.tenantId,
    });
    if (!booking.ok) {
      return {
        status: booking.integrationUnavailable ? "integration_unavailable" : "failure",
        output: { contact: contact.output },
        error: `Contact created, but the calendar booking failed: ${booking.error}`,
      };
    }
    return {
      status: "success",
      output: { contact: contact.output, booking: booking.output },
      expected: { booked: true },
    };
  },
};

export default waterTestPlugin;
