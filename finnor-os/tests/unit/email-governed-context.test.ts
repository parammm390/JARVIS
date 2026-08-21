import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import { createCredentialContextForTesting } from "@finnor/security";
import { sendEmail, setEmailTransportForTesting } from "../../packages/tools/src/email";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";

afterEach(() => {
  setEmailTransportForTesting(null);
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

describe("Gmail governed credential context", () => {
  it("uses the selected tenant identity instead of process-global sender state", async () => {
    process.env.GMAIL_USER = "wrong-global@example.test";
    process.env.GMAIL_APP_PASSWORD = "wrong-global-password";
    const sendMail = vi.fn(async () => ({ messageId: "message-1" }));
    setEmailTransportForTesting({ sendMail } as unknown as Transporter);
    const context = createCredentialContextForTesting(TENANT_ID, "gmail", {
      user: "alice@example.test",
      appPassword: "tenant-scoped-app-password",
    });

    await expect(sendEmail({
      tenantId: TENANT_ID,
      to: "customer@example.test",
      subject: "Quote",
      body: "Your quote is ready.",
    }, context)).resolves.toEqual({ messageId: "message-1" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "alice@example.test",
      to: "customer@example.test",
    }));
  });

  it("rejects a credential context selected for another tenant", async () => {
    const sendMail = vi.fn();
    setEmailTransportForTesting({ sendMail } as unknown as Transporter);
    const context = createCredentialContextForTesting(
      "20000000-0000-4000-8000-000000000002",
      "gmail",
      { user: "other@example.test", appPassword: "other-password" },
    );

    await expect(sendEmail({
      tenantId: TENANT_ID,
      to: "customer@example.test",
      subject: "Quote",
      body: "Your quote is ready.",
    }, context)).rejects.toThrow(/tenant mismatch/i);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
