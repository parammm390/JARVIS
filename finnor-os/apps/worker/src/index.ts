// Worker service (§16): one process, multiple job-type handlers registered by string key.

import "dotenv/config";

import { JobQueue } from "./queue";
import { sendMessage } from "./handlers/send-message";
import { scheduledReminder } from "./handlers/scheduled-reminder";
import { reconciliation } from "./handlers/reconciliation";
import { processInstruction } from "./handlers/process-instruction";
import { voiceConfirmRequest } from "./handlers/voice-confirm-request";
import { voiceNotifyFailure } from "./handlers/voice-notify-failure";

export function createWorker(): JobQueue {
  const queue = new JobQueue();
  queue.register("send_message", sendMessage);
  queue.register("scheduled_reminder", scheduledReminder);
  queue.register("reconciliation", reconciliation);
  queue.register("process_instruction", processInstruction);
  queue.register("voice_confirm_request", voiceConfirmRequest);
  queue.register("voice_notify_failure", voiceNotifyFailure);
  return queue;
}

const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  console.log("[worker] started, polling jobs table");
  createWorker()
    .runLoop(2000, controller.signal)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
