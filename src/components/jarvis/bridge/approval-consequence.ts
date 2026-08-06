// Consequence copy for the Instruction Thread's approval header.
//
// This is deliberately conservative: a consequence is stated only when the
// action type/payload actually carries the fact. Unknown action types fall back
// to the operation name instead of inheriting the old invoice/customer-texting
// language from the golden journey.

export interface ApprovalConsequenceAction {
  actionType: string
  payload: unknown
  amountUsd?: number | null
  targetLabel?: string | null
  policyVersion?: number | null
}

export interface ApprovalConsequenceSummary {
  actionCount: number
  /** Known only when every bulk-notify action carries its real targets array. */
  recipientCount: number | null
  /** Known only when every action in the plan carries an explicit amountUsd. */
  totalAmountUsd: number | null
  policyVersions: number[]
}

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function countTargets(payload: unknown): number | null {
  const targets = record(payload).targets
  return Array.isArray(targets) ? targets.length : null
}

function explicitAmountUsd(action: ApprovalConsequenceAction): number | null {
  if (typeof action.amountUsd === "number" && Number.isFinite(action.amountUsd)) return action.amountUsd
  const value = record(action.payload).amountUsd
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function channelLabel(value: unknown): { noun: string; verb: string } {
  switch (value) {
    case "sms":
    case "text":
      return { noun: "SMS", verb: "texted" }
    case "email":
      return { noun: "email", verb: "emailed" }
    case "call":
    case "phone":
      return { noun: "call", verb: "called" }
    default:
      return { noun: "message", verb: "contacted" }
  }
}

export function bulkNotifyDelivery(payload: unknown): { noun: string; verb: string } {
  return channelLabel(record(payload).channel)
}

function humanizeActionType(actionType: string): string {
  return actionType.replace(/^start_/, "").replace(/_workflow$/, "").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

function firstLetterLower(value: string): string {
  return value.replace(/^./, (c) => c.toLowerCase())
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
}

function dateOnly(value: unknown): string | null {
  const raw = text(value)
  return raw ? raw.slice(0, 10) : null
}

/** One action's real, action-type-specific consequence. */
export function describeApprovalConsequence(action: ApprovalConsequenceAction): string {
  const p = record(action.payload)
  const target = action.targetLabel ?? text(p.householdLabel) ?? text(p.customerName)

  switch (action.actionType) {
    case "bulk_notify_existing_customers": {
      const count = countTargets(action.payload)
      const delivery = bulkNotifyDelivery(action.payload)
      return count === null
        ? `An unknown number of customers will be ${delivery.verb}.`
        : `${count} customer${count === 1 ? "" : "s"} will be ${delivery.verb} via ${delivery.noun}.`
    }
    case "start_invoice_to_cash_workflow":
      return `Create a payment link, send it to the customer, and sync the invoice${text(p.invoiceId) ? ` ${text(p.invoiceId)!.slice(0, 8)}` : ""}.`
    case "create_invoice":
      return `Create an invoice${target ? ` for ${target}` : ""}${typeof p.amountUsd === "number" ? ` for ${formatUsd(p.amountUsd)}` : ""}.`
    case "record_payment":
      return `Record a payment${text(p.invoiceId) ? ` for invoice ${text(p.invoiceId)!.slice(0, 8)}` : ""}${typeof p.amountUsd === "number" ? ` of ${formatUsd(p.amountUsd)}` : ""}.`
    case "send_payment_reminder":
      return `Send a payment reminder${text(p.invoiceId) ? ` for invoice ${text(p.invoiceId)!.slice(0, 8)}` : ""}.`
    case "call_overdue_invoices":
      return "Call the overdue-invoice list."
    case "start_water_test_workflow":
      return `Hold a water test appointment${dateOnly(p.scheduledAt) ? ` on ${dateOnly(p.scheduledAt)}` : ""} and send a confirmation${text(p.phoneNumber) ? ` to ${text(p.phoneNumber)}` : " to the customer"}.`
    case "schedule_water_test":
      return `Schedule a water test${dateOnly(p.scheduledAt) ? ` on ${dateOnly(p.scheduledAt)}` : ""}${target ? ` for ${target}` : ""}.`
    case "assign_technician_to_visit":
      return `Assign ${text(p.technicianName) ?? "a technician"} to the visit.`
    case "check_technician_availability":
      return `Check technician availability${dateOnly(p.date) ? ` for ${dateOnly(p.date)}` : ""}.`
    case "reschedule_visit":
      return `Move the visit${dateOnly(p.scheduledAt) ? ` to ${dateOnly(p.scheduledAt)}` : ""}.`
    case "route_suggestion":
      return `Review the ${dateOnly(p.date) ?? "requested"} route suggestion; no visit is changed yet.`
    case "generate_quote":
      return `Generate a quote${target ? ` for ${target}` : ""}.`
    case "size_equipment_for_household":
      return `Size equipment${target ? ` for ${target}` : " for the household"}.`
    case "send_proposal":
      return `Send the proposal${text(p.proposalId) ? ` ${text(p.proposalId)!.slice(0, 8)}` : ""} for signature or review.`
    case "request_proposal_signature":
      return `Send the proposal${text(p.proposalId) ? ` ${text(p.proposalId)!.slice(0, 8)}` : ""} to ${text(p.signerName) ?? "the signer"} for signature.`
    case "send_customer_message": {
      const delivery = channelLabel(p.channel)
      return `Send a ${delivery.noun}${text(p.phone) || text(p.email) ? ` to ${text(p.phone) ?? text(p.email)}` : target ? ` to ${target}` : " to the customer"}.`
    }
    case "send_follow_up":
      return `Send a follow-up${text(p.phone) ? ` to ${text(p.phone)}` : target ? ` to ${target}` : " to the customer"}.`
    case "create_review_request":
      return `Send a review request to ${text(p.contactName) ?? "the contact"}.`
    case "launch_ad_campaign":
      return `Launch the ${text(p.name) ? `“${text(p.name)}” ` : ""}ad campaign${typeof p.dailyBudgetUsd === "number" ? ` at ${formatUsd(p.dailyBudgetUsd)}/day` : ""}.`
    case "start_installation_workflow":
      return `Start installation${text(p.sku) ? ` with ${p.quantity ?? 1}× ${text(p.sku)}` : ""}${typeof p.depositAmountUsd === "number" ? ` and collect a ${formatUsd(p.depositAmountUsd)} deposit` : ""}.`
    case "renew_maintenance_agreement":
      return `Renew the maintenance agreement${target ? ` for ${target}` : ""}.`
    case "log_visit_report":
      return `Log the visit report${p.markCompleted === true ? " and mark the visit complete" : ""}.`
    case "flag_visit_issue":
      return "Flag the visit issue for the owner's review."
    case "generate_compliance_summary":
      return `Generate a water-quality compliance summary${target ? ` for ${target}` : ""}.`
    case "check_stock_level":
      return "Read the current stock level; no stock is changed."
    case "flag_reorder_needed":
      return "Flag the item for reorder review; stock is not changed yet."
    case "log_stock_used_on_visit":
      return "Record stock used on the visit."
    case "check_reminder_due":
      return `Check whether the ${text(p.equipmentType)?.replaceAll("_", " ") ?? "equipment"} is due for service.`
    case "search_web":
    case "scan_competitors":
    case "check_business_reviews":
      return `Read ${humanizeActionType(action.actionType).toLowerCase()} results; no business record is changed.`
    case "get_business_overview":
    case "answer_business_question":
    case "answer_customer_question":
    case "answer_water_question":
      return `Read and answer the requested question; no external message is sent.`
    case "summarize_ad_performance":
      return `Read ad performance${typeof p.windowDays === "number" ? ` for the last ${p.windowDays} days` : ""}.`
    case "create_lead":
      return `Create a lead${target ? ` for ${target}` : ""}.`
    case "update_lead_status":
      return `Update the lead status${text(p.status) ? ` to ${text(p.status)}` : ""}.`
    case "log_interaction":
      return "Record the customer interaction."
    case "assign_lead_to_technician":
      return `Assign the lead to ${text(p.technicianName) ?? "a technician"}.`
    case "send_proposal_to_recent_installs":
      return "Send the proposal offer to the matching recent installs."
    case "manual_step":
    case "manual_review":
    case "manual_step_suggestion":
      return "Create a manual review step; no provider call is predicted."
    default:
      return `Run ${humanizeActionType(action.actionType)}.`
  }
}

/** Compact, grouped lines for the approval header and voice prompt. */
export function approvalConsequenceLines(actions: readonly ApprovalConsequenceAction[]): string[] {
  if (actions.length === 0) return []
  const descriptions = actions.map(describeApprovalConsequence)
  const groups = new Map<string, { count: number; description: string }>()
  for (let i = 0; i < actions.length; i += 1) {
    const key = `${actions[i]!.actionType}::${descriptions[i]!}`
    const current = groups.get(key)
    groups.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, description: descriptions[i]! })
  }
  return [...groups.values()].map(({ count, description }) => (count === 1 ? description : `${count}× ${firstLetterLower(description)}`))
}

