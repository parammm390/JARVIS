import { z } from "zod";
import { CANONICAL_ENTITY_TYPES, PARTY_TYPES, UNIVERSAL_ACTION_TYPES } from "@finnor/shared-types";

const isoDateTime = z.string().datetime({ offset: true });

export const PartyRefSchema = z.object({
  partyType: z.enum(PARTY_TYPES),
  partyId: z.string().uuid(),
}).strict();

export const InternalAssigneeRefSchema = PartyRefSchema.refine(
  (value) => value.partyType === "employee" || value.partyType === "team",
  "assignee must be an employee or team PartyRef",
);
export const EmployeeRefSchema = PartyRefSchema.refine((value) => value.partyType === "employee", "target must be an employee PartyRef");
export const TeamRefSchema = PartyRefSchema.refine((value) => value.partyType === "team", "target must be a team PartyRef");
export const InternalParticipantRefSchema = PartyRefSchema.refine(
  (value) => value.partyType === "employee" || value.partyType === "team" || value.partyType === "location",
  "internal participant must be an employee, team, or location PartyRef",
);

export const CanonicalEntityRefSchema = z.object({
  entityType: z.enum(CANONICAL_ENTITY_TYPES),
  entityId: z.string().uuid(),
}).strict();
export const WorkRefSchema = z.object({ workId: z.string().uuid() }).strict();
export const TaskRefSchema = z.object({ taskId: z.string().uuid() }).strict();
export const DocumentRefSchema = z.object({ documentId: z.string().uuid() }).strict();
export const LocationRefSchema = z.object({ locationId: z.string().uuid() }).strict();
export const DelegationRefSchema = z.object({ delegationId: z.string().uuid() }).strict();
export const InternalEventRefSchema = z.object({ internalEventId: z.string().uuid() }).strict();
export const ObjectiveLoopRefSchema = z.object({ objectiveLoopId: z.string().uuid() }).strict();
export const CommunicationIdentityRefSchema = z.object({ communicationIdentityId: z.string().uuid() }).strict();

const optionalWork = WorkRefSchema.optional();
const optionalIdentity = CommunicationIdentityRefSchema.optional();

export const SendMessageSchema = z.object({
  recipient: PartyRefSchema,
  channel: z.enum(["internal", "email", "sms"]).default("internal"),
  body: z.string().trim().min(1).max(5000),
  subject: z.string().trim().min(1).max(300).optional(),
  workRef: optionalWork,
  communicationIdentityRef: optionalIdentity,
  purpose: z.string().trim().min(1).max(120).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.channel === "email" && !value.subject) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subject"], message: "email requires a subject" });
  if (value.channel === "internal" && value.communicationIdentityRef) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationIdentityRef"], message: "internal messages do not use an external sender identity" });
});

export const PlaceCallSchema = z.object({
  recipient: PartyRefSchema,
  objective: z.string().trim().min(1).max(1000),
  script: z.string().trim().min(1).max(5000).optional(),
  workRef: optionalWork,
  communicationIdentityRef: optionalIdentity,
  purpose: z.string().trim().min(1).max(120).optional(),
}).strict();

export const RequestAcknowledgementSchema = z.object({
  recipient: PartyRefSchema,
  request: z.string().trim().min(1).max(2000),
  deadline: isoDateTime.optional(),
  workRef: optionalWork,
  taskRef: TaskRefSchema.optional(),
  delegationRef: DelegationRefSchema.optional(),
}).strict();

export const NotifyGroupSchema = z.object({
  teamRef: TeamRefSchema,
  channel: z.enum(["internal", "email", "sms"]).default("internal"),
  body: z.string().trim().min(1).max(5000),
  subject: z.string().trim().min(1).max(300).optional(),
  workRef: optionalWork,
  communicationIdentityRef: optionalIdentity,
  purpose: z.string().trim().min(1).max(120).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.channel === "email" && !value.subject) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subject"], message: "email requires a subject" });
  if (value.channel === "internal" && value.communicationIdentityRef) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["communicationIdentityRef"], message: "internal notifications do not use an external sender identity" });
});

