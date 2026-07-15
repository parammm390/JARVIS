// Capability contract conformance (Phase 2 proof item 3): the SAME test suite runs
// against the emulator binding and the real binding for each domain — zero test-file
// changes, only which binding is passed in differs. Scheduling's "real" binding is the
// native Postgres implementation (no external scheduling SaaS exists to rebind
// against, confirmed with the user); communications' real binding is the actual Vapi
// adapter, skipped automatically if Vapi isn't configured (same describe.skipIf
// convention used everywhere else in this repo for optional external dependencies).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { z } from "zod";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, workflowSteps, workflowRuns, commands, integrationOperations } from "@finnor/db";
import { eq } from "drizzle-orm";
import { submitCommand, executeCapability, type CapabilityBinding, type CapabilityContract } from "@finnor/workflow-runtime";
import {
  holdAppointmentContract,
  emulatorSchedulingBinding,
  nativeSchedulingBinding,
  resetSchedulingEmulator,
  HoldAppointmentInputSchema,
  HoldAppointmentOutputSchema,
  type HoldAppointmentInput,
  type HoldAppointmentOutput,
  sendConfirmationContract,
  emulatorCommunicationsBinding,
  vapiCommunicationsBinding,
  resetCommunicationsEmulator,
  isVapiConfigured,
  SendConfirmationInputSchema,
  SendConfirmationOutputSchema,
  type SendConfirmationInput,
  type SendConfirmationOutput,
  // Phase 3 — 5 more domains
  upsertContactContract,
  upsertContactEmulatorBinding,
  upsertContactNativeBinding,
  upsertContactGhlBinding,
  UpsertContactInputSchema,
  UpsertContactOutputSchema,
  sendMessageContract,
  sendMessageEmulatorBinding,
  sendMessageNativeBinding,
  sendMessageGhlBinding,
  SendMessageInputSchema,
  SendMessageOutputSchema,
  bookProviderAppointmentContract,
  bookProviderAppointmentEmulatorBinding,
  bookProviderAppointmentNativeBinding,
  BookProviderAppointmentInputSchema,
  BookProviderAppointmentOutputSchema,
  isGhlConfigured,
  resetCrmEmulator,
  syncInvoiceContract,
  syncInvoiceEmulatorBinding,
  syncInvoiceQuickbooksBinding,
  SyncInvoiceInputSchema,
  SyncInvoiceOutputSchema,
  createPaymentLinkContract,
  createPaymentLinkEmulatorBinding,
  CreatePaymentLinkInputSchema,
  CreatePaymentLinkOutputSchema,
  isQuickBooksConfigured,
  resetAccountingEmulator,
  launchAdCampaignContract,
  launchAdCampaignEmulatorBinding,
  launchAdCampaignDryRunBinding,
  LaunchAdCampaignInputSchema,
  LaunchAdCampaignOutputSchema,
  resetMarketingEmulator,
  reserveStockContract,
  reserveStockEmulatorBinding,
  reserveStockNativeBinding,
  ReserveStockInputSchema,
  ReserveStockOutputSchema,
  receiveProcurementContract,
  receiveProcurementEmulatorBinding,
  receiveProcurementNativeBinding,
  ReceiveProcurementInputSchema,
  ReceiveProcurementOutputSchema,
  resetInventoryEmulator,
  generateDocumentContract,
  generateDocumentEmulatorBinding,
  generateDocumentNativeBinding,
  GenerateDocumentInputSchema,
  GenerateDocumentOutputSchema,
  requestSignatureContract,
  requestSignatureEmulatorBinding,
  RequestSignatureInputSchema,
  RequestSignatureOutputSchema,
  resetDocumentsEmulator,
} from "@finnor/tools";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000d2";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

async function newStep(stepType: string): Promise<string> {
  const submitted = await withTenant(TENANT_ID, (db) =>
    submitCommand(db, {
      tenantId: TENANT_ID,
      commandType: "conformance_test",
      payload: {},
      workflowType: "conformance_test",
      steps: [{ stepType, payload: {} }],
    }),
  );
  return submitted.stepIds[0]!;
}

