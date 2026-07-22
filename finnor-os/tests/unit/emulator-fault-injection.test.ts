// A3.T4 acceptance: EMULATOR_FAULTS env parsing/application, and the per-tenant fault
// override registry emulators now check before falling back to their shared/env
// profile. Pure in-process — no DB needed for any of this.

import { describe, it, expect, beforeEach } from "vitest";
import {
  parseEmulatorFaultsEnv,
  FAULT_MODE_PRESETS,
  setTenantFaultConfig,
  tenantFaultInjector,
  resetTenantFaultConfigs,
} from "../../packages/tools/src/emulators/fault-injection";
import { applyEmulatorFaultsFromEnv } from "../../packages/tools/src/emulators/apply-env-faults";
import {
  emulatorUpsertContact,
  configureCrmEmulator,
  resetCrmEmulator,
} from "../../packages/tools/src/emulators/crm-emulator";

describe("parseEmulatorFaultsEnv", () => {
  it("parses capability:mode pairs into their preset configs", () => {
    const parsed = parseEmulatorFaultsEnv("crm:fail,communications:ratelimit");
    expect(parsed.get("crm")).toEqual(FAULT_MODE_PRESETS.fail);
    expect(parsed.get("communications")).toEqual(FAULT_MODE_PRESETS.ratelimit);
  });

  it("returns an empty map for unset/empty input", () => {
    expect(parseEmulatorFaultsEnv(undefined).size).toBe(0);
    expect(parseEmulatorFaultsEnv("").size).toBe(0);
  });

  it("silently ignores unknown modes and malformed entries — never throws over an env typo", () => {
    const parsed = parseEmulatorFaultsEnv("crm:not_a_real_mode,,justacapability,documents:auth");
    expect(parsed.has("crm")).toBe(false);
    expect(parsed.get("documents")).toEqual(FAULT_MODE_PRESETS.auth);
  });
});

describe("applyEmulatorFaultsFromEnv", () => {
  it("applies only the named, known capabilities and reports what it applied", () => {
    const applied = applyEmulatorFaultsFromEnv({ ...process.env, EMULATOR_FAULTS: "crm:auth,not_a_real_capability:fail" });
    expect(applied).toEqual(["crm"]);
    resetCrmEmulator(); // undo the module-level auth-fail config this just applied
  });

  it("no-ops with EMULATOR_FAULTS unset", () => {
    expect(applyEmulatorFaultsFromEnv({ ...process.env, EMULATOR_FAULTS: undefined })).toEqual([]);
  });
});

describe("per-tenant fault override (tenantFaultInjector)", () => {
  const TENANT_A = "tenant-a";
  const TENANT_B = "tenant-b";

  beforeEach(() => resetTenantFaultConfigs());

  it("is undefined when no override has been set for that (capability, tenant)", () => {
    expect(tenantFaultInjector("crm", TENANT_A)).toBeUndefined();
  });

  it("only affects the tenant it was set for — a different tenant sees no override", async () => {
    setTenantFaultConfig("crm", TENANT_A, { authFailure: true });
    expect(tenantFaultInjector("crm", TENANT_A)).toBeDefined();
    expect(tenantFaultInjector("crm", TENANT_B)).toBeUndefined();
  });

  it("keeps a real, persistent per-tenant call count for counter-based faults (failEveryNth)", async () => {
    setTenantFaultConfig("crm", TENANT_A, { failEveryNth: 2, latencyMsRange: [0, 0] });
    const injector = tenantFaultInjector("crm", TENANT_A)!;
    await expect(injector()).resolves.toBeUndefined(); // call 1: no fault
    await expect(injector()).rejects.toThrow(/transient partial failure/); // call 2: fails
    await expect(injector()).resolves.toBeUndefined(); // call 3: no fault
  });

  it("clearing an override (config: null) falls back to undefined again", () => {
    setTenantFaultConfig("crm", TENANT_A, { authFailure: true });
    setTenantFaultConfig("crm", TENANT_A, null);
    expect(tenantFaultInjector("crm", TENANT_A)).toBeUndefined();
  });

  it("end-to-end through a real emulator function: the overridden tenant's calls fail, an unrelated tenant's don't", async () => {
    resetCrmEmulator();
    setTenantFaultConfig("crm", TENANT_A, { authFailure: true, latencyMsRange: [0, 0] });
    await expect(
      emulatorUpsertContact({ tenantId: TENANT_A, phone: "+15550001111", idempotencyKey: "fault-test-a" }),
    ).rejects.toThrow(/auth failure/);
    await expect(
      emulatorUpsertContact({ tenantId: TENANT_B, phone: "+15550002222", idempotencyKey: "fault-test-b" }),
    ).resolves.toMatchObject({ createdNew: true });
  });
});
