// Ad campaign WRITE access — distinct from the READ-scope insights key in ads.ts.
// Creating/pausing a real campaign needs Meta/Google's ads_management write scope,
// which requires a separate app-review approval nobody has gone through yet. Until
// that exists, every call returns a clearly-labeled dry-run result describing exactly
// what WOULD happen — never a silent no-op, never a fabricated "campaign created".
// The moment write credentials + review land, only the branch inside
// launchAdCampaign() below needs to change; no plugin/orchestrator code changes.

import { IntegrationError } from "./errors";

export interface CampaignLaunchInput {
  name: string;
  dailyBudgetUsd: number;
  objective?: string;
  targetZip?: string;
}

export interface CampaignLaunchResult {
  mode: "dry_run" | "live";
  provider: "meta" | "google_ads" | "none";
  note: string;
}

function adsWriteConfigured(): boolean {
  return process.env.META_ADS_WRITE_ENABLED === "1" || process.env.GOOGLE_ADS_WRITE_ENABLED === "1";
}

export function adsWriteProviderStatus(): { writeEnabled: boolean } {
  return { writeEnabled: adsWriteConfigured() };
}

export async function launchAdCampaign(input: CampaignLaunchInput): Promise<CampaignLaunchResult> {
  if (!adsWriteConfigured()) {
    return {
      mode: "dry_run",
      provider: "none",
      note:
        `[DRY RUN] Would create a "${input.objective ?? "leads"}" campaign named "${input.name}" at $${input.dailyBudgetUsd}/day` +
        (input.targetZip ? ` targeting ${input.targetZip}` : "") +
        `. No real ad-account write access is configured yet — nothing was sent to Meta or Google.`,
    };
  }
  // Write credentials being present is not the same as an app-reviewed, tested live
  // call existing — never silently no-op once someone flips the env var on.
  throw new IntegrationError("ads_write", "Ad write access is configured but the live campaign-creation call is not yet built.", false);
}