function schedulingConformanceSuite(bindingName: string, binding: CapabilityBinding<HoldAppointmentInput, HoldAppointmentOutput>) {
  describe(`scheduling capability conformance — ${bindingName} binding`, () => {
    it("call() output validates against the contract's output schema", async () => {
      const stepId = await newStep("hold_appointment");
      const input = HoldAppointmentInputSchema.parse({
        tenantId: TENANT_ID,
        subjectType: "conformance_test",
        subjectId: TENANT_ID,
        scheduledAt: new Date().toISOString(),
        idempotencyKey: `conformance-${bindingName}-${stepId}`,
      });
      const result = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, binding, input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(() => HoldAppointmentOutputSchema.parse(result.output)).not.toThrow();
    });

    it("is idempotent — calling twice through executeCapability with the same step returns the same output and never creates a second integration_operations row", async () => {
      const stepId = await newStep("hold_appointment");
      const input = HoldAppointmentInputSchema.parse({
        tenantId: TENANT_ID,
        subjectType: "conformance_test",
        subjectId: TENANT_ID,
        scheduledAt: new Date().toISOString(),
        idempotencyKey: `conformance-idem-${bindingName}-${stepId}`,
      });
      const first = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, binding, input);
      const second = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, binding, input);
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) expect(second.output).toEqual(first.output);

      const rows = await withTenant(TENANT_ID, (db) => db.select().from(integrationOperations).where(eq(integrationOperations.workflowStepId, stepId)));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("succeeded");
    });
  });
}

function communicationsConformanceSuite(bindingName: string, binding: CapabilityBinding<SendConfirmationInput, SendConfirmationOutput>) {
  // The emulator binding (and the vapi binding when a real VAPI_TEST_PHONE_NUMBER is
  // supplied) prove full success end-to-end. Without a real, verified test number, we
  // will not invent one to dial a real stranger — instead the vapi binding is proven
  // reachable and genuinely authenticated (a real HTTP round trip to Vapi's API, not a
  // mock) by asserting the failure is Vapi's own validation error, never a
  // missing-credentials error.
  const hasRealTestNumber = bindingName !== "vapi" || Boolean(process.env.VAPI_TEST_PHONE_NUMBER);

  describe(`communications capability conformance — ${bindingName} binding`, () => {
    if (hasRealTestNumber) {
      it("call() output validates against the contract's output schema", async () => {
        const stepId = await newStep("send_confirmation_call");
        const input = SendConfirmationInputSchema.parse({
          tenantId: TENANT_ID,
          phoneNumber: process.env.VAPI_TEST_PHONE_NUMBER ?? "+15555550100",
          message: "This is a Finnor capability-conformance test call.",
          idempotencyKey: `conformance-${bindingName}-${stepId}`,
        });
        const result = await executeCapability(TENANT_ID, stepId, sendConfirmationContract, binding, input);
        expect(result.ok).toBe(true);
        if (result.ok) expect(() => SendConfirmationOutputSchema.parse(result.output)).not.toThrow();
      });
    } else {
      it("is genuinely reachable — a real authenticated Vapi API call, not a mock (no VAPI_TEST_PHONE_NUMBER set, so we don't invent a real number to dial)", async () => {
        const stepId = await newStep("send_confirmation_call");
        const input = SendConfirmationInputSchema.parse({
          tenantId: TENANT_ID,
          phoneNumber: "+15555550100", // reserved/fictional NANP number — never routes to a real device
          message: "This is a Finnor capability-conformance test call.",
          idempotencyKey: `conformance-${bindingName}-${stepId}`,
        });
        const result = await executeCapability(TENANT_ID, stepId, sendConfirmationContract, binding, input);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          // Vapi's own 400 validation error on the fictional number — proves we reached
          // the real API with real credentials, not that VAPI_API_KEY is missing/unset.
          expect(result.error).toMatch(/create call failed \(400\)/);
          expect(result.error).not.toMatch(/is not set/i);
        }
      });
    }
  });
}

