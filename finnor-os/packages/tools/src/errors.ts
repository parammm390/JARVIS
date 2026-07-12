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