export const CreateTaskSchema = z.object({
  subjectRef: CanonicalEntityRefSchema,
  title: z.string().trim().min(1).max(500),
  dueAt: isoDateTime.optional(),
  assigneeRef: InternalAssigneeRefSchema.optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  workRef: optionalWork,
}).strict();

export const AssignTaskSchema = z.object({
  taskRef: TaskRefSchema,
  assigneeRef: InternalAssigneeRefSchema,
}).strict();

export const UpdateTaskSchema = z.object({
  taskRef: TaskRefSchema,
  title: z.string().trim().min(1).max(500).optional(),
  dueAt: isoDateTime.nullable().optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
}).strict().refine((value) => value.title !== undefined || value.dueAt !== undefined || value.status !== undefined || value.priority !== undefined, {
  message: "at least one task field must be updated",
});

export const HandoffWorkSchema = z.object({
  workRef: WorkRefSchema,
  targetEmployeeRef: EmployeeRefSchema,
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export const DelegateObjectiveSchema = z.object({
  workRef: WorkRefSchema,
  targetRef: InternalAssigneeRefSchema,
  objective: z.string().trim().min(1).max(2000),
  taskRef: TaskRefSchema.optional(),
  objectiveLoopRef: ObjectiveLoopRefSchema.optional(),
  acknowledgementDeadline: isoDateTime.optional(),
  completionDeadline: isoDateTime.optional(),
  escalationTargetRef: InternalAssigneeRefSchema.optional(),
  evidenceRefs: z.array(CanonicalEntityRefSchema).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.acknowledgementDeadline && value.completionDeadline && value.acknowledgementDeadline > value.completionDeadline) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completionDeadline"], message: "completion deadline must not precede acknowledgement deadline" });
  }
});

export const EscalateWorkSchema = z.object({
  delegationRef: DelegationRefSchema,
  targetRef: InternalAssigneeRefSchema.optional(),
  reason: z.string().trim().min(1).max(2000),
  evidenceRefs: z.array(CanonicalEntityRefSchema).max(20).default([]),
}).strict();

export const CancelDelegationSchema = z.object({
  delegationRef: DelegationRefSchema,
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const ScheduleInternalEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  purpose: z.string().trim().min(1).max(2000).optional(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  participants: z.array(InternalParticipantRefSchema).min(1).max(50),
  workRef: optionalWork,
  locationRef: LocationRefSchema.optional(),
}).strict().refine((value) => value.endsAt > value.startsAt, { path: ["endsAt"], message: "event end must be after start" });

export const RescheduleInternalEventSchema = z.object({
  internalEventRef: InternalEventRefSchema,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  reason: z.string().trim().min(1).max(1000),
}).strict().refine((value) => value.endsAt > value.startsAt, { path: ["endsAt"], message: "event end must be after start" });

export const ShareDocumentSchema = z.object({
  documentRef: DocumentRefSchema,
  recipient: PartyRefSchema,
  accessLevel: z.enum(["view", "comment"]).default("view"),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export const UNIVERSAL_ACTION_SCHEMAS: Record<(typeof UNIVERSAL_ACTION_TYPES)[number], z.ZodTypeAny> = {
  send_message: SendMessageSchema,
  place_call: PlaceCallSchema,
  request_acknowledgement: RequestAcknowledgementSchema,
  notify_group: NotifyGroupSchema,
  create_task: CreateTaskSchema,
  assign_task: AssignTaskSchema,
  update_task: UpdateTaskSchema,
  handoff_work: HandoffWorkSchema,
  delegate_objective: DelegateObjectiveSchema,
  escalate_work: EscalateWorkSchema,
  cancel_delegation: CancelDelegationSchema,
  schedule_internal_event: ScheduleInternalEventSchema,
  reschedule_internal_event: RescheduleInternalEventSchema,
  share_document: ShareDocumentSchema,
};