// Generic conformance suite for the Phase 3 domains — same 2 checks
// (schema-validates, idempotent) as the bespoke scheduling/communications suites above,
// parameterized so 11 capability/binding combinations across 5 domains don't need 11
// near-identical hand-written suites. `setup` runs once before building input (e.g.
// seeding stock for reserve_stock, which needs real stock to reserve against).
function genericConformanceSuite<TIn, TOut>(
  label: string,
  contract: CapabilityContract<TIn, TOut>,
  binding: CapabilityBinding<TIn, TOut>,
  outputSchema: z.ZodType<TOut>,
  buildInput: (idempotencyKey: string) => TIn,
  setup?: () => Promise<void>,
) {
  describe(`${label} conformance`, () => {
    it("call() output validates against the contract's output schema", async () => {
      if (setup) await setup();
      const stepId = await newStep(contract.capability);
      const input = buildInput(`conformance-${label}-${stepId}`);
      const result = await executeCapability(TENANT_ID, stepId, contract, binding, input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(() => outputSchema.parse(result.output)).not.toThrow();
    });

    it("is idempotent — calling twice returns the same output and a single integration_operations row", async () => {
      if (setup) await setup();
      const stepId = await newStep(contract.capability);
      const input = buildInput(`conformance-idem-${label}-${stepId}`);
      const first = await executeCapability(TENANT_ID, stepId, contract, binding, input);
      const second = await executeCapability(TENANT_ID, stepId, contract, binding, input);
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) expect(second.output).toEqual(first.output);
      const rows = await withTenant(TENANT_ID, (db) =>
        db.select().from(integrationOperations).where(eq(integrationOperations.workflowStepId, stepId)),
      );
      expect(rows).toHaveLength(1);
    });
  });
}

