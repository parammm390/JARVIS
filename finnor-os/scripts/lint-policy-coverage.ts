// B6.T4: CI-safe policy coverage check. It has no DB writes and fails loudly when
// the policy matrix no longer covers a registered action type.
import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { policyRows } from "./seed-tenant-policies";
export function checkPolicyCoverage(registeredTypes: readonly string[], matrixTypes: readonly string[]) {
  const registered = new Set(registeredTypes);
  const matrix = new Set(matrixTypes.filter((type) => type !== "pricing_catalog"));
  return { missing: [...registered].filter((type) => !matrix.has(type)), stale: [...matrix].filter((type) => !registered.has(type)) };
}
const registered = createDefaultPluginRegistry().actionTypes();
const result = checkPolicyCoverage(registered, policyRows(null).map((row) => row.actionType));
if (result.missing.length || result.stale.length) { console.error(JSON.stringify(result)); process.exit(1); }
console.log(`policy coverage green: ${registered.length}/${registered.length} registered action types`);
