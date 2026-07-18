// Typed errors for every external call (§22). No bare fetch, no unhandled rejections.

import type { ErrorKind } from "@finnor/shared-types";

export class IntegrationError extends Error {
  /** §0.3.2/§2.2: the taxonomy retry logic keys off. Defaults from `retryable` for
   *  every pre-existing call site (unchanged behavior); pass `kind` explicitly for the
   *  finer-grained cases (auth/conflict/validation/provider_down) as call sites adopt it. */
  public readonly kind: ErrorKind;

  constructor(
    public readonly integration: string,
    message: string,
    public readonly retryable: boolean,
    kind?: ErrorKind,
  ) {
    super(`[${integration}] ${message}`);
    this.name = "IntegrationError";
    this.kind = kind ?? (retryable ? "retryable" : "terminal");
  }
}

export class IntegrationTimeoutError extends IntegrationError {
  constructor(integration: string, timeoutMs: number) {
    super(integration, `timed out after ${timeoutMs}ms`, true);
    this.name = "IntegrationTimeoutError";
  }
}

export class NotImplementedError extends IntegrationError {
  constructor(integration: string) {
    super(integration, "not implemented — stubbed behind interface (§31)", false);
    this.name = "NotImplementedError";
  }
}

/** Shared shape for every provider self-test (ads.ts, quickbooks.ts, ...) — one
 *  definition so the integrations status endpoint has a uniform result to aggregate,
 *  and so re-exporting every adapter module from the package index doesn't collide
 *  on duplicate identical interface names. */
export interface ProviderHealth {
  configured: boolean;
  /** null = not configured, so never actually tested against the real API. */
  healthy: boolean | null;
  error?: string;
}
