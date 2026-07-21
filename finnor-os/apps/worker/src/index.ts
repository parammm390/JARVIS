// Worker service (§16): one process, multiple job-type handlers registered by string key.

import "dotenv/config";

import { initObservability, getLogger } from "@finnor/tools";
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
import { scanDataQuality } from "./handlers/scan-data-quality";
import { runWorkflowStep } from "./handlers/run-workflow-step";
import { relayOutboxEventsHandler } from "./handlers/relay-outbox-events";
import { scanAppointmentNoShows } from "./handlers/scan-appointment-no-shows";
import { ownerDigest } from "./handlers/owner-digest";
import { quickbooksSync } from "./handlers/quickbooks-sync";
import { criticReview } from "./handlers/critic-review";
import { learningDigest } from "./handlers/learning-digest";
import { scanApprovalExpiry } from "./handlers/scan-approval-expiry";
import { simulatorTick } from "./handlers/simulator-tick";
import { scanReliabilityAlerts } from "./handlers/scan-reliability-alerts";
import { dailyScorecard } from "./handlers/daily-scorecard";
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
  queue.register("scan_data_quality", scanDataQuality);
  queue.register("run_workflow_step", runWorkflowStep);
  queue.register("relay_outbox_events", relayOutboxEventsHandler);
  queue.register("scan_appointment_no_shows", scanAppointmentNoShows);
  queue.register("owner_digest", ownerDigest);
  queue.register("quickbooks_sync", quickbooksSync);
  queue.register("critic_review", criticReview);
  queue.register("learning_digest", learningDigest);
  queue.register("scan_approval_expiry", scanApprovalExpiry);
  queue.register("simulator_tick", simulatorTick);
  queue.register("scan_reliability_alerts", scanReliabilityAlerts);
  queue.register("daily_scorecard", dailyScorecard);
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
  { type: "scan_data_quality", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  { type: "relay_outbox_events", intervalHours: 1, payload: (tenantId) => ({ tenantId }) },
  { type: "scan_appointment_no_shows", intervalHours: 1, payload: (tenantId) => ({ tenantId }) },
  // Hourly, not daily like most scans above — a confirmation_timeout_hours default of
  // 24h loses most of its meaning if the check that enforces it only runs once a day.
  { type: "scan_approval_expiry", intervalHours: 1, payload: (tenantId) => ({ tenantId }) },
  // Phase 6 (§6.6): reliability thresholds are operational-health signals, not
  // business-day cadence — hourly, same reasoning as scan_approval_expiry above.
  { type: "scan_reliability_alerts", intervalHours: 1, payload: (tenantId) => ({ tenantId }) },
  { type: "learning_digest", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  // §3.3: no-ops for any tenant whose tenant_settings.simulator_enabled isn't true —
  // enqueued for every tenant like every other scan, gated by real DB state, not a
  // hardcoded Dealer Zero check. dateSeed is the actual calendar day, computed here
  // (not inside the handler) so the same real day always buckets to the same job.
  { type: "simulator_tick", intervalHours: 24, payload: (tenantId) => ({ tenantId, dateSeed: new Date().toISOString().slice(0, 10) }) },
  // Digest runs last-of-day relative to the scans above only in spirit — ticks are
  // independent, so in practice it reads whatever's accumulated in scan_findings by
  // the time its own daily window rolls over, which is close enough for a v1 digest.
  { type: "owner_digest", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  // Phase 8 (§8.3): the 30-day certification's daily readiness row. Runs after the
  // scans above have had their own daily window to complete for the day, same
  // "close enough for a v1" reasoning as owner_digest.
  { type: "daily_scorecard", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
];

const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  // Phase 16(e): the worker never initialized Sentry before this — a crash here was
  // console.error or nothing (ground-truth §5). initObservability() no-ops harmlessly
  // without SENTRY_DSN, so this is safe to call unconditionally at boot.
  initObservability();
  const log = getLogger();
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  log.info({ event: "worker_started" }, "[worker] started, polling jobs table");
  startScheduler(PROACTIVE_SCANS, 15 * 60_000, controller.signal);
  createWorker()
    .runLoop(2000, controller.signal)
    .then(() => process.exit(0))
    .catch((err) => {
      log.fatal({ err: err instanceof Error ? err.message : String(err) }, "[worker] run loop crashed");
      process.exit(1);
    });
}
