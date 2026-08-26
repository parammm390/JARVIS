import type { DomainEnginePlugin, PureDomainEngine } from "../shared/plugin-interface";
import { queueComputerRun } from "@finnor/computer";
import type { ComputerTaskInput, DraftAction, DomainPolicy, ExecutionResult, ValidationResult } from "@finnor/shared-types";
import { z } from "zod";

const targetSchema = z.object({
  kind: z.string().trim().min(1).max(120),
  identifier: z.string().trim().min(1).max(500),
}).strict();

const scalarSchema = z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null()]);
const authorizedEffectSchema = z.object({
  operation: z.string().trim().min(1).max(200),
  target: targetSchema,
  changes: z.record(z.string().trim().min(1).max(120), scalarSchema),
}).strict();

export const ComputerTaskSchema = z.object({
  application: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9_-]*$/),
  authProfileRef: z.string().trim().min(3).max(128).regex(/^[a-z0-9][a-z0-9_-]*$/),
  task: z.string().trim().min(3).max(4000),
  target: targetSchema,
  mode: z.enum(["READ_ONLY", "WRITE"]),
  successCriteria: z.array(z.string().trim().min(3).max(500)).min(1).max(12),
  authorizedEffect: authorizedEffectSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "READ_ONLY" && value.authorizedEffect) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["authorizedEffect"], message: "READ_ONLY tasks cannot authorize an external mutation" });
  }
  if (value.mode === "WRITE" && !value.authorizedEffect) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["authorizedEffect"], message: "WRITE tasks require one precise authorized effect" });
  }
  if (value.authorizedEffect && (value.authorizedEffect.target.kind !== value.target.kind || value.authorizedEffect.target.identifier !== value.target.identifier)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["authorizedEffect", "target"], message: "The authorized effect target must exactly match the task target" });
  }
});

/** Migrated computer/durable-workflow intelligence. It can describe a run but has
 * no browser/session/provider capability; execute remains in the governed adapter. */
export const computerTaskDomainEngine: PureDomainEngine = {
  name: "computer-task",
  version: "1.0.0",
  actionTypes: ["computer_task"],
  query: () => ({ requiredFacts: ["application_account", "auth_profile", "computer_capability", "current_target_state"] }),
  decide: ({ payload }) => ({ eligible: payload.mode === "READ_ONLY" || (payload.mode === "WRITE" && Boolean(payload.authorizedEffect)), effectIntent: payload.mode === "WRITE" ? `Perform exactly the bounded authorized external change in ${String(payload.application)}` : `Inspect the bounded target in ${String(payload.application)}`, requiredCapability: "action:computer_task", risk: payload.mode === "WRITE" ? "high" : "low", reasonCodes: [payload.mode === "WRITE" ? "GOVERNED_COMPUTER_WRITE" : "GOVERNED_COMPUTER_READ"] }),
  simulate: ({ payload }) => ({ predicted: { application: payload.application, mode: payload.mode, target: payload.target, sessionCreated: false }, warnings: [] }),
  explain: (_input, decision) => ({ summary: decision.effectIntent, reasonCodes: decision.reasonCodes }),
  compileEffect: ({ effectId, payload }, decision) => {
    const target = payload.target as Record<string, unknown> | undefined;
    return { id: effectId, actionType: "computer_task", effectIntent: decision.effectIntent, payload, targetRefs: target ? [{ kind: "resource", entityType: String(target.kind), entityId: String(target.identifier), provenance: "pure_domain_engine" }] : [], requiredCapability: decision.requiredCapability, risk: decision.risk, exposure: null, proposalOnly: true };
  },
  defineObservation: ({ observationId, effect }) => ({ id: observationId, effectId: effect.id, kind: "computer_state", predicate: { terminalState: true, successCriteria: effect.payload.successCriteria }, requiredEvidence: ["computer_terminal_state", "computer_artifact_evidence", "external_state_read_back_where_required"], acknowledgementSufficient: false, verificationFloor: "at_least_existing" }),
  reconcileDecision: ({ observation }) => observation.terminal === true && observation.successCriteriaSatisfied === true && observation.evidencePresent === true
    ? { status: "verified", reasonCodes: ["TERMINAL_EVIDENCE_SATISFIES_CRITERIA"] }
    : observation.failed === true ? { status: "failed", reasonCodes: ["COMPUTER_RUN_FAILED"] } : { status: "pending", reasonCodes: ["TERMINAL_EVIDENCE_REQUIRED"] },
  compileCompensationEffect: () => null,
};

export const computerTaskPlugin: DomainEnginePlugin = {
  name: "computer-task",
  actionTypes: ["computer_task"],
  intelligence: computerTaskDomainEngine,
  payloadSchemas: { computer_task: ComputerTaskSchema },
  canHandle: (actionType) => actionType === "computer_task",
  validate(actionType, payload): ValidationResult {
    if (actionType !== "computer_task") return { valid: false, errors: [`unhandled action ${actionType}`] };
    const parsed = ComputerTaskSchema.safeParse(payload);
    return parsed.success ? { valid: true, errors: [] } : { valid: false, errors: parsed.error.issues.map((issue) => `payload.${issue.path.join(".")}: ${issue.message}`) };
  },
  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const task = ComputerTaskSchema.parse(payload);
    return {
      actionType,
      summary: task.mode === "WRITE"
        ? `Use ${task.application} as ${task.authProfileRef} to perform exactly: ${task.authorizedEffect!.operation} on ${task.target.kind} ${task.target.identifier}.`
        : `Use ${task.application} as ${task.authProfileRef} to inspect ${task.target.kind} ${task.target.identifier}: ${task.task}`,
      payload: task,
      // READ_ONLY follows policy. Every WRITE is approval-gated even if a tenant row
      // was accidentally configured otherwise.
      requiresConfirmation: task.mode === "WRITE" || policy.requiresConfirmation,
    };
  },
  simulate(_actionType, payload) {
    const task = ComputerTaskSchema.parse(payload);
    return {
      mode: "schema",
      summary: `A bounded ${task.mode} computer run would use the governed ${task.application}/${task.authProfileRef} binding. No session is created during simulation.`,
      predicted: { application: task.application, authProfileRef: task.authProfileRef, mode: task.mode, target: task.target, fieldChanges: [] },
    };
  },
  async execute(draft, tools): Promise<ExecutionResult> {
    try {
      const input = ComputerTaskSchema.parse(draft.payload) as ComputerTaskInput;
      const queued = await queueComputerRun(input, tools.runtimeContext());
      return {
        status: "success",
        output: { computerRunId: queued.run.id, computerRunStatus: queued.run.status, pendingComputerRun: true, duplicate: !queued.created },
        expected: { computerRunId: queued.run.id, terminalResultRequired: true },
      };
    } catch (error) {
      return { status: "failure", output: {}, error: error instanceof Error ? error.message : "Computer task could not be queued", errorKind: "validation" };
    }
  },
};

export default computerTaskPlugin;
