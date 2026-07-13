// Typed errors for every external call (§22). No bare fetch, no unhandled rejections.

export class IntegrationError extends Error {
  constructor(
    public readonly integration: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`[${integration}] ${message}`);
    this.name = "IntegrationError";
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
