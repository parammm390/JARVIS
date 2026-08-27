/**
 * Permanent browser certification corpus for the Product Truth closure.
 *
 * These are deliberately product journeys, rather than backend fixture names.
 * The deployed cert runner materialises each instruction in a real authenticated
 * browser, submits it through the visible rail or Command Palette, and then
 * compares the resulting pixels with the tenant-scoped Work projection. A row
 * may accept more than one execution model only when the route policy explicitly
 * permits a safe recovery/clarification outcome (for example an empty planner
 * result); the runner still records the actual model returned by the API.
 */

export const GOLDEN_JOURNEY_IDS = Object.freeze([
  "hello",
  "deterministic-business-query",
  "atomic-email",
  "atomic-crm",
  "empty-atomic-plan",
  "lookup-email-objective",
  "multi-step-objective",
  "approval-required",
  "approval-continuation",
  "external-wait",
  "external-wake",
  "blocked-objective",
  "provider-unavailable",
  "ambiguous-customer",
  "cancel-during-planning",
  "cancel-worker-active",
  "redirect-objective",
  "interrupt-resume-objective",
  "refresh-mid-objective",
  "recent-thread-objective",
  "worker-restart-objective",
  "realtime-disconnect-reconnect",
  "realtime-polling-fallback",
  "idempotency-replay",
  "failed-action-recovery",
  "completed-verified-outcome",
  "computer-write-approval-gate",
  "cross-tenant-denial",
  "command-palette",
  "legacy-operational-view",
])

/**
 * `instruction` uses `{nonce}` so a release can run repeatedly against one
 * tenant without ever accidentally replaying an earlier row. `expectedModels`
 * is intentionally strict for ordinary rows. The two recovery rows that can
 * legitimately fail closed accept the explicit canonical alternatives listed
 * here, never an untyped/empty HTTP response.
 */
