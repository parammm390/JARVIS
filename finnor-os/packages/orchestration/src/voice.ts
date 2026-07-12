// Voice-native confirmation layer: pure functions for parsing spoken decisions and
// building the sentences Vapi speaks. Pure = unit-testable without any Vapi account.

/**
 * Parse a spoken yes/no from a call transcript. The LAST clear signal wins, because
 * people change their mind mid-sentence ("hmm, no wait — yes, go ahead").
 * Anything ambiguous is "unclear" — an unclear answer NEVER approves (fail-closed).
 */
export function parseSpokenDecision(transcript: string): "approve" | "reject" | "unclear" {
  const t = ` ${transcript.toLowerCase()} `;
  const approvePatterns =
    /\b(yes|yeah|yep|yup|approve|approved|confirm|confirmed|go ahead|do it|send it|book it|sounds good|that works|absolutely|sure|correct|okay|ok)\b/g;
  const rejectPatterns =
    /\b(no|nope|nah|don't|do not|cancel|reject|rejected|stop|hold off|not now|never mind|nevermind|wait|skip it)\b/g;

  let lastApprove = -1;
  let lastReject = -1;
  for (const m of t.matchAll(approvePatterns)) lastApprove = m.index ?? -1;
  for (const m of t.matchAll(rejectPatterns)) lastReject = m.index ?? -1;

  if (lastApprove === -1 && lastReject === -1) return "unclear";
  if (lastApprove > lastReject) return "approve";
  if (lastReject > lastApprove) return "reject";
  return "unclear";
}

const INTEGRATION_NAMES: Record<string, string> = {
  ghl: "GoHighLevel (your CRM)",
  vapi: "Vapi (your phone system)",
  groq: "the AI planning service",
  accounting: "your accounting system",
  exa: "the web search service",
  redis: "the session memory service",
};

/**
 * Turn a typed integration failure into the exact sentence to speak to the owner —
 * names WHICH integration failed and asks for the fix (§ spoken failure diagnosis).
 */
export function diagnoseFailure(error: string | undefined, actionType: string): string {
  const readable = actionType.replaceAll("_", " ");
  const match = error?.match(/\[(\w+)\]/);
  const integration = match ? INTEGRATION_NAMES[match[1]!] ?? match[1]! : null;
  if (error && /API_KEY is not set|credential|unauthorized|401|403/i.test(error) && integration) {
    return `Heads up — I couldn't finish "${readable}" because the ${integration} key isn't working. Want to give me a working one and I'll retry?`;
  }
  if (integration) {
    return `Heads up — I couldn't finish "${readable}" because ${integration} isn't responding. I've parked it in your review queue and won't retry until you say so.`;
  }
  return `Heads up — "${readable}" hit a problem: ${error ?? "unknown error"}. It's waiting in your review queue.`;
}

/** The sentence Vapi reads before capturing the spoken yes/no. */
export function buildConfirmationScript(summary: string): string {
  return `${summary} — Say yes to approve, or no to reject.`;
}
