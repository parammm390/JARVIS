// Real email via Gmail SMTP (nodemailer) — a genuine delivery channel that needs no
// paid plan or card. Transport is injectable so tests never send real mail.

import nodemailer, { type Transporter } from "nodemailer";
import { IntegrationError } from "./errors";

let transporterOverride: Transporter | null = null;

/** Tests inject a stub transport here; production uses Gmail SMTP from env. */
export function setEmailTransportForTesting(t: Transporter | null): void {
  transporterOverride = t;
}

function getTransporter(): Transporter {
  if (transporterOverride) return transporterOverride;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new IntegrationError("email", "GMAIL_USER / GMAIL_APP_PASSWORD are not set", false);
  }
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  const transporter = getTransporter();
  try {
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
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
export async function verifyEmailTransport(): Promise<boolean> {
  try {
    await getTransporter().verify();
    return true;
  } catch {
    return false;
  }
}
