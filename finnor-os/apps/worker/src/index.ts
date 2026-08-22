// Worker service (§16): one process, multiple job-type handlers registered by string key.

import "dotenv/config";

import { initObservability, getLogger, applyEmulatorFaultsFromEnv } from "@finnor/tools";
import { ensureSecretsLoaded } from "@finnor/security";
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
import { scanDlqTriage } from "./handlers/scan-dlq-triage";
import { backupDb } from "./handlers/backup-db";
import { dailyScorecard } from "./handlers/daily-scorecard";
import { projectReadModels } from "./handlers/project-read-models";
import { repairPlanAfterTerminalFailure } from "./handlers/repair-plan-after-terminal-failure";
import { suggestDailyRoutes } from "./handlers/suggest-daily-routes";
import { sendPushNotification } from "./handlers/send-push-notification";
import { scanEwmaReorder } from "./handlers/scan-ewma-reorder";
import { purgeRetention } from "./handlers/purge-retention";
import { sendResendEmailJob } from "./handlers/send-resend-email";
import { dispatchBusinessOperation, executeBusinessOperationCallBatch, executeBusinessOperationTarget } from "./handlers/business-operation";
import { startScheduler, startGlobalScheduler, type ScheduledScan } from "./scheduler";
import { startHeartbeat } from "./heartbeat";
import { startSseServer } from "./sse-server";
import { recoverObjectives, runObjectiveIteration } from "./handlers/run-objective-iteration";
import { runClientFactoryJob } from "./handlers/run-client-factory";
import { recoverComputerTasks, runComputerTask } from "./handlers/run-computer-task";
import { processWorkEventWaitDeadlineHandler } from "./handlers/process-work-event-wait-deadline";
import { scanConnectionHealth } from "./handlers/scan-connection-health";
import { releaseProbe } from "./handlers/release-probe";

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
  queue.register("scan_dlq_triage", scanDlqTriage);
  queue.register("backup_db", backupDb);
  queue.register("daily_scorecard", dailyScorecard);
  queue.register("project_read_models", projectReadModels);
  queue.register("repair_plan_after_terminal_failure", repairPlanAfterTerminalFailure);
  queue.register("suggest_daily_routes", suggestDailyRoutes);
  queue.register("send_push_notification", sendPushNotification);
  queue.register("scan_ewma_reorder", scanEwmaReorder);
  queue.register("purge_retention", purgeRetention);
  queue.register("send_resend_email", sendResendEmailJob);
  queue.register("dispatch_business_operation", dispatchBusinessOperation);
  queue.register("execute_business_operation_target", executeBusinessOperationTarget);
  queue.register("execute_business_operation_call_batch", executeBusinessOperationCallBatch);
  queue.register("run_objective_iteration", runObjectiveIteration);
  queue.register("recover_objectives", recoverObjectives);
  queue.register("run_client_factory", runClientFactoryJob);
  queue.register("run_computer_task", runComputerTask);
  queue.register("recover_computer_tasks", recoverComputerTasks);
  queue.register("process_work_event_wait_deadline", processWorkEventWaitDeadlineHandler);
  queue.register("scan_connection_health", scanConnectionHealth);
  queue.register("release_probe", releaseProbe);
  return queue;
}

// The proactive pillar: every entry here is a real, gated-or-findings-recorded scan,
// never an unattended mutation. Intervals are the MINIMUM gap between runs, not a
// promise of exact timing — the scheduler ticks every 15 min and only actually
// enqueues once a scan's window has rolled over (see scheduler.ts's dateBucket()).
const PROACTIVE_SCANS: ScheduledScan[] = [
  // Upgrade 9 restart/approval/operation backstop. Normal continuations are event-
  // driven and immediate; this scan only repairs a missed enqueue after a crash.
  { type: "recover_objectives", intervalHours: 1 / 6, payload: (tenantId) => ({ tenantId }) },
  { type: "recover_computer_tasks", intervalHours: 1 / 6, payload: (tenantId) => ({ tenantId }) },
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
  { type: "scan_connection_health", intervalHours: 1 / 4, payload: (tenantId) => ({ tenantId }) },
  // A4.T2: same honest sub-hourly posture as scan_integration_health just above — real
  // cadence is this scheduler's own 15-min tick, not this number. The exit gate's "<5min"
  // claim is about direct-invocation detection latency (see the integration test), not
  // this production scheduler's real-world firing frequency.
  { type: "scan_watchdog", intervalHours: 1 / 6, payload: (tenantId) => ({ tenantId }) },
  // A4.T3: an advisory recommendation, not urgent — hourly is plenty (an owner reviewing
  // the DLQ browser sees a suggestion at most an hour stale, same cadence as the other
  // operational-health scans above).
  { type: "scan_dlq_triage", intervalHours: 1, payload: (tenantId) => ({ tenantId }) },
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
  { type: "suggest_daily_routes", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  { type: "scan_ewma_reorder", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
  { type: "purge_retention", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
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
  ensureSecretsLoaded().then(() => {
  initObservability();
  const log = getLogger();
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  log.info({ event: "worker_started" }, "[worker] started, polling jobs table");
  // A3.T4: EMULATOR_FAULTS=<capability>:<mode>,... — never set in production;
  // local/CI chaos runs opt in explicitly.
  const faultedCapabilities = applyEmulatorFaultsFromEnv();
  if (faultedCapabilities.length > 0) {
    log.warn({ event: "emulator_faults_applied", capabilities: faultedCapabilities }, "[worker] EMULATOR_FAULTS applied — emulators are adversarial");
  }
  startHeartbeat(30_000, controller.signal);
  const certificationMode = process.env.FINNOR_ENVIRONMENT?.trim() === "staging" && process.env.P3_DISABLE_PROACTIVE_SCHEDULER?.trim() === "1";
  if (certificationMode) {
    log.warn({ event: "proactive_scheduler_disabled", reason: "P3 staging certification mode" }, "[scheduler] proactive scans disabled for isolated staging certification");
  } else {
    startScheduler(PROACTIVE_SCANS, 15 * 60_000, controller.signal);
  }
  // A4.T4: global (no tenant loop) — a DB backup isn't per-tenant data, same posture as
  // worker_heartbeat. No-ops loudly inside the handler itself until Param supplies
  // BACKUP_GITHUB_TOKEN/BACKUP_GITHUB_REPO.
  if (!certificationMode) startGlobalScheduler("backup_db", 6, 15 * 60_000, controller.signal);
  // The SSE gateway shares the persistent worker process and binds only when the
  // deployment supplies PORT. Local job-loop development does not require a port.
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
  }).catch((err) => {
    console.error("[worker] refused to boot: managed secrets validation failed", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
