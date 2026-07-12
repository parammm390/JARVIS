// Maintenance Agreement domain plugin: renew_maintenance_agreement.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import { renderTemplate } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { RenewalPayloadSchema, MaintenanceAgreementPolicySchema } from "./policy.schema";

export * from "./policy.schema";

const ACTION = "renew_maintenance_agreement";

export const maintenanceAgreementPlugin: DomainEnginePlugin = {
  name: "maintenance-agreement",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: RenewalPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload, policy: DomainPolicy): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const errors: string[] = [];
    const p = RenewalPayloadSchema.safeParse(payload);
    if (!p.success) errors.push(...p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`));
    const pol = MaintenanceAgreementPolicySchema.safeParse(policy.policy);
    if (!pol.success) errors.push(...pol.error.issues.map((i) => `policy.${i.path.join(".")}: ${i.message}`));
    else if (p.success && !pol.data.cadence_options.includes(p.data.cadence)) {
      errors.push(`cadence ${p.data.cadence} is not offered by this dealer (allowed: ${pol.data.cadence_options.join(", ")})`);
    }
    return { valid: errors.length === 0, errors };
  },

  draft(actionType, payload, policy): DraftAction {
    const p = RenewalPayloadSchema.parse(payload);
    const template =
      policy.confirmationTemplate ??
      "Send a renewal offer to {{household}} for their {{cadence}} maintenance agreement. Approve?";
    const message =
      p.message ??
      `Hi! Your ${p.cadence.replace("_", "-")} water treatment maintenance plan is coming up for renewal. Reply YES to renew or call us with any questions.`;
    return {
      actionType,
      summary: renderTemplate(template, { household: p.householdLabel, cadence: p.cadence }),
      payload: { ...p, message, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const contact = await tools.call("ghl_create_contact", { phone: draft.payload.contactPhone, tenantId: draft.payload.tenantId });
    if (!contact.ok) {
      return {
        status: contact.integrationUnavailable ? "integration_unavailable" : "failure",
        output: {},
        error: `Could not reach the CRM: ${contact.error}`,
      };
    }
    const sms = await tools.call("ghl_send_sms", {
      contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
      message: String(draft.payload.message ?? ""),
      tenantId: draft.payload.tenantId,
    });
    if (!sms.ok) {
      return {
        status: sms.integrationUnavailable ? "integration_unavailable" : "failure",
        output: { contact: contact.output },
        error: `The renewal text could not be sent: ${sms.error}`,
      };
    }
    return { status: "success", output: { sms: sms.output }, expected: { sent: true } };
  },
};

export default maintenanceAgreementPlugin;
