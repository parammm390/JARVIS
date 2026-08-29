import { expireInteractiveWorkInput } from "@finnor/db";
import type { JobHandler } from "../queue";

/** Deadline delivery is idempotent. Terminal/progressed Work is a no-op; only the
 * exact still-active input in received/understanding/planning may be closed. */
export const reconcileInteractiveWork: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  const workId = String(payload.workId ?? "");
  const workInputId = String(payload.workInputId ?? "");
  const attemptKey = typeof payload.attemptKey === "string" ? payload.attemptKey : undefined;
  if (!tenantId || !workId || !workInputId) throw new Error("reconcile_interactive_work requires tenantId, workId, and workInputId");
  await expireInteractiveWorkInput({ tenantId, workId, workInputId, attemptKey });
};