describe.skipIf(!available)("capability contract conformance", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Conformance Test Dealer" }).onConflictDoNothing());
    resetSchedulingEmulator();
    resetCommunicationsEmulator();
    resetCrmEmulator();
    resetAccountingEmulator();
    resetMarketingEmulator();
    resetInventoryEmulator();
    resetDocumentsEmulator();
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(integrationOperations).where(eq(integrationOperations.tenantId, TENANT_ID));
      await db.delete(workflowSteps).where(eq(workflowSteps.tenantId, TENANT_ID));
      await db.delete(workflowRuns).where(eq(workflowRuns.tenantId, TENANT_ID));
      await db.delete(commands).where(eq(commands.tenantId, TENANT_ID));
    });
    await closePool();
  });

  schedulingConformanceSuite("emulator", emulatorSchedulingBinding);
  schedulingConformanceSuite("native", nativeSchedulingBinding);

  communicationsConformanceSuite("emulator", emulatorCommunicationsBinding);
  if (isVapiConfigured()) {
    // Places one real, minimal outbound call through Vapi — confirmed acceptable with
    // the user for proving the real binding, skipped automatically otherwise.
    communicationsConformanceSuite("vapi", vapiCommunicationsBinding);
  }

  // --- Phase 3: CRM ---------------------------------------------------------------
  genericConformanceSuite(
    "crm upsert_contact — emulator",
    upsertContactContract,
    upsertContactEmulatorBinding,
    UpsertContactOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, phone: "+15555550101", firstName: "Conformance", idempotencyKey }),
  );
  genericConformanceSuite(
    "crm upsert_contact — native",
    upsertContactContract,
    upsertContactNativeBinding,
    UpsertContactOutputSchema,
    // Same phone across both this suite's test cases is fine: upsertHouseholdByPhone's
    // real households lookup naturally dedupes on it, and a resulting createdNew:false
    // still validates against the schema.
    (idempotencyKey) => ({ tenantId: TENANT_ID, phone: "+13195550199", firstName: "Conformance", idempotencyKey }),
  );
  genericConformanceSuite(
    "crm send_message — emulator",
    sendMessageContract,
    sendMessageEmulatorBinding,
    SendMessageOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, contactId: "contact-1", message: "conformance test", idempotencyKey }),
  );
  if (isGhlConfigured()) {
    genericConformanceSuite(
      "crm upsert_contact — ghl",
      upsertContactContract,
      upsertContactGhlBinding,
      UpsertContactOutputSchema,
      (idempotencyKey) => ({ tenantId: TENANT_ID, phone: "+15555550102", firstName: "Conformance", idempotencyKey }),
    );
    genericConformanceSuite(
      "crm send_message — ghl",
      sendMessageContract,
      sendMessageGhlBinding,
      SendMessageOutputSchema,
      (idempotencyKey) => ({ tenantId: TENANT_ID, contactId: "contact-1", message: "conformance test", idempotencyKey }),
    );
  }
  genericConformanceSuite(
    "crm book_provider_appointment — emulator",
    bookProviderAppointmentContract,
    bookProviderAppointmentEmulatorBinding,
    BookProviderAppointmentOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, contactId: "contact-1", startTime: new Date().toISOString(), idempotencyKey }),
  );

  // --- Phase 3: Accounting ---------------------------------------------------------
  genericConformanceSuite(
    "accounting sync_invoice — emulator",
    syncInvoiceContract,
    syncInvoiceEmulatorBinding,
    SyncInvoiceOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, customerName: "Conformance Customer", amountUsd: 100, idempotencyKey }),
  );
  if (isQuickBooksConfigured()) {
    genericConformanceSuite(
      "accounting sync_invoice — quickbooks",
      syncInvoiceContract,
      syncInvoiceQuickbooksBinding,
      SyncInvoiceOutputSchema,
      (idempotencyKey) => ({ tenantId: TENANT_ID, customerName: "Conformance Customer", amountUsd: 100, idempotencyKey }),
    );
  }
  genericConformanceSuite(
    "accounting create_payment_link — emulator",
    createPaymentLinkContract,
    createPaymentLinkEmulatorBinding,
    CreatePaymentLinkOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, invoiceId: TENANT_ID, amountUsd: 100, idempotencyKey }),
  );

  // --- Phase 3: Marketing -----------------------------------------------------------
  genericConformanceSuite(
    "marketing launch_ad_campaign — emulator",
    launchAdCampaignContract,
    launchAdCampaignEmulatorBinding,
    LaunchAdCampaignOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, name: "Conformance Campaign", dailyBudgetUsd: 25, idempotencyKey }),
  );
  genericConformanceSuite(
    "marketing launch_ad_campaign — dry_run (today's real behavior — no live write-scope credentials exist anywhere)",
    launchAdCampaignContract,
    launchAdCampaignDryRunBinding,
    LaunchAdCampaignOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, name: "Conformance Campaign", dailyBudgetUsd: 25, idempotencyKey }),
  );

  // --- Phase 3: Inventory ------------------------------------------------------------
  genericConformanceSuite(
    "inventory reserve_stock — emulator",
    reserveStockContract,
    reserveStockEmulatorBinding,
    ReserveStockOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, sku: "CONFORMANCE-SKU-EMU", quantity: 1, idempotencyKey }),
    async () => {
      await executeCapability(TENANT_ID, await newStep("receive_procurement"), receiveProcurementContract, receiveProcurementEmulatorBinding, {
        tenantId: TENANT_ID,
        sku: "CONFORMANCE-SKU-EMU",
        quantityOrdered: 1000,
        idempotencyKey: "conformance-seed-emu",
      });
    },
  );
  genericConformanceSuite(
    "inventory reserve_stock — native",
    reserveStockContract,
    reserveStockNativeBinding,
    ReserveStockOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, sku: "CONFORMANCE-SKU-NATIVE", quantity: 1, idempotencyKey }),
    async () => {
      await executeCapability(TENANT_ID, await newStep("receive_procurement"), receiveProcurementContract, receiveProcurementNativeBinding, {
        tenantId: TENANT_ID,
        sku: "CONFORMANCE-SKU-NATIVE",
        quantityOrdered: 1000,
        idempotencyKey: "conformance-seed-native",
      });
    },
  );
  genericConformanceSuite(
    "inventory receive_procurement — emulator",
    receiveProcurementContract,
    receiveProcurementEmulatorBinding,
    ReceiveProcurementOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, sku: "CONFORMANCE-SKU-RECEIVE-EMU", quantityOrdered: 5, idempotencyKey }),
  );
  genericConformanceSuite(
    "inventory receive_procurement — native",
    receiveProcurementContract,
    receiveProcurementNativeBinding,
    ReceiveProcurementOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, sku: "CONFORMANCE-SKU-RECEIVE-NATIVE", quantityOrdered: 5, idempotencyKey }),
  );

  // --- Phase 3: Documents -----------------------------------------------------------
  genericConformanceSuite(
    "documents generate_document — emulator",
    generateDocumentContract,
    generateDocumentEmulatorBinding,
    GenerateDocumentOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, kind: "compliance_report", title: "Conformance Test Document", idempotencyKey }),
  );
  genericConformanceSuite(
    "documents generate_document — native",
    generateDocumentContract,
    generateDocumentNativeBinding,
    GenerateDocumentOutputSchema,
    (idempotencyKey) => ({ tenantId: TENANT_ID, kind: "compliance_report", title: "Conformance Test Document", idempotencyKey }),
  );
  genericConformanceSuite(
    "documents request_signature — emulator",
    requestSignatureContract,
    requestSignatureEmulatorBinding,
    RequestSignatureOutputSchema,
    (idempotencyKey) => ({
      tenantId: TENANT_ID,
      documentId: "doc-1",
      signerName: "Conformance Signer",
      signerEmail: "signer@example.com",
      idempotencyKey,
    }),
  );
});
