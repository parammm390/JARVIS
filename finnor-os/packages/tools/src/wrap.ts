// Uniform wrapper for every tool call: timeout, retry with backoff, typed result (§22, §30).
// Reflection evaluates the structured result — no tool is called "bare".

import { IntegrationError, IntegrationTimeoutError } from "./errors";

export interface ToolCallResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
  integrationUnavailable?: boolean;
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 500, timeoutMs: 15_000 };

async function withTimeout<T>(integration: string, ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IntegrationTimeoutError(integration, ms)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function wrappedCall(
  integration: string,
  fn: () => Promise<Record<string, unknown>>,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<ToolCallResult> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      const output = await withTimeout(integration, policy.timeoutMs, fn());
      return { ok: true, output };
    } catch (err) {
      lastError = err as Error;
      const retryable = err instanceof IntegrationError ? err.retryable : true;
      if (!retryable || attempt === policy.attempts) break;
      await new Promise((r) => setTimeout(r, policy.baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  return {
    ok: false,
    output: {},
    error: lastError?.message ?? "unknown integration failure",
    // Continued failure → caller sets domain_action status blocked_integration_unavailable (§30).
    integrationUnavailable: true,
  };
}
