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
