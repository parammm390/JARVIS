// Real email via Resend (A3.T5) — Finnor-the-company's OWN outbound channel (win-back
// nudges, digests, alerts) on the finnorai.com domain. Distinct from email.ts's Gmail
// SMTP tool, which sends as the DEALER's own account to THEIR customers/vendors — this
// one is Finnor sending to a dealer/prospect. Pre-launch safety rail: with zero real
// dealers live yet, the recipient allowlist is enforced INSIDE this adapter (not just
// at whatever call site happens to use it, which a future caller could bypass) —
// anything outside *@finnorai.com or the configured owner address is a blocked,
// honestly-reported non-send, never silently dropped and never routed around.

import { IntegrationError } from "./errors";
import { claimBudget } from "./provider-budget";
import { withCircuitBreaker } from "./provider-circuit-breaker";

const RESEND_API_URL = "https://api.resend.com/emails";

// win-back safety: deliberately small and explicit, not "however many the planner
// wants" — matches the plan's own "volume caps consistent with win-back safety" ask.
// Read live (not cached at import time) so it's actually testable/tunable at runtime.
function dailyResendCap(): number {
  return Number(process.env.RESEND_DAILY_CAP ?? 50);
}

type FetchLike = typeof fetch;
let fetchOverride: FetchLike | null = null;
/** Tests inject a stub fetch here; production uses the real global fetch. Same
 *  pattern as email.ts's setEmailTransportForTesting. */
export function setResendFetchForTesting(f: FetchLike | null): void {
  fetchOverride = f;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? "Finnor <notifications@finnorai.com>";
}

/** *@finnorai.com (any internal address) or the one configured owner address —
 *  RESEND_ALLOWLIST_OWNER_EMAIL, never hardcoded into source (an owner's personal
 *  address is config, not code). Exported so callers can pre-check without spending a
 *  budget claim on a recipient that would be blocked anyway. */
export function isAllowlistedRecipient(to: string): boolean {
  const lower = to.trim().toLowerCase();
  if (lower.endsWith("@finnorai.com")) return true;
  const owner = process.env.RESEND_ALLOWLIST_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(owner) && lower === owner;
}

export interface ResendSendInput {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
}

export type ResendSendResult = { sent: true; messageId: string } | { sent: false; blocked: true; reason: string };

export async function sendResendEmail(input: ResendSendInput): Promise<ResendSendResult> {
  if (!isAllowlistedRecipient(input.to)) {
    return {
      sent: false,
      blocked: true,
      reason: `recipient ${input.to} is not on the pre-launch allowlist (*@finnorai.com, or the configured owner address)`,
    };
  }

  const budget = await claimBudget(input.tenantId, "resend", "email", dailyResendCap());
  if (!budget.allowed) {
    return { sent: false, blocked: true, reason: `daily Resend send cap reached (${budget.used}/${budget.cap})` };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new IntegrationError("resend", "RESEND_API_KEY is not set", false);

  const messageId = await withCircuitBreaker(
    "resend",
    async () => {
      const doFetch = fetchOverride ?? fetch;
      const res = await doFetch(RESEND_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromAddress(), to: [input.to], subject: input.subject, html: input.html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new IntegrationError("resend", `send failed: ${res.status} ${body}`, res.status >= 500 || res.status === 429);
      }
      const json = (await res.json()) as { id?: string };
      return json.id ?? "sent";
    },
    { tenantId: input.tenantId },
  );

  return { sent: true, messageId };
}

/** Configured-state only, same posture as ghlIntegrationStatus() — no cheap
 *  authenticated no-op exists on Resend's API to actively probe, so this never
 *  fabricates a healthy/unhealthy verdict it can't actually back up. */
export function resendProviderStatus(): { configured: boolean } {
  return { configured: Boolean(process.env.RESEND_API_KEY) };
}