/**
 * Facts for the Gate Rise header. Each aggregate is withheld unless its source
 * shape is complete enough to describe without guessing. The caller may still
 * render the action-specific consequence lines when an aggregate is unknown.
 */
export function approvalConsequenceSummary(actions: readonly ApprovalConsequenceAction[]): ApprovalConsequenceSummary {
  const bulkActions = actions.filter((action) => action.actionType === "bulk_notify_existing_customers")
  const targetCounts = bulkActions.map((action) => countTargets(action.payload))
  const recipientCount = bulkActions.length > 0 && targetCounts.every((count): count is number => count !== null)
    ? targetCounts.reduce((sum, count) => sum + count, 0)
    : null

  const amounts = actions.map(explicitAmountUsd)
  const totalAmountUsd = amounts.length > 0 && amounts.every((amount): amount is number => amount !== null)
    ? amounts.reduce((sum, amount) => sum + amount, 0)
    : null

  const policyVersions = [...new Set(actions.map((action) => action.policyVersion).filter((version): version is number => typeof version === "number"))].sort((a, b) => a - b)
  return { actionCount: actions.length, recipientCount, totalAmountUsd, policyVersions }
}

export function approvalConsequencePrompt(actions: readonly ApprovalConsequenceAction[]): string {
  const lines = approvalConsequenceLines(actions)
  if (lines.length === 0) return "No action details are available yet."
  return `${actions.length} action${actions.length === 1 ? "" : "s"} need your approval. ${lines.join(" ")}`
}