export const GOLDEN_JOURNEYS = Object.freeze([
  { id: "hello", entrypoint: "rail", expectedModels: ["CONVERSATION"], instruction: "Hello JARVIS. Confirm this certification session is connected. {nonce}" },
  { id: "deterministic-business-query", entrypoint: "rail", expectedModels: ["QUERY"], instruction: "How many overdue invoices are currently in the canonical ledger? Read only: do not send, update, approve, or execute anything. {nonce}" },
  { id: "atomic-email", entrypoint: "rail", expectedModels: ["ATOMIC_EFFECT"], instruction: "Send this exact certification message to certification@example.invalid: Product Truth atomic email {nonce}" },
  { id: "atomic-crm", entrypoint: "rail", expectedModels: ["ATOMIC_EFFECT"], instruction: "Update the CRM record for certification@example.invalid with marker {nonce}" },
  { id: "empty-atomic-plan", entrypoint: "rail", expectedModels: ["CONVERSATION", "OBJECTIVE"], instruction: "Send this exact message to certification@example.invalid and return no executable actions {nonce}" },
  { id: "lookup-email-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], instruction: "Look up the certification customer and then email the verified contact a status note. {nonce}" },
  { id: "multi-step-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], instruction: "Inspect the certification account, then verify its open work, and finally report the result. {nonce}" },
  { id: "approval-required", entrypoint: "rail", expectedModels: ["OBJECTIVE"], instruction: "Prepare a certification customer message and wait for my approval before sending it. {nonce}" },
  { id: "approval-continuation", entrypoint: "rail", expectedModels: ["OBJECTIVE"], instruction: "Prepare the certification customer message, obtain approval, then verify the observed delivery outcome. {nonce}" },
  // Special rows are not prompt-only claims. `fixture` causes the certifier to
  // inject a deterministic state transition into the submitted Work through the
  // keyed certification endpoint, while `canonicalAssertion` selects the durable
  // Work/Objective evidence that must be present in the resulting projection.
  { id: "external-wait", entrypoint: "rail", expectedModels: ["OBJECTIVE"], fixture: "external-wait", canonicalAssertion: "external-wait", instruction: "Wait for the external certification response before deciding whether this objective is complete. {nonce}" },
  { id: "external-wake", entrypoint: "rail", expectedModels: ["OBJECTIVE"], fixture: "external-wake", canonicalAssertion: "external-wake", instruction: "Wait for and resume after the external certification event, then verify the objective. {nonce}" },
  { id: "blocked-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], fixture: "blocked-objective", canonicalAssertion: "blocked-objective", instruction: "Own this certification objective, but stop in a blocked state if the required integration is unavailable. {nonce}" },
  { id: "provider-unavailable", entrypoint: "rail", expectedModels: ["OBJECTIVE"], fixture: "provider-unavailable", canonicalAssertion: "provider-unavailable", instruction: "Recover from a certification provider outage and report the integration state without claiming delivery. {nonce}" },
  { id: "ambiguous-customer", entrypoint: "rail", expectedModels: ["OBJECTIVE", "ATOMIC_EFFECT", "CONVERSATION"], instruction: "Find the customer named Alex and ask me which canonical record to use. {nonce}" },
  { id: "cancel-during-planning", entrypoint: "rail", expectedModels: ["OBJECTIVE"], control: "cancel", instruction: "Own this long-running certification objective and cancel it if planning is still in progress. {nonce}" },
  { id: "cancel-worker-active", entrypoint: "rail", expectedModels: ["OBJECTIVE"], control: "cancel", instruction: "Run the certification objective, then cancel future execution while the worker is active. {nonce}" },
  { id: "redirect-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], control: "redirect", instruction: "Own the certification objective and keep working until its first verified checkpoint. {nonce}" },
  { id: "interrupt-resume-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], control: "interrupt-resume", instruction: "Coordinate the certification objective and pause safely whenever execution needs a human decision. {nonce}" },
  { id: "refresh-mid-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], refresh: true, instruction: "Own this certification objective across a page refresh and preserve its canonical state. {nonce}" },
  { id: "recent-thread-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], recent: true, instruction: "Own this certification objective and make it available from recent threads. {nonce}" },
  { id: "worker-restart-objective", entrypoint: "rail", expectedModels: ["OBJECTIVE"], workerRestart: true, instruction: "Keep this certification objective durable while the worker restarts, then report the canonical state. {nonce}" },
  { id: "realtime-disconnect-reconnect", entrypoint: "rail", expectedModels: ["OBJECTIVE"], reconnect: true, instruction: "Own this certification objective while realtime disconnects and reconnects; preserve one canonical Work. {nonce}" },
  { id: "realtime-polling-fallback", entrypoint: "rail", expectedModels: ["OBJECTIVE"], transport: "polling", instruction: "Own this certification objective while the realtime gateway is unavailable and bounded polling catches up. {nonce}" },
  { id: "idempotency-replay", entrypoint: "rail", expectedModels: ["CONVERSATION"], replay: true, instruction: "Hello JARVIS. This exact certification submission must be idempotent. {nonce}" },
  { id: "failed-action-recovery", entrypoint: "rail", expectedModels: ["OBJECTIVE"], fixture: "failed-action-recovery", canonicalAssertion: "failed-action-recovery", instruction: "Recover and reconcile the certification action after a failed provider attempt; do not claim success without evidence. {nonce}" },
  { id: "completed-verified-outcome", entrypoint: "rail", expectedModels: ["OBJECTIVE"], fixture: "completed-verified-outcome", canonicalAssertion: "completed-verified-outcome", instruction: "Complete the certification objective only after a verified canonical outcome and receipt are observed. {nonce}" },
  { id: "computer-write-approval-gate", entrypoint: "rail", expectedModels: ["OBJECTIVE"], control: "approval", instruction: "Prepare a certification computer WRITE behind approval; do not execute it until I decide. {nonce}" },
  { id: "cross-tenant-denial", entrypoint: "rail", expectedModels: ["OBJECTIVE"], crossTenant: true, instruction: "Own this certification objective and keep every Work projection tenant scoped. {nonce}" },
  { id: "command-palette", entrypoint: "palette", expectedModels: ["OBJECTIVE"], instruction: "Own this Command Palette certification objective and report its canonical Work identity. {nonce}" },
  { id: "legacy-operational-view", entrypoint: "legacy", expectedModels: ["OBJECTIVE"], instruction: "Own this legacy operational-view certification objective through the same canonical instruction path. {nonce}" },
])

export function materializeGoldenInstruction(row, nonce) {
  return row.instruction.replaceAll("{nonce}", nonce)
}

export function validateGoldenMatrix(rows = GOLDEN_JOURNEYS) {
  if (!Array.isArray(rows) || rows.length !== 30) throw new Error(`Product Truth golden matrix must contain exactly 30 journeys; received ${rows?.length ?? 0}`)
  const ids = rows.map((row) => row?.id)
  const expected = [...GOLDEN_JOURNEY_IDS]
  if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string")) throw new Error("Product Truth golden matrix contains duplicate or invalid journey ids")
  if (ids.some((id, index) => id !== expected[index])) throw new Error("Product Truth golden matrix order/coverage differs from the required 30-journey corpus")
  for (const row of rows) {
    if (!Array.isArray(row.expectedModels) || row.expectedModels.length === 0) throw new Error(`Golden journey ${row.id} has no expected execution model`) 
    if (!row.instruction?.includes("{nonce}")) throw new Error(`Golden journey ${row.id} must be nonce-scoped`)
    if (!["rail", "palette", "legacy"].includes(row.entrypoint)) throw new Error(`Golden journey ${row.id} has an invalid browser entrypoint`)
    if (row.transport && row.transport !== "polling") throw new Error(`Golden journey ${row.id} has an invalid transport mode`)
    const fixtureExpected = new Set(["external-wait", "external-wake", "blocked-objective", "provider-unavailable", "failed-action-recovery", "completed-verified-outcome"]).has(row.id)
    if (fixtureExpected && (row.fixture !== row.id || row.canonicalAssertion !== row.id)) throw new Error(`Golden journey ${row.id} must declare its deterministic fixture and canonical assertion`)
    if (!fixtureExpected && (row.fixture || row.canonicalAssertion)) throw new Error(`Golden journey ${row.id} cannot declare an unsupported fixture`)
  }
  return rows
}

validateGoldenMatrix()
