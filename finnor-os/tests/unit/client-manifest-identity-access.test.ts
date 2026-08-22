import { describe, expect, it } from "vitest";
import { parseClientManifest } from "../../scripts/client-manifest";
import { buildClientImpactPlan } from "../../scripts/release/client-lifecycle-model";

const base = {
  clientKey: "identity-manifest",
  tenant: { name: "Identity Manifest", timezone: "America/Phoenix" },
  locations: [{ key: "phoenix", name: "Phoenix" }],
  users: [
    { email: "alice@example.test", role: "owner" },
    { email: "mario@example.test", role: "technician" },
  ],
  orgUnits: [{ key: "service-team", name: "Service Team", kind: "team" }],
};

const access = {
  communicationIdentities: [{
    key: "alice-email",
    provider: "gmail",
    channel: "email",
    address: "alice@example.test",
    credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/gmail/alice", version: "AWSCURRENT" },
  }],
  communicationIdentityBindings: [{
    identityKey: "alice-email",
    principal: { type: "employee", employeeEmail: "alice@example.test" },
    purpose: "quotes",
    priority: 100,
  }],
  applicationAccounts: [{
    key: "supplier-main",
    application: "supplier_portal",
    provider: "supplier_portal",
    displayName: "Supplier Portal A",
    providerAccountRef: "account-a",
    metadata: { region: "west" },
  }],
  authProfiles: [{
    ref: "mario-supplier-main",
    principal: { type: "employee", employeeEmail: "mario@example.test" },
    applicationAccountKey: "supplier-main",
    purpose: "purchasing",
    credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/supplier/main" },
    restrictions: { allowedPurposes: ["purchasing"] },
  }],
};

describe("Client Manifest governed identity/access contract", () => {
  it("remains backward compatible while preserving omitted-vs-empty intent", () => {
    const legacy = parseClientManifest(base);
    expect(legacy.communicationIdentities).toBeUndefined();
    expect(legacy.communicationIdentityBindings).toBeUndefined();
    expect(legacy.applicationAccounts).toBeUndefined();
    expect(legacy.authProfiles).toBeUndefined();

    const cleared = parseClientManifest({
      ...base,
      communicationIdentities: [], communicationIdentityBindings: [], applicationAccounts: [], authProfiles: [],
    });
    expect(cleared.communicationIdentities).toEqual([]);
    expect(cleared.authProfiles).toEqual([]);
  });

  it("parses safe references, canonical principals, defaults, and non-secret metadata", () => {
    const parsed = parseClientManifest({ ...base, ...access });
    expect(parsed.communicationIdentities?.[0]).toMatchObject({ status: "active", capabilities: [], credential: { version: "AWSCURRENT" } });
    expect(parsed.communicationIdentityBindings?.[0]).toMatchObject({ status: "active", priority: 100 });
    expect(parsed.applicationAccounts?.[0]).toMatchObject({ status: "active", metadata: { region: "west" } });
    expect(parsed.authProfiles?.[0]).toMatchObject({ status: "active", scope: {}, restrictions: { allowedPurposes: ["purchasing"] } });
  });

  it("rejects undeclared principals/accounts/identities and secret-bearing configuration", () => {
    expect(() => parseClientManifest({
      ...base, ...access,
      communicationIdentityBindings: [{ identityKey: "missing-email", principal: { type: "employee", employeeEmail: "alice@example.test" } }],
    })).toThrow(/declared communication identity/i);
    expect(() => parseClientManifest({
      ...base, ...access,
      communicationIdentityBindings: [{ identityKey: "alice-email", principal: { type: "employee", employeeEmail: "missing@example.test" } }],
    })).toThrow(/principal reference/i);
    expect(() => parseClientManifest({
      ...base, ...access,
      authProfiles: [{ ref: "bad-account-ref", principal: { type: "tenant" }, applicationAccountKey: "missing-account" }],
    })).toThrow(/declared application account/i);
    expect(() => parseClientManifest({
      ...base, ...access,
      applicationAccounts: [{ ...access.applicationAccounts[0], metadata: { apiKey: "raw-secret" } }],
    })).toThrow(/secret-shaped/i);
    expect(() => parseClientManifest({
      ...base, ...access,
      authProfiles: [{ ...access.authProfiles[0], restrictions: { refreshToken: "raw-secret" } }],
    })).toThrow(/secret-shaped/i);
  });

  it("requires tenant-namespaced AWS refs and provider-matched legacy refs", () => {
    expect(() => parseClientManifest({
      ...base, ...access,
      communicationIdentities: [{ ...access.communicationIdentities[0], credential: { provider: "aws-secrets-manager", ref: "finnor/global/gmail" } }],
    })).toThrow(/tenantId.*namespace/i);
    expect(() => parseClientManifest({
      ...base, ...access,
      communicationIdentities: [{ ...access.communicationIdentities[0], credential: { provider: "legacy-env", ref: "legacy-env:vapi" } }],
    })).toThrow(/allowlisted for this provider/i);
  });

  it("routes identity/access changes through convergence and credential certification", () => {
    const current = parseClientManifest(base);
    const desired = parseClientManifest({ ...base, ...access });
    const plan = buildClientImpactPlan({ currentManifest: current, desiredManifest: desired });
    expect(plan.affectedAreas).toContain("integration");
    expect(plan.factoryStages).toContain("integrations_credentials");
    expect(plan.certificationGates).toContain("credential_references");
  });

  it("requires manifest v2 for governed OAuth and stores only safe connection requirements", () => {
    const phase5 = {
      ...base,
      applicationAccounts: [{
        key: "alice-gmail", application: "gmail", provider: "gmail", displayName: "Alice Gmail",
        providerAccountRef: "alice@example.test", capabilities: ["send"], metadata: {},
      }],
      authProfiles: [{
        ref: "alice-gmail-oauth", principal: { type: "employee" as const, employeeEmail: "alice@example.test" },
        applicationAccountKey: "alice-gmail", purpose: "send", authMethod: "oauth2" as const,
        requiredScopes: ["https://www.googleapis.com/auth/gmail.send"], capabilities: ["send"],
      }],
      connectionRequirements: [{ authProfileRef: "alice-gmail-oauth", provider: "gmail", purposes: ["send"] }],
    };
    expect(() => parseClientManifest(phase5)).toThrow(/manifestVersion 2/i);
    const parsed = parseClientManifest({ ...phase5, manifestVersion: 2 });
    expect(parsed).toMatchObject({
      manifestVersion: 2,
      authProfiles: [expect.objectContaining({ authMethod: "oauth2", connectionRequired: true })],
      connectionRequirements: [expect.objectContaining({ provider: "gmail", required: true })],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/accessToken|refreshToken|password|cookie/i);
    const changed = parseClientManifest({
      ...phase5,
      manifestVersion: 2,
      connectionPolicy: { healthCheckMinutes: 5 },
      durableLimits: [{ provider: "gmail", action: "send", perMinute: 20 }],
      retentionPolicies: [{ dataClass: "messages", retentionDays: 180 }],
    });
    const plan = buildClientImpactPlan({ currentManifest: parsed, desiredManifest: changed });
    expect(plan.affectedAreas).toEqual(expect.arrayContaining(["policy", "integration"]));
    expect(plan.factoryStages).toContain("integrations_credentials");
    expect(plan.certificationGates).toContain("tenant_provider_health");
  });
});
