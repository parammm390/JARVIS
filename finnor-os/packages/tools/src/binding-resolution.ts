// A1.T2/T3: single source of truth for "which implementation does this capability
// actually call right now, and why" — shared by apps/worker/src/handlers/run-workflow-step.ts
// (picks the real CapabilityBinding object) and apps/api's /api/setup/status (reports it).
// Two different resolution shapes, by design:
//  - Finnor-owned capabilities (scheduling/documents/inventory/crm) have no external SaaS
//    behind "native" — it's Finnor's own Postgres tables — so native is the default and
//    emulator is the explicit opt-out (A1.T2 inverted this from the old emulator-default).
//  - External capabilities (communications/esign/accounting/payments/marketing) call a
//    real third-party vendor when opted in, so emulator stays the safe default.

export type BindingMode = "native" | "emulator" | "ghl" | "vapi" | "docusign" | "quickbooks" | "stripe" | "dry_run";

export interface BindingResolution {
  mode: BindingMode;
  source: "env" | "default";
}

function resolveOwned(envValue: string | undefined): BindingResolution {
  if (!envValue) return { mode: "native", source: "default" };
  return { mode: envValue as BindingMode, source: "env" }; // "emulator" (opt-out) or e.g. crm's "ghl"
}

function resolveExternal(envValue: string | undefined, realMode: BindingMode): BindingResolution {
  if (!envValue) return { mode: "emulator", source: "default" };
  return { mode: envValue === realMode ? realMode : (envValue as BindingMode), source: "env" };
}

export interface CapabilityBindingsReport {
  scheduling: BindingResolution;
  documents: BindingResolution;
  inventory: BindingResolution;
  crm: BindingResolution;
  communications: BindingResolution;
  esign: BindingResolution;
  accounting: BindingResolution;
  payments: BindingResolution;
  marketing: BindingResolution;
}

export function resolveCapabilityBindings(env: NodeJS.ProcessEnv = process.env): CapabilityBindingsReport {
  return {
    scheduling: resolveOwned(env.SCHEDULING_BINDING),
    documents: resolveOwned(env.DOCUMENTS_BINDING),
    inventory: resolveOwned(env.INVENTORY_BINDING),
    crm: resolveOwned(env.CRM_BINDING),
    communications: resolveExternal(env.COMMUNICATIONS_BINDING, "vapi"),
    esign: resolveExternal(env.ESIGN_BINDING, "docusign"),
    accounting: resolveExternal(env.ACCOUNTING_BINDING, "quickbooks"),
    payments: resolveExternal(env.PAYMENTS_BINDING, "stripe"),
    marketing: resolveExternal(env.MARKETING_BINDING, "dry_run"),
  };
}
