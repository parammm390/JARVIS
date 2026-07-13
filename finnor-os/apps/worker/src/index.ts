// Worker service (§16): one process, multiple job-type handlers registered by string key.

import "dotenv/config";

import { JobQueue } from "./queue";
import { sendMessage } from "./handlers/send-message";
import { scheduledReminder } from "./handlers/scheduled-reminder";
import { reconciliation } from "./handlers/reconciliation";
import { processInstruction } from "./handlers/process-instruction";
import { voiceConfirmRequest } from "./handlers/voice-confirm-request";
import { voiceNotifyFailure } from "./handlers/voice-notify-failure";
import { scanColdLeads } from "./handlers/scan-cold-leads";
import { scanLowInventory } from "./handlers/scan-low-inventory";
import { scanServiceDue } from "./handlers/scan-service-due";
import { ownerDigest } from "./handlers/owner-digest";
import { quickbooksSync } from "./handlers/quickbooks-sync";
import { criticReview } from "./handlers/critic-review";
import { learningDigest } from "./handlers/learning-digest";
import { startScheduler, type ScheduledScan } from "./scheduler";

export function createWorker(): JobQueue {
  const queue = new JobQueue();
  queue.register("send_message", sendMessage);
  queue.register("scheduled_reminder", scheduledReminder);
  queue.register("reconciliation", reconciliation);
  queue.register("process_instruction", processInstruction);
  queue.register("voice_confirm_request", voiceConfirmRequest);
  queue.register("voice_notify_failure", voiceNotifyFailure);
  queue.register("scan_cold_leads", scanColdLeads);
  queue.register("scan_low_inventory", scanLowInventory);
  queue.register("scan_service_due", scanServiceDue);
  queue.register("owner_digest", ownerDigest);
  queue.register("quickbooks_sync", quickbooksSync);
  queue.register("critic_review", criticReview);
  queue.register("learning_digest", learningDigest);
  return queue;
}

// The proactive pillar: every entry here is a real, gated-or-findings-recorded scan,
// never an unattended mutation. Intervals are the MINIMUM gap between runs, not a
// promise of exact timing — the scheduler ticks every 15 min and only actually
// enqueues once a scan's window has rolled over (see scheduler.ts's dateBucket()).
const PROACTIVE_SCANS: ScheduledScan[] = [
  { type: "scheduled_reminder", intervalHours: 24, payload: (tenantId) => ({ tenantId, windowDays: 30 }) },
  { type: "scan_cold_leads", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  { type: "scan_low_inventory", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  { type: "scan_service_due", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  { type: "learning_digest", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  // Digest runs last-of-day relative to the scans above only in spirit — ticks are
  // independent, so in practice it reads whatever's accumulated in scan_findings by
  // the time its own daily window rolls over, which is close enough for a v1 digest.
  { type: "owner_digest", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
];

const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  console.log("[worker] started, polling jobs table");
  startScheduler(PROACTIVE_SCANS, 15 * 60_000, controller.signal);
  createWorker()
    .runLoop(2000, controller.signal)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
