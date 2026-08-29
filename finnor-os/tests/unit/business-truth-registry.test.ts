import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUSINESS_TRUTH_REGISTRY,
  BUSINESS_CAPABILITY_REGISTRY,
  getBusinessTruth,
  getBusinessTruthForCapability,
  validateBusinessTruthRegistry,
} from "@finnor/data-platform";
import {
  createDefaultPluginRegistry,
  createUserCapabilityRegistry,
  DEALER_ZERO_CAPABILITY_PRECONDITIONS,
  dealerZeroPreconditionFor,
  validateDealerZeroCapabilityPreconditions,
} from "@finnor/orchestration";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(path);
  }
  return files;
}

describe("Business Truth Registry", () => {
  it("has one executable owner, identity rule and mutation boundary per concept", () => {
    expect(() => validateBusinessTruthRegistry()).not.toThrow();
    expect(new Set(BUSINESS_TRUTH_REGISTRY.map((entry) => entry.concept)).size).toBe(BUSINESS_TRUTH_REGISTRY.length);
    expect(BUSINESS_TRUTH_REGISTRY.every((entry) => entry.writableOwner.length > 0)).toBe(true);
  });

  it("covers every canonical import entity through the governed import boundary", () => {
    const expected = [
      "customer", "lead", "appointment", "service_visit", "equipment", "work_order",
      "quote", "proposal", "invoice", "payment", "inventory_item", "technician",
    ];
    const importable = new Set(BUSINESS_TRUTH_REGISTRY.map((entry) => entry.importability));
    for (const entity of expected) expect(importable.has(entity as never), entity).toBe(true);
  });

  it("gives all 59 actions and all 13 queries explicit authoritative truth owners", () => {
    const userCapabilities = createUserCapabilityRegistry(createDefaultPluginRegistry()).all();
    expect(userCapabilities).toHaveLength(72);
    expect(userCapabilities.filter((row) => row.kind === "ACTION")).toHaveLength(59);
    expect(userCapabilities.filter((row) => row.kind === "QUERY")).toHaveLength(13);
    const registered = new Set(BUSINESS_CAPABILITY_REGISTRY.map((row) => row.capability));
    expect(registered).toEqual(new Set(userCapabilities.map((row) => row.capability)));
    for (const capability of userCapabilities) {
      const owners = getBusinessTruthForCapability(capability.capability);
      expect(owners.length, capability.capability).toBeGreaterThan(0);
      expect(owners.every((owner) => owner.writableOwner.length > 0), capability.capability).toBe(true);
    }
  });

  it("gives all 72 user capabilities an executable Dealer Zero precondition", () => {
    const registry = createUserCapabilityRegistry(createDefaultPluginRegistry());
    expect(() => validateDealerZeroCapabilityPreconditions(registry)).not.toThrow();
    expect(DEALER_ZERO_CAPABILITY_PRECONDITIONS).toHaveLength(72);
    for (const capability of registry.all()) {
      const precondition = dealerZeroPreconditionFor(capability.capability);
      expect(precondition.requiredFacts.length, capability.capability).toBeGreaterThan(0);
      expect(precondition.strategy, capability.capability).not.toBe("missing");
    }
  });

  it("makes messages authoritative and communications_log read-only", () => {
    const communication = getBusinessTruth("customer_communication");
    expect(communication.authoritativeModel).toEqual(["conversations", "messages"]);
    expect(communication.mutations).toContain("recordCustomerMessage");
    expect(communication.legacyProjection).toEqual(["communications_log (read-only view)"]);

    const migration = readFileSync(join(ROOT, "packages/db/migrations/0107_business_truth_registry.sql"), "utf8");
    expect(migration).toMatch(/CREATE VIEW finnor_os\.communications_log[\s\S]*FROM finnor_os\.messages/);
    expect(migration).toMatch(/communications_log_legacy_read_only/);
    expect(migration).toMatch(/REVOKE INSERT,UPDATE,DELETE/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_source_external_unique/);
    expect(migration).toMatch(/duplicate_message_provenance_normalized/);
  });

  it("ratchets runtime code against direct writes to the legacy communication name", () => {
    const roots = ["apps", "packages/domain-plugins", "packages/tools", "packages/orchestration"];
    const violations = roots.flatMap((root) => sourceFiles(join(ROOT, root))).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return /(?:insert|update|delete)\s*\(\s*communicationsLog\s*\)|INSERT\s+INTO\s+(?:finnor_os\.)?communications_log/i.test(source)
        ? [path.replace(`${ROOT}/`, "")]
        : [];
    });
    expect(violations).toEqual([]);
  });

  it("permits canonical business-table writes only inside their registered owner boundaries", () => {
    const roots = ["apps", "packages/domain-plugins", "packages/tools", "packages/orchestration", "packages/workflow-runtime"];
    const models = BUSINESS_TRUTH_REGISTRY.flatMap((entry) => entry.authoritativeModel)
      .filter((model) => !["tenants", "tenant_settings", "tenant_locations", "org_units", "domain_policies", "works", "work_inputs", "work_events", "decision_receipts"].includes(model));
    const symbols = [...new Set(models.map((model) => model.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())))]
      .filter((symbol) => symbol !== "communicationsLog");
    const directWrite = new RegExp(`(?:insert|update|delete)\\s*\\(\\s*(${symbols.join("|")})\\s*\\)`, "gm");
    const ownerPaths: Partial<Record<string, RegExp[]>> = {
      communicationDeliveries: [/^packages\/domain-plugins\/universal-actions\/runtime\.ts$/],
      delegations: [/^packages\/domain-plugins\/universal-actions\/(?:runtime|delegation-state)\.ts$/],
      delegationEvents: [/^packages\/domain-plugins\/universal-actions\/(?:runtime|delegation-state)\.ts$/],
      acknowledgementRequests: [/^packages\/domain-plugins\/universal-actions\/(?:runtime|delegation-state)\.ts$/],
      internalEvents: [/^packages\/domain-plugins\/universal-actions\/runtime\.ts$/],
      internalEventParticipants: [/^packages\/domain-plugins\/universal-actions\/runtime\.ts$/],
      internalEventEvents: [/^packages\/domain-plugins\/universal-actions\/runtime\.ts$/],
      documentShares: [/^packages\/domain-plugins\/universal-actions\/runtime\.ts$/],
      sandboxOutbox: [/^packages\/tools\/src\/(?:sandbox|builtin-tools)\.ts$/],
      businessOperations: [/^apps\/worker\/src\/handlers\/business-operation\.ts$/, /^apps\/api\/app\/api\/instructions\/\[id\]\/cancel\/route\.ts$/, /^packages\/orchestration\/src\/(?:compiler|index)\.ts$/],
      businessOperationTargets: [/^apps\/worker\/src\/handlers\/business-operation\.ts$/],
      businessOperationEvents: [/^apps\/worker\/src\/handlers\/business-operation\.ts$/],
      externalOperations: [/^packages\/tools\/src\/idempotent-call\.ts$/, /^packages\/orchestration\/src\/external-observation\.ts$/, /^apps\/worker\/src\/handlers\/observe-external-effect\.ts$/],
    };
    const violations = roots.flatMap((root) => sourceFiles(join(ROOT, root))).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const relative = path.replace(`${ROOT}/`, "");
      return [...source.matchAll(directWrite)].flatMap((match) => {
        const model = match[1]!;
        const allowed = ownerPaths[model]?.some((pattern) => pattern.test(relative)) ?? false;
        return allowed ? [] : [`${relative}:${model}`];
      });
    });
    expect(violations).toEqual([]);
  });

  it("never resets evolving Dealer Zero inventory during reconciliation", () => {
    const seed = readFileSync(join(ROOT, "scripts/seed-dealer-zero.ts"), "utf8");
    const inventoryStart = seed.indexOf("async function ensureInventory");
    const existingStart = seed.indexOf("if (existing) {", inventoryStart);
    const existingBranch = seed.slice(existingStart, seed.indexOf("} else {", existingStart));
    expect(existingBranch).not.toMatch(/quantity\s*:\s*item\.quantity/);
    expect(seed).toContain("reconcileInventoryItemMetadata");
  });

  it("keeps the Dealer Zero static reconciler structurally isolated from evolving truth", () => {
    const source = readFileSync(join(ROOT, "scripts/dealer-zero/static-reconciler.ts"), "utf8");
    const dbImports = source.match(/import \{([\s\S]*?)\} from "@finnor\/db"/)?.[1] ?? "";
    expect(dbImports).not.toMatch(/\b(?:households|leads|equipment|serviceVisits|maintenanceAgreements|conversations|messages|invoices|payments|inventoryItems|warehouseStock)\b/);
    expect(source).toContain("reconcileDealerZeroStatic");
    expect(source).toContain("static reconciliation never invents provider");
    expect(source).toMatch(/status:\s*"disabled"/);
  });
});
