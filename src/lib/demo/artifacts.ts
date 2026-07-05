import type { CompanyProfile, DemoProofArtifacts } from "@/lib/demo/types"

export function buildProofArtifacts(profile: CompanyProfile): DemoProofArtifacts {
  if (profile.workflowType === "water_treatment") {
    return {
      workflowType: profile.workflowType,
      intakeSummary: {
        caller: "Jennifer",
        client: "142 Millbrook Road, Harrisonburg VA",
        concern: "Sulfur smell and hard water",
        safetyRisk: "Well water",
        issueType: "Water softener and whole-house filtration",
        immediateDanger: "Within the next few weeks",
        callback: "Afternoon callback preferred",
        status: "Ready for CSR follow-up",
      },
      alertPreview: {
        to: "CSR / sales team",
        message:
          "Water treatment lead captured. Homeowner is on well water and reports sulfur smell plus hard water. Interested in softener and whole-house filtration. Timeline and callback preference captured. Ready for CSR follow-up.",
        timestamp: "Water treatment lead event",
        delivery: "Under 60 seconds target",
      },
      crmUpdate: {
        record: "New water treatment lead created",
        fieldsMapped: [
          "Caller name",
          "Callback",
          "Address",
          "Water source",
          "Water concern",
          "System interest",
          "Timeline",
          "Follow-up owner",
        ],
        status: "Ready for CSR follow-up",
        priority: "Standard",
        issueType: "Water treatment lead",
        source: "Voice AI",
      },
      dashboardEvent: {
        responseTime: "Under 60 seconds target",
        intakeCaptured: "Yes",
        followUpNeeded: "Yes",
        humanOwner: "CSR / sales team",
        auditTrail: "Yes",
      },
    }
  }

  return {
    workflowType: profile.workflowType,
    intakeSummary: {
      caller: "Sarah",
      client: "142 Millbrook Road, Harrisonburg VA",
      concern: "No water - pump failure suspected",
      safetyRisk: "Possible pump or pressure switch failure",
      issueType: "Submersible well pump, pressure tank",
      immediateDanger: "No immediate danger reported",
      callback: "Collected",
      status: "Ready for on-call dispatch",
    },
    alertPreview: {
      to: "On-call dispatch",
      message:
        "Well pump emergency captured. Whole house without water since 11pm. Pressure tank reads zero; submersible pump issue suspected. Family of 4 affected, no immediate danger reported. Ready for on-call dispatch.",
      timestamp: "Emergency dispatch event",
      delivery: "Under 60 seconds target",
    },
    crmUpdate: {
      record: "New lead created",
      fieldsMapped: [
        "Caller name",
        "Service address",
        "No-water / low-pressure issue",
        "Whole-house or partial",
        "Since when",
        "Safety screen",
        "People affected",
        "Equipment context",
        "Callback number",
      ],
      status: "Ready for on-call dispatch",
      priority: "High",
      issueType: "well pump",
      source: "Voice AI",
    },
    dashboardEvent: {
      responseTime: "Under 60 seconds target",
      intakeCaptured: "Yes",
      followUpNeeded: "Yes",
      humanOwner: "On-call dispatch",
      auditTrail: "Yes",
    },
  }
}
