import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const payments = readFileSync(fileURLToPath(new URL("../../packages/data-platform/src/payments.ts", import.meta.url)), "utf8");
const webhook = readFileSync(fileURLToPath(new URL("../../packages/domain-plugins/invoice-to-cash/index.ts", import.meta.url)), "utf8");

describe("production-correctness payment settlement", () => {
  it("serializes on the invoice and marks paid only from cumulative net settlement", () => {
    expect(payments).toContain("FOR UPDATE");
    expect(payments).toContain("WHEN ${payments.status} = 'succeeded'");
    expect(payments).toContain("WHEN ${payments.status} = 'refunded'");
    expect(payments).toContain("if (balance.settled)");
    expect(payments.indexOf("if (balance.settled)")).toBeLessThan(payments.indexOf('db.update(invoices).set({ status: "paid" })'));
  });

  it("deduplicates the payment insert but still converges receipt and prediction state", () => {
    const apply = webhook.slice(webhook.indexOf("export async function applyPaymentWebhookEvent"));
    expect(apply).toContain("intake.settlement ?? await withTenant");
    expect(apply.indexOf("if (intake.duplicate) return")).toBe(-1);
    expect(apply).toContain('filter((field) => !field || typeof field !== "object"');
    expect(apply).toContain('return intake.duplicate ? { applied: false, reason: "duplicate delivery" } : { applied: true }');
  });
});
