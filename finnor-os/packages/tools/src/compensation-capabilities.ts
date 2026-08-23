import type { CapabilityBinding, CapabilityContract } from "@finnor/workflow-runtime";
import { EXECUTION_COMPENSATABLE_STEP_TYPES } from "@finnor/shared-types";
import {
  HoldAppointmentInputSchema,
  HoldAppointmentOutputSchema,
  emulatorSchedulingBinding,
  holdAppointmentContract,
  nativeSchedulingBinding,
} from "./capabilities/scheduling";
import {
  ReserveStockInputSchema,
  ReserveStockOutputSchema,
  reserveStockContract,
  reserveStockEmulatorBinding,
  reserveStockNativeBinding,
} from "./capabilities/inventory";
import { resolveCapabilityBindingsForTenant } from "./binding-resolution";

export const COMPENSATABLE_STEP_TYPES = EXECUTION_COMPENSATABLE_STEP_TYPES;

export interface ResolvedCompensationCapability {
  contract: CapabilityContract<unknown, unknown>;
  binding: CapabilityBinding<unknown, unknown>;
  input: unknown;
  output: unknown;
}

/** Resolve only contracts with a real compensate() binding. Unknown step types are
 * deliberately unsupported; callers must not synthesize a generic undo. */
export async function resolveCompensationCapability(
  tenantId: string,
  stepType: string,
  rawInput: unknown,
  rawOutput: unknown,
): Promise<ResolvedCompensationCapability | null> {
  const modes = await resolveCapabilityBindingsForTenant(tenantId);
  if (stepType === "hold_appointment") {
    return {
      contract: holdAppointmentContract as CapabilityContract<unknown, unknown>,
      binding: (modes.scheduling.mode === "emulator" ? emulatorSchedulingBinding : nativeSchedulingBinding) as CapabilityBinding<unknown, unknown>,
      input: HoldAppointmentInputSchema.parse(rawInput),
      output: HoldAppointmentOutputSchema.parse(rawOutput),
    };
  }
  if (stepType === "reserve_stock") {
    return {
      contract: reserveStockContract as CapabilityContract<unknown, unknown>,
      binding: (modes.inventory.mode === "emulator" ? reserveStockEmulatorBinding : reserveStockNativeBinding) as CapabilityBinding<unknown, unknown>,
      input: ReserveStockInputSchema.parse(rawInput),
      output: ReserveStockOutputSchema.parse(rawOutput),
    };
  }
  return null;
}
