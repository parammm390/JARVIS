// Worker service (§16): one process, multiple job-type handlers registered by string key.

import "dotenv/config";

import { initObservability, getLogger, applyEmulatorFaultsFromEnv } from "@finnor/tools";
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
import { scanIntegrationHealth } from "./handlers/scan-integration-health";
import { scanWatchdog } from "./handlers/scan-watchdog";
import { dailyScorecard } from "./handlers/daily-scorecard";
import { projectReadModels } from "./handlers/project-read-models";
import { startScheduler, type ScheduledScan } from "./scheduler";
import { startHeartbeat } from "./heartbeat";
import { startSseServer } from "./sse-server";

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
  queue.register("scan_integration_health", scanIntegrationHealth);
  queue.register("scan_watchdog", scanWatchdog);
  queue.register("daily_scorecard", dailyScorecard);
  queue.register("project_read_models", projectReadModels);
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
  // A3.T2: sub-hourly per the plan's "10 min" — dateBucket()'s minute-granularity path
  // for intervalHours<1 means the real-world cadence is actually governed by this
  // scheduler's own 15-min tick (see scheduler.ts's own "not a promise of exact
  // timing" header), same honest "close enough" posture as every other sub-daily scan.
  { type: "scan_integration_health", intervalHours: 1 / 6, payload: (tenantId) => ({ tenantId }) },
  // A4.T2: same honest sub-hourly posture as scan_integration_health just above — real
  // cadence is this scheduler's own 15-min tick, not this number. The exit gate's "<5min"
  // claim is about direct-invocation detection latency (see the integration test), not
  // this production scheduler's real-world firing frequency.
  { type: "scan_watchdog", intervalHours: 1 / 6, payload: (tenantId) => ({ tenantId }) },
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
  // B1.T3: the debounced NOTIFY-driven refresh (sse-server.ts) is the fast path for
  // most of pipeline-health/reliability/activity-snapshot; this hourly tick is the
  // backstop for the one coverage gap (proposals has no NOTIFY trigger — migration
  // 0037's own comment) and anything missed during a LISTEN reconnect.
  { type: "project_read_models", intervalHours: 1, payload: (tenantId) => ({ tenantId }) },
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
  // A3.T4: EMULATOR_FAULTS=<capability>:<mode>,... — never set in Railway prod/staging
  // per the ledger, so this is a no-op there; local/CI chaos runs opt in explicitly.
  const faultedCapabilities = applyEmulatorFaultsFromEnv();
  if (faultedCapabilities.length > 0) {
    log.warn({ event: "emulator_faults_applied", capabilities: faultedCapabilities }, "[worker] EMULATOR_FAULTS applied — emulators are adversarial");
  }
  startHeartbeat(30_000, controller.signal);
  startScheduler(PROACTIVE_SCANS, 15 * 60_000, controller.signal);
  // B1.T2, deployed same process as the job loop: this repo's single railway.json
  // start command (`npx tsx apps/$SERVICE_APP/src/index.ts`) means finnor-worker has
  // exactly one entrypoint — a second Railway service isn't needed (and isn't
  // "free tier only" per hard rule #5) when the SSE gateway can just bind its own
  // port inside the same already-running process. Only starts if Railway (or any
  // host) actually provides a PORT — local `npm run dev`/`start` for the job loop
  // alone stays exactly as before, no port required.
  if (process.env.PORT) {
    const ssePort = Number(process.env.PORT);
    startSseServer(ssePort, controller.signal)
      .then(() => log.info({ port: ssePort }, "[sse] gateway listening (same process as job loop)"))
      .catch((err) => {
        log.error({ err: err instanceof Error ? err.message : String(err) }, "[sse] gateway failed to start — job loop continues regardless");
      });
  }
  createWorker()
    .runLoop(2000, controller.signal)
    .then(() => process.exit(0))
    .catch((err) => {
      log.fatal({ err: err instanceof Error ? err.message : String(err) }, "[worker] run loop crashed");
      process.exit(1);
    });
}
