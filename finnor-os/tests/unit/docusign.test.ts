// DocuSign adapter — unconfigured state must be explicit and never attempt a real
// network call, plus stub-fetch coverage of the JWT-grant + envelope-create happy
// path, API-error mapping, and the never-retry-on-401/403 property. A real (but
// throwaway) RSA keypair is generated locally so the RS256 assertion actually signs
// — this never talks to DocuSign, it only proves the adapter's own signing code path
// doesn't throw on a syntactically valid PEM.
//
// vi.resetModules() before each import: docusign.ts caches its access token in
// module scope across calls (by design — see the module's own comment), so within
// one test file each test must get a fresh module instance or an earlier test's
// cached token would silently skip the oauth/token stub in a later test.

import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const ENV_KEYS = ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY"] as const;

function setConfigured() {
  process.env.DOCUSIGN_INTEGRATION_KEY = "test-integration-key";
  process.env.DOCUSIGN_USER_ID = "test-user-id";
  process.env.DOCUSIGN_ACCOUNT_ID = "test-account-id";
  process.env.DOCUSIGN_PRIVATE_KEY = privateKey;
}

describe("docusign adapter — unconfigured state", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("docusignProviderStatus reports not configured when no env vars are set", async () => {
    const { docusignProviderStatus } = await import("@finnor/tools");
    expect(docusignProviderStatus()).toEqual({ configured: false });
  });

  it("requestDocusignSignature throws a clear IntegrationError when not connected, with no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { requestDocusignSignature, IntegrationError } = await import("@finnor/tools");
    await expect(
      requestDocusignSignature({
        tenantId: "00000000-0000-4000-8000-0000000000e4",
        documentId: "doc-1",
        signerName: "Jane Doe",
        signerEmail: "jane@example.com",
        idempotencyKey: "k1",
      }),
    ).rejects.toThrow(IntegrationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports configured:true once all four env vars are present", async () => {
    setConfigured();
    const { docusignProviderStatus } = await import("@finnor/tools");
    expect(docusignProviderStatus()).toEqual({ configured: true });
  });
});

describe("docusign adapter — configured, stub-fetch", () => {
  beforeEach(() => {
    setConfigured();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubTokenThenEnvelope(envelopeResponse: {
    ok: boolean;
    status?: number;
    json: () => Promise<unknown>;
    text?: () => Promise<string>;
  }) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/oauth/token")) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: "fake-access-token", expires_in: 3600 }) });
        }
        return Promise.resolve(envelopeResponse);
      }),
    );
  }

  it("happy path: JWT grant + envelope create maps to {signatureRequestId, status: sent}", async () => {
    stubTokenThenEnvelope({ ok: true, json: async () => ({ envelopeId: "env-123" }) });
    const { requestDocusignSignature } = await import("@finnor/tools");
    const result = await requestDocusignSignature({
      tenantId: "00000000-0000-4000-8000-0000000000e4",
      documentId: "doc-1",
      signerName: "Jane Doe",
      signerEmail: "jane@example.com",
      idempotencyKey: "k1",
      proposalId: "00000000-0000-4000-8000-0000000000aa",
    });
    expect(result).toEqual({ signatureRequestId: "env-123", status: "sent" });
  });

  it("embeds tenantId and proposalId as envelope customFields", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/oauth/token")) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: "fake-access-token", expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ envelopeId: "env-1" }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { requestDocusignSignature } = await import("@finnor/tools");
    await requestDocusignSignature({
      tenantId: "00000000-0000-4000-8000-0000000000e4",
      documentId: "doc-1",
      signerName: "Jane Doe",
      signerEmail: "jane@example.com",
      idempotencyKey: "k1",
      proposalId: "00000000-0000-4000-8000-0000000000aa",
    });
    const envelopeCall = fetchSpy.mock.calls.find((call: unknown[]) => !String(call[0]).includes("/oauth/token"))!;
    const body = JSON.parse((envelopeCall[1] as { body: string }).body);
    expect(body.customFields.textCustomFields).toEqual(
      expect.arrayContaining([
        { name: "tenantId", value: "00000000-0000-4000-8000-0000000000e4" },
        { name: "proposalId", value: "00000000-0000-4000-8000-0000000000aa" },
      ]),
    );
  });

  it("maps a non-2xx envelope-create response to IntegrationError", async () => {
    stubTokenThenEnvelope({ ok: false, status: 400, json: async () => ({}), text: async () => "bad request" });
    const { requestDocusignSignature, IntegrationError } = await import("@finnor/tools");
    await expect(
      requestDocusignSignature({
        tenantId: "00000000-0000-4000-8000-0000000000e4",
        documentId: "doc-1",
        signerName: "Jane Doe",
        signerEmail: "jane@example.com",
        idempotencyKey: "k2",
      }),
    ).rejects.toThrow(IntegrationError);
  });

  it("401 on envelope create is never retryable", async () => {
    stubTokenThenEnvelope({ ok: false, status: 401, json: async () => ({}), text: async () => "unauthorized" });
    const { requestDocusignSignature } = await import("@finnor/tools");
    await expect(
      requestDocusignSignature({
        tenantId: "00000000-0000-4000-8000-0000000000e4",
        documentId: "doc-1",
        signerName: "Jane Doe",
        signerEmail: "jane@example.com",
        idempotencyKey: "k3",
      }),
    ).rejects.toMatchObject({ retryable: false });
  });

  it("500 on envelope create is retryable", async () => {
    stubTokenThenEnvelope({ ok: false, status: 500, json: async () => ({}), text: async () => "server error" });
    const { requestDocusignSignature } = await import("@finnor/tools");
    await expect(
      requestDocusignSignature({
        tenantId: "00000000-0000-4000-8000-0000000000e4",
        documentId: "doc-1",
        signerName: "Jane Doe",
        signerEmail: "jane@example.com",
        idempotencyKey: "k4",
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("a failed JWT token exchange throws before ever attempting the envelope call", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/oauth/token")) {
        return Promise.resolve({ ok: false, status: 400, text: async () => "invalid_grant" });
      }
      return Promise.resolve({ ok: true, json: async () => ({ envelopeId: "should-not-happen" }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { requestDocusignSignature, IntegrationError } = await import("@finnor/tools");
    await expect(
      requestDocusignSignature({
        tenantId: "00000000-0000-4000-8000-0000000000e4",
        documentId: "doc-1",
        signerName: "Jane Doe",
        signerEmail: "jane@example.com",
        idempotencyKey: "k5",
      }),
    ).rejects.toThrow(IntegrationError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
