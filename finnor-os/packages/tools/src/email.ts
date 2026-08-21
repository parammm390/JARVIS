// Real email via Gmail SMTP (nodemailer) — a genuine delivery channel that needs no
// paid plan or card. Transport is injectable so tests never send real mail.

import nodemailer, { type Transporter } from "nodemailer";
import { IntegrationError } from "./errors";
import type { TenantCredentialContext } from "@finnor/security";

export type GmailCredentialContext = TenantCredentialContext<"gmail">;

let transporterOverride: Transporter | null = null;

/** Tests inject a stub transport here; production uses the governed Gmail context. */
export function setEmailTransportForTesting(t: Transporter | null): void {
  transporterOverride = t;
}

function getTransporter(context: GmailCredentialContext): Transporter {
  if (transporterOverride) return transporterOverride;
  return nodemailer.createTransport({ service: "gmail", auth: { user: context.credentials.user, pass: context.credentials.appPassword } });
}

export async function sendEmail(opts: {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
}, context: GmailCredentialContext): Promise<{ messageId: string }> {
  if (context.tenantId !== opts.tenantId) throw new IntegrationError("email", "Gmail credential context tenant mismatch", false);
  const transporter = getTransporter(context);
  try {
    const info = await transporter.sendMail({
      from: context.credentials.user,
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
    });
    return { messageId: String(info.messageId ?? "sent") };
  } catch (err) {
    throw new IntegrationError("email", `send failed: ${(err as Error).message}`, true);
  }
}

/** Verify SMTP credentials without sending anything. */
export async function verifyEmailTransport(context: GmailCredentialContext): Promise<boolean> {
  try {
    await getTransporter(context).verify();
    return true;
  } catch {
    return false;
  }
}
