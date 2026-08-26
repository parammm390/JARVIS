/**
 * The public result of one instruction submission.
 *
 * This is deliberately a discriminated union. A durable Objective is not an
 * empty action plan, and an acknowledgement is not an Answer. API, browser,
 * replay, and certification callers compile against this one contract.
 */
export type InstructionExecutionModel =
  | "QUERY"
  | "CONVERSATION"
  | "ATOMIC_EFFECT"
  | "OBJECTIVE";

export type AssistantSemanticKind =
  | "ANSWER"
  | "ACKNOWLEDGEMENT"
  | "CLARIFICATION";

export interface InstructionAssistantMessage {
  id: string;
  originalText: string;
  createdAt: string;
  semanticKind: AssistantSemanticKind;
}

interface InstructionSubmissionBase<TAction> {
  executionModel: InstructionExecutionModel;
  actions: TAction[];
  workId: string;
  workInputId: string;
  instructionId: string;
  threadId: string;
  assistantMessage: InstructionAssistantMessage;
}

export interface QueryInstructionSubmission<TAction = never, TQuery = unknown, TAnswer = unknown>
  extends InstructionSubmissionBase<TAction> {
  executionModel: "QUERY";
  actions: [];
  query: TQuery;
  answer?: TAnswer;
}

export interface ConversationInstructionSubmission<TAction = never, TAnswer = unknown>
  extends InstructionSubmissionBase<TAction> {
  executionModel: "CONVERSATION";
  actions: [];
  answer: TAnswer;
}

export interface AtomicEffectInstructionSubmission<TAction = unknown>
  extends InstructionSubmissionBase<TAction> {
  executionModel: "ATOMIC_EFFECT";
  actions: TAction[];
}

export interface ObjectiveInstructionSubmission<TAction = never>
  extends InstructionSubmissionBase<TAction> {
  executionModel: "OBJECTIVE";
  actions: [];
  objectiveLoopId: string;
  objectiveState: string;
}

export type InstructionSubmissionResult<TAction = unknown, TQuery = unknown, TAnswer = unknown> =
  | QueryInstructionSubmission<TAction, TQuery, TAnswer>
  | ConversationInstructionSubmission<TAction, TAnswer>
  | AtomicEffectInstructionSubmission<TAction>
  | ObjectiveInstructionSubmission<TAction>;
