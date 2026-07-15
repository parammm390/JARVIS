// Stateful local marketing emulator — models ad-campaign launch (fault-injecting), for
// domains with no real write-scope adapter yet. Review-request sending reuses the CRM
// domain's send-message emulator directly (packages/tools/src/emulators/crm-emulator.ts)
// since it's the identical shape (send a message to a contact) — not reinvented here.

import { makeFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface LaunchAdCampaignInput {
  tenantId: string;
  name: string;
  dailyBudgetUsd: number;
  objective?: string;
  targetZip?: string;
  idempotencyKey: string;
}
export interface LaunchAdCampaignOutput {
  campaignId: string;
  mode: "dry_run" | "live";
}

const launchedCampaigns = new Map<string, LaunchAdCampaignOutput>();
let injectFaults = makeFaultInjector();

export function configureMarketingEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

export function resetMarketingEmulator(): void {
  launchedCampaigns.clear();
  injectFaults = makeFaultInjector();
}

export async function emulatorLaunchAdCampaign(input: LaunchAdCampaignInput): Promise<LaunchAdCampaignOutput> {
  await injectFaults();
  const existing = launchedCampaigns.get(input.idempotencyKey);
  if (existing) return existing;
  const result: LaunchAdCampaignOutput = { campaignId: input.idempotencyKey, mode: "dry_run" };
  launchedCampaigns.set(input.idempotencyKey, result);
  return result;
}
