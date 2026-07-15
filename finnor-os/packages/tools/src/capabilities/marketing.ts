// Marketing/reviews capability contract (Phase 3 domain 3 of 5). `launch_ad_campaign`'s
// "real" binding is today's actual, honestly-labeled dry-run behavior
// (packages/tools/src/ads-write.ts) — no live write-scope OAuth exists anywhere for
// Meta/Google Ads (app review not completed), so pretending otherwise would be
// dishonest; `dry_run` IS the real production behavior right now, not a stand-in for
// it. `send_review_request` reuses the CRM domain's send-message shape directly (same
// underlying native/ghl logic) since a review request is just a message to a contact.

import { z } from "zod";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { launchAdCampaign } from "../ads-write";
import { emulatorLaunchAdCampaign, type LaunchAdCampaignInput, type LaunchAdCampaignOutput } from "../emulators/marketing-emulator";
import {
  sendMessageContract,
  sendMessageNativeBinding,
  sendMessageGhlBinding,
  sendMessageEmulatorBinding,
  type SendMessageInput,
  type SendMessageOutput,
} from "./crm";

export type { LaunchAdCampaignInput, LaunchAdCampaignOutput };
export type SendReviewRequestInput = SendMessageInput;
export type SendReviewRequestOutput = SendMessageOutput;

export const LaunchAdCampaignInputSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  dailyBudgetUsd: z.number().positive(),
  objective: z.string().optional(),
  targetZip: z.string().optional(),
  idempotencyKey: z.string().min(1),
});
export const LaunchAdCampaignOutputSchema = z.object({ campaignId: z.string(), mode: z.enum(["dry_run", "live"]) });

const RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 250, timeoutMs: 10_000 };

// --- launch_ad_campaign ---------------------------------------------------------

export const launchAdCampaignContract: CapabilityContract<LaunchAdCampaignInput, LaunchAdCampaignOutput> = {
  domain: "marketing",
  capability: "launch_ad_campaign",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "marketing:launch_ad_campaign",
  piiAllowlist: ["name", "dailyBudgetUsd", "objective", "targetZip"],
  retryOnUnknown: true, // dry-run is idempotent by construction; a real launch would need its own idempotency key support from the provider before this could be true — tracked when write-scope credentials land
};

export const launchAdCampaignEmulatorBinding: CapabilityBinding<LaunchAdCampaignInput, LaunchAdCampaignOutput> = {
  name: "emulator",
  call: emulatorLaunchAdCampaign,
};

export const launchAdCampaignDryRunBinding: CapabilityBinding<LaunchAdCampaignInput, LaunchAdCampaignOutput> = {
  name: "dry_run",
  async call(input) {
    const result = await launchAdCampaign({
      name: input.name,
      dailyBudgetUsd: input.dailyBudgetUsd,
      objective: input.objective,
      targetZip: input.targetZip,
    });
    return { campaignId: input.idempotencyKey, mode: result.mode };
  },
};

// --- send_review_request ---------------------------------------------------------
// Identical contract shape to CRM's send_message — reused, not reimplemented.

export const sendReviewRequestContract: CapabilityContract<SendReviewRequestInput, SendReviewRequestOutput> = {
  ...sendMessageContract,
  domain: "marketing",
  capability: "send_review_request",
};

export const sendReviewRequestNativeBinding: CapabilityBinding<SendReviewRequestInput, SendReviewRequestOutput> = sendMessageNativeBinding;
export const sendReviewRequestGhlBinding: CapabilityBinding<SendReviewRequestInput, SendReviewRequestOutput> = sendMessageGhlBinding;
export const sendReviewRequestEmulatorBinding: CapabilityBinding<SendReviewRequestInput, SendReviewRequestOutput> = sendMessageEmulatorBinding;
