// Secrets manager — unconfigured/default state must be explicit, the prod safety
// guard must actually trip, and the AWS-backed path must actually fetch, cache, and
// retry — same rigor every other adapter test in this repo holds itself to.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const ENV_KEYS = ["SECRETS_PROVIDER", "FINNOR_SECRET_IDS", "SECRET_REFRESH_MS", "ALLOW_PLAINTEXT_ENV_SECRETS", "NODE_ENV"] as const;
let savedEnv: Record<string, string | undefined> = {};

describe("secrets manager", () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    vi.resetModules();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (k === "NODE_ENV") continue; // managed via vi.stubEnv/vi.unstubAllEnvs instead
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("defaults to the env provider, unloaded until first call", async () => {
    const { secretProviderStatus } = await import("@finnor/security");
    expect(secretProviderStatus()).toEqual({ provider: "env", loaded: false, loadedAt: null });
  });

  it("ensureSecretsLoaded resolves cleanly on the env provider and marks itself loaded", async () => {
    const { ensureSecretsLoaded, secretProviderStatus } = await import("@finnor/security");
    await ensureSecretsLoaded();
    expect(secretProviderStatus().loaded).toBe(true);
  });

  it("throws when ALLOW_PLAINTEXT_ENV_SECRETS=1 in production — a safety valve, never a silent allowance", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ALLOW_PLAINTEXT_ENV_SECRETS = "1";
    const { ensureSecretsLoaded } = await import("@finnor/security");
    await expect(ensureSecretsLoaded()).rejects.toThrow(/forbidden in production/);
  });

  it("aws-secrets-manager provider requires FINNOR_SECRET_IDS", async () => {
    process.env.SECRETS_PROVIDER = "aws-secrets-manager";
    const { ensureSecretsLoaded } = await import("@finnor/security");
    await expect(ensureSecretsLoaded()).rejects.toThrow(/requires FINNOR_SECRET_IDS/);
  });

  it("aws-secrets-manager: fetches a secret, sets process.env, dedupes concurrent calls, and retries on a transient failure", async () => {
    process.env.SECRETS_PROVIDER = "aws-secrets-manager";
    process.env.FINNOR_SECRET_IDS = JSON.stringify({ MY_TEST_KEY: "arn:aws:secretsmanager:us-east-1:123:secret:test" });

    let sendCalls = 0;
    vi.doMock("@aws-sdk/client-secrets-manager", () => {
      class FakeSecretsManagerClient {
        async send() {
          sendCalls++;
          if (sendCalls < 2) {
            const err = new Error("throttled");
            err.name = "ThrottlingException";
            throw err;
          }
          return { SecretString: JSON.stringify({ MY_TEST_KEY: "the-real-value" }) };
        }
      }
      class FakeGetSecretValueCommand {
        constructor(public input: unknown) {}
      }
      return { SecretsManagerClient: FakeSecretsManagerClient, GetSecretValueCommand: FakeGetSecretValueCommand };
    });

    const { ensureSecretsLoaded } = await import("@finnor/security");
    await Promise.all([ensureSecretsLoaded(), ensureSecretsLoaded()]); // concurrent — must dedupe to one in-flight fetch
    expect(process.env.MY_TEST_KEY).toBe("the-real-value");
    expect(sendCalls).toBe(2); // 1 retried failure + 1 success, not fetched twice for the concurrent pair
    delete process.env.MY_TEST_KEY;
  });

  it("malformed FINNOR_SECRET_IDS JSON throws a clear error, not a cryptic parse failure", async () => {
    process.env.SECRETS_PROVIDER = "aws-secrets-manager";
    process.env.FINNOR_SECRET_IDS = "{not valid json";
    const { ensureSecretsLoaded } = await import("@finnor/security");
    await expect(ensureSecretsLoaded()).rejects.toThrow(/FINNOR_SECRET_IDS is invalid JSON/);
  });

  it("FINNOR_SECRET_IDS as a JSON array (not an object) is rejected the same way", async () => {
    process.env.SECRETS_PROVIDER = "aws-secrets-manager";
    process.env.FINNOR_SECRET_IDS = '["not", "an", "object"]';
    const { ensureSecretsLoaded } = await import("@finnor/security");
    await expect(ensureSecretsLoaded()).rejects.toThrow(/FINNOR_SECRET_IDS is invalid JSON/);
  });

  it("does not retry a non-retryable AWS error (AccessDenied) — fails fast", async () => {
    process.env.SECRETS_PROVIDER = "aws-secrets-manager";
    process.env.FINNOR_SECRET_IDS = JSON.stringify({ MY_TEST_KEY: "arn:aws:secretsmanager:us-east-1:123:secret:test" });

    let sendCalls = 0;
    vi.doMock("@aws-sdk/client-secrets-manager", () => {
      class FakeSecretsManagerClient {
        async send() {
          sendCalls++;
          const err = new Error("nope");
          err.name = "AccessDeniedException";
          throw err;
        }
      }
      class FakeGetSecretValueCommand {
        constructor(public input: unknown) {}
      }
      return { SecretsManagerClient: FakeSecretsManagerClient, GetSecretValueCommand: FakeGetSecretValueCommand };
    });

    const { ensureSecretsLoaded } = await import("@finnor/security");
    await expect(ensureSecretsLoaded()).rejects.toThrow();
    expect(sendCalls).toBe(1);
  });
});
