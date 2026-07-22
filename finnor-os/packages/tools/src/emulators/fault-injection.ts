// Shared fault-injection primitive for capability emulators (Phase 2, docs/
// jarvis-90-execution-blueprint.md §2 — "not a happy-path stub"). Models realistic
// latency, partial failure, rate limiting, timeout, and auth failure. Both the
// scheduling and communications emulators use the same injector so their fault
// profiles are configured identically, not reinvented per domain.

export class RetryableFaultError extends Error {
  readonly retryable = true;
}

export class AuthFaultError extends Error {
  readonly retryable = false;
}

export interface FaultInjectionConfig {
  /** Realistic latency distribution, [minMs, maxMs]. Default 10-60ms. */
  latencyMsRange?: [number, number];
  /** Throws a retryable transient error on every Nth call. */
  failEveryNth?: number;
  /** Throws a retryable rate-limit error on every Nth call. */
  rateLimitEveryNth?: number;
  /** Always throws a non-retryable auth error — models a misconfigured/revoked credential. */
  authFailure?: boolean;
  /** Hangs well beyond any reasonable timeout on the Nth call — proves the capability
   *  contract's retryPolicy.timeoutMs is actually enforced, not just declared. */
  timeoutOnNth?: number;
}

export function makeFaultInjector(config: FaultInjectionConfig = {}): () => Promise<void> {
  let calls = 0;
  return async function injectFaults(): Promise<void> {
    calls++;
    if (config.authFailure) throw new AuthFaultError("emulator: auth failure (invalid or revoked credential)");
    const [min, max] = config.latencyMsRange ?? [10, 60];
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    if (config.timeoutOnNth && calls === config.timeoutOnNth) {
      await new Promise((r) => setTimeout(r, 30_000));
    }
    if (config.rateLimitEveryNth && calls % config.rateLimitEveryNth === 0) {
      throw new RetryableFaultError("emulator: rate limited (429)");
    }
    if (config.failEveryNth && calls % config.failEveryNth === 0) {
      throw new RetryableFaultError("emulator: transient partial failure");
    }
  };
}

// A3.T4: named fault presets an operator (or test) can select by a short mode string,
// rather than hand-assembling a FaultInjectionConfig — matches the plan's own
// `EMULATOR_FAULTS=cap:mode,...` shape. "malformed-webhook" is deliberately not a
// preset here: it describes a payload SHAPE (an inbound webhook body), not a call
// fault this per-call injector models — that belongs with B7.T4's webhook fuzzing,
// not this per-call latency/failure/timeout primitive.
export const FAULT_MODE_PRESETS: Record<string, FaultInjectionConfig> = {
  latency: { latencyMsRange: [800, 2500] },
  fail: { failEveryNth: 2 }, // "5xx" per the plan's own wording
  ratelimit: { rateLimitEveryNth: 2 }, // "429"
  auth: { authFailure: true },
  timeout: { timeoutOnNth: 1 },
};

/** Parses `EMULATOR_FAULTS=crm:fail,communications:ratelimit` into a per-capability
 *  preset map. Unknown capability or mode names are silently ignored (never crash
 *  boot over a typo in an ops env var) — callers can log what they end up applying. */
export function parseEmulatorFaultsEnv(value: string | undefined): Map<string, FaultInjectionConfig> {
  const result = new Map<string, FaultInjectionConfig>();
  if (!value) return result;
  for (const pair of value.split(",")) {
    const [capability, mode] = pair.split(":").map((s) => s.trim());
    if (!capability || !mode) continue;
    const preset = FAULT_MODE_PRESETS[mode];
    if (preset) result.set(capability, preset);
  }
  return result;
}

// A3.T4 per-tenant config: a persistent (not one-shot) injector per (capability,
// tenantId) so counter-based faults (failEveryNth, rateLimitEveryNth) keep a real,
// stable count across calls for that one tenant — a fresh makeFaultInjector() per
// call would never reach "every Nth call" since every call would look like the 1st.
// Falls back to the process-wide/env-configured injector when no tenant override is
// set — set via tenant_integrations.config.faults (apps/api's tenant-integrations
// admin surface, or directly in tests).
const tenantInjectors = new Map<string, () => Promise<void>>();

export function setTenantFaultConfig(capability: string, tenantId: string, config: FaultInjectionConfig | null): void {
  const key = `${capability}:${tenantId}`;
  if (config === null) {
    tenantInjectors.delete(key);
    return;
  }
  tenantInjectors.set(key, makeFaultInjector(config));
}

export function tenantFaultInjector(capability: string, tenantId: string): (() => Promise<void>) | undefined {
  return tenantInjectors.get(`${capability}:${tenantId}`);
}

export function resetTenantFaultConfigs(): void {
  tenantInjectors.clear();
}
