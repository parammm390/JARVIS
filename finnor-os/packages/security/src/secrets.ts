import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

type Provider = "env" | "aws-secrets-manager";
let initialization: Promise<void> | null = null;
let loadedAt = 0;

function provider(): Provider {
  return process.env.SECRETS_PROVIDER === "aws-secrets-manager" ? "aws-secrets-manager" : "env";
}

function mappings(): Record<string, string> {
  const raw = process.env.FINNOR_SECRET_IDS ?? "{}";
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("must be an object");
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch (error) {
    throw new Error(`FINNOR_SECRET_IDS is invalid JSON: ${(error as Error).message}`);
  }
}

function isRetryableAwsError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  // Access/not-found problems never resolve on retry — fail fast instead of burning
  // 3 attempts (~1.75s of backoff) on a guaranteed-to-fail call, same reasoning as
  // packages/tools/src/wrap.ts's IntegrationError.retryable distinction.
  return !/AccessDenied|ResourceNotFoundException|InvalidRequestException|DecryptionFailure/.test(name);
}

async function readAwsSecretOnce(client: SecretsManagerClient, secretId: string): Promise<Record<string, string>> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const raw = response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary as Uint8Array).toString("utf8") : "");
  if (!raw) throw new Error(`Secret ${secretId} had no value`);
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && !Array.isArray(value) && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
  } catch {
    // Single-value secrets are supported below.
  }
  return { value: raw };
}

/** 3 attempts, exponential backoff + jitter — same shape as packages/tools/src/wrap.ts's
 *  wrappedCall, so this codebase has exactly one retry convention, not two. */
async function readAwsSecret(client: SecretsManagerClient, secretId: string): Promise<Record<string, string>> {
  const attempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await readAwsSecretOnce(client, secretId);
    } catch (err) {
      lastErr = err;
      if (!isRetryableAwsError(err) || attempt === attempts) break;
      const jitter = Math.random() * 100;
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1) + jitter));
    }
  }
  throw lastErr;
}

/** Loads managed secrets into process memory only; never logs a secret value. */
export async function ensureSecretsLoaded(): Promise<void> {
  const refreshMs = Number(process.env.SECRET_REFRESH_MS ?? 300_000);
  if (initialization && Date.now() - loadedAt < refreshMs) return initialization;
  // Stamped BEFORE the fetch starts, not after it completes — a concurrent caller
  // arriving while this fetch is still in flight must see a "fresh enough" loadedAt
  // and join this SAME in-flight promise, rather than reading the still-zero/stale
  // loadedAt from a prior attempt and kicking off a second, redundant fetch.
  loadedAt = Date.now();
  initialization = (async () => {
    if (provider() === "env") {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_PLAINTEXT_ENV_SECRETS === "1") {
        throw new Error("ALLOW_PLAINTEXT_ENV_SECRETS is forbidden in production; use platform-managed secrets or AWS Secrets Manager");
      }
      return;
    }
    const map = mappings();
    if (Object.keys(map).length === 0) throw new Error("SECRETS_PROVIDER=aws-secrets-manager requires FINNOR_SECRET_IDS");
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? process.env.AWS_BEDROCK_REGION ?? "us-east-1" });
    for (const [envName, secretId] of Object.entries(map)) {
      const secret = await readAwsSecret(client, secretId);
      const value = secret[envName] ?? secret.value;
      if (!value) throw new Error(`Managed secret ${secretId} did not contain ${envName}`);
      process.env[envName] = value;
    }
  })();
  try {
    await initialization;
  } catch (error) {
    initialization = null;
    loadedAt = 0; // failed load was never "fresh" — the next call must retry, not skip
    throw error;
  }
}

export function secretProviderStatus(): { provider: Provider; loaded: boolean; loadedAt: string | null } {
  return { provider: provider(), loaded: loadedAt > 0, loadedAt: loadedAt ? new Date(loadedAt).toISOString() : null };
}
