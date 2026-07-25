// B8.T1: worker-owned Web Push delivery. Callers provide a tenant-scoped event and
// optional action id; this handler resolves recipients and removes only confirmed-dead
// subscriptions (410/404). A missing VAPID configuration fails loudly rather than
// pretending that a notification was delivered.
import webpush from "web-push";
import { getPool } from "@finnor/db";
import type { JobHandler } from "../queue";

type PushKind = "approval-needed" | "slo-burn" | "watchdog-critical";
const TITLES: Record<PushKind, string> = {
  "approval-needed": "Approval needed",
  "slo-burn": "SLO attention needed",
  "watchdog-critical": "JARVIS watchdog alert",
};

export const sendPushNotification: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  const kind = String(payload.kind ?? "") as PushKind;
  const actionId = payload.actionId ? String(payload.actionId) : null;
  const body = String(payload.body ?? "An operational update needs your attention.").slice(0, 240);
  if (!tenantId || !Object.hasOwn(TITLES, kind)) throw new Error("send_push_notification requires tenantId and a known kind");
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are required");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const { rows } = await getPool().query(
    `SELECT id, endpoint, p256dh, auth FROM finnor_os.push_subscriptions WHERE tenant_id = $1`, [tenantId],
  );
  const message = JSON.stringify({ title: TITLES[kind], body, path: actionId ? `/jarvis?approval=${encodeURIComponent(actionId)}` : "/jarvis" });
  for (const row of rows) {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message);
    } catch (err) {
      const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) await getPool().query("DELETE FROM finnor_os.push_subscriptions WHERE id = $1", [row.id]);
      else throw err;
    }
  }
};
