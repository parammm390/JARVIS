export const WORKFLOW_TYPES = [
  "water_treatment",
  "well_pump_emergency",
] as const

export type DemoWorkflowType = (typeof WORKFLOW_TYPES)[number]

export const DEFAULT_WORKFLOW_TYPE: DemoWorkflowType = "water_treatment"

export const workflowDefinitions = {
  water_treatment: {
    label: "Water Treatment Lead Intake",
    shortLabel: "Water treatment",
    agentTitle: "Water Treatment Lead Intake AI",
    heroEyebrow: "Account-specific response workflow preview",
    heroDescription:
      "Choose the response workflow you want to test. FINNOR uses confirmed public information from your site to build a company-specific intake and handoff preview.",
    formDescription:
      "Quote requests, water tests, treatment system interest, timeline, and CSR or sales follow-up.",
    loadingStep: "Mapping water treatment lead intake",
    readyCopy:
      "Demo ready. Start the water treatment intake call below, then review the CSR handoff and structured lead record.",
    handoffStatus: "Ready for CSR follow-up",
    handoffTitle: "Water treatment lead captured",
    handoffTarget: "CSR / sales team",
    alertLabel: "Lead Alert",
    leadType: "Water treatment quote or consultation inquiry",
    priority: "Standard follow-up",
    firstMessage:
      "Thanks for calling {{company}}. This is Sarah. How can I help with your water today?",
    suggestedCallerPrompt:
      "Hi, I am looking into a water softener and maybe a whole-house filter. We are on well water, there is a sulfur smell, and I would like to understand the options.",
    consoleDescription:
      "The call captures the homeowner's contact details, water source, concern, system interest, timeline, and callback preference, then prepares a clean CSR or sales handoff without quoting prices or giving technical advice.",
    chips: [
      "Quote request",
      "Water test",
      "Softener / filtration / RO",
      "Water source",
      "Timeline",
      "CSR handoff",
    ],
    checklist: [
      "Caller name",
      "Callback number",
      "Address / service area",
      "Water source",
      "Water concern",
      "System interest",
      "Timeline",
      "Callback preference",
    ],
  },
  well_pump_emergency: {
    label: "Well Pump / No-Water Emergency Dispatch",
    shortLabel: "Emergency dispatch",
    agentTitle: "Well Pump Emergency Dispatch AI",
    heroEyebrow: "Account-specific response workflow preview",
    heroDescription:
      "Choose the response workflow you want to test. FINNOR uses confirmed public information from your site to build a company-specific intake and handoff preview.",
    formDescription:
      "No-water, low-pressure, pump, and pressure tank calls with on-call technician routing.",
    loadingStep: "Mapping emergency dispatch logic",
    readyCopy:
      "Demo ready. Start the no-water emergency call below, then review the on-call dispatch alert and technician handoff.",
    handoffStatus: "Ready for on-call dispatch",
    handoffTitle: "Well pump emergency captured",
    handoffTarget: "On-call dispatch",
    alertLabel: "Dispatch Alert",
    leadType: "Well pump / no-water emergency",
    priority: "High priority",
    firstMessage:
      "Thanks for calling {{company}} emergency dispatch. This is Sarah. What's happening with your water?",
    suggestedCallerPrompt:
      "Hi, our whole house has had no water since 11 PM. The pressure tank reads zero, and I think the submersible well pump may have stopped working.",
    consoleDescription:
      "The call captures the no-water or low-pressure issue, whether it affects the whole property, when it started, service address, callback number, people affected, safety risk, and known equipment context for an on-call technician handoff.",
    chips: [
      "No water",
      "Low pressure",
      "Pump / pressure tank",
      "Whole-house or partial",
      "Safety screen",
      "On-call dispatch",
    ],
    checklist: [
      "Caller name",
      "Callback number",
      "Service address",
      "No-water / low-pressure issue",
      "Whole-house or partial",
      "Since when",
      "People affected",
      "Safety screen",
    ],
  },
} as const

export function isDemoWorkflowType(value: unknown): value is DemoWorkflowType {
  return typeof value === "string" && WORKFLOW_TYPES.includes(value as DemoWorkflowType)
}

export function getWorkflowDefinition(workflowType: DemoWorkflowType) {
  return workflowDefinitions[workflowType]
}
