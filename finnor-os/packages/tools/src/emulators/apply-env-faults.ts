// A3.T4: applies EMULATOR_FAULTS=<capability>:<mode>,... at process boot, turning
// each named emulator into an adversarial double for exactly the capabilities an
// operator names — everything else keeps its normal (no-fault) profile. Safe to call
// unconditionally (a no-op with EMULATOR_FAULTS unset); safe to call more than once
// (each call just re-applies the same parsed config).

import { parseEmulatorFaultsEnv, type FaultInjectionConfig } from "./fault-injection";
import { configureCrmEmulator } from "./crm-emulator";
import { configureSchedulingEmulator } from "./scheduling-emulator";
import { configureCommunicationsEmulator } from "./communications-emulator";
import { configureDocumentsEmulator } from "./documents-emulator";
import { configureAccountingEmulator } from "./accounting-emulator";
import { configureMarketingEmulator } from "./marketing-emulator";
import { configureInventoryEmulator } from "./inventory-emulator";

const CONFIGURERS: Record<string, (config: FaultInjectionConfig) => void> = {
  crm: configureCrmEmulator,
  scheduling: configureSchedulingEmulator,
  communications: configureCommunicationsEmulator,
  documents: configureDocumentsEmulator,
  accounting: configureAccountingEmulator,
  marketing: configureMarketingEmulator,
  inventory: configureInventoryEmulator,
};

/** Returns the capabilities it actually applied a fault profile to, so the caller can
 *  log it (never a silent, invisible change to production emulator behavior). */
export function applyEmulatorFaultsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const parsed = parseEmulatorFaultsEnv(env.EMULATOR_FAULTS);
  const applied: string[] = [];
  for (const [capability, config] of parsed) {
    const configure = CONFIGURERS[capability];
    if (!configure) continue;
    configure(config);
    applied.push(capability);
  }
  return applied;
}
