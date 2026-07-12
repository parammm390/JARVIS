import { describe, it, expect } from "vitest";
import { parseSpokenDecision, diagnoseFailure, buildConfirmationScript } from "../../packages/orchestration/src/voice";

describe("parseSpokenDecision (voice confirmation parse path)", () => {
  it("clear approvals", () => {
    for (const t of ["yes", "Yeah go ahead", "yep, send it", "approve it", "sounds good, book it", "OK do it"]) {
      expect(parseSpokenDecision(t), t).toBe("approve");
    }
  });
  it("clear rejections", () => {
    for (const t of ["no", "Nope", "don't send that", "cancel it", "hold off for now", "no, not now"]) {
      expect(parseSpokenDecision(t), t).toBe("reject");
    }
  });
  it("the LAST clear signal wins when the caller changes their mind", () => {
    expect(parseSpokenDecision("hmm no wait — yes, go ahead")).toBe("approve");
    expect(parseSpokenDecision("yes... actually no, cancel that")).toBe("reject");
  });
  it("ambiguity fails closed — never approves", () => {
    for (const t of ["hmm let me think", "what was the price again?", "", "maybe later this week"]) {
      expect(parseSpokenDecision(t), t).toBe("unclear");
    }
  });
  it("does not false-match inside other words", () => {
    expect(parseSpokenDecision("I know the address")).toBe("unclear");
  });
});

describe("diagnoseFailure (spoken failure diagnosis)", () => {
  it("names the failing integration and asks for the fix on credential errors", () => {
    const s = diagnoseFailure("Could not reach the CRM: [ghl] GOHIGHLEVEL_API_KEY is not set", "schedule_water_test");
    expect(s).toContain("GoHighLevel");
    expect(s.toLowerCase()).toContain("key");
    expect(s).toContain("schedule water test");
  });
  it("names the integration on outage errors without asking for a key", () => {
    const s = diagnoseFailure("[vapi] timed out after 15000ms", "bulk_notify_existing_customers");
    expect(s).toContain("Vapi");
    expect(s.toLowerCase()).toContain("review queue");
  });
  it("degrades gracefully with no integration tag", () => {
    const s = diagnoseFailure(undefined, "create_invoice");
    expect(s).toContain("create invoice");
  });
});

describe("buildConfirmationScript", () => {
  it("appends the yes/no ask", () => {
    expect(buildConfirmationScript("Send 3 proposals.")).toMatch(/yes to approve.*no to reject/i);
  });
});
