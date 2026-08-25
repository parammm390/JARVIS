import {
  appendEmployeeConversationMessage,
  appointments,
  contacts,
  createEmployeeConversationThread,
  employeeConversationThreads,
  externalContacts,
  externalOrganizations,
  households,
  invoices,
  leads,
  listEmployeePersonalMemories,
  loadEmployeeConversationThread,
  proposals,
  quotes,
  rememberExplicitEmployeeMemory,
  searchEmployeeConversationMessages,
  updateEmployeeConversationMessageContext,
  updateEmployeeConversationThreadContext,
  users,
  withTenant,
  works,
} from "@finnor/db";
import { listAvailableIdentityAccess } from "@finnor/security";
import { mirrorConversationMessageToZep, queryConsolidatedFacts } from "@finnor/memory";
import type {
  CanonicalEntityType,
  ConversationReference,
  ConversationReferenceResolution,
  ConversationResolutionProvenance,
  EmployeeConversationChannel,
  EmployeeConversationContext,
  EmployeeConversationMessage,
  EmployeePersonalMemory,
  TenantContext,
} from "@finnor/shared-types";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSEQUENTIAL = /\b(?:email|call|text|contact|message|send|move|reschedule|schedule|book|create|update|delete|remove|void|pay|charge|notify|continue|finish|repeat|do\s+that)\b/i;
const PERSON_PRONOUN = /\b(?:him|her|them|that customer|that contact|that lead|that person)\b/i;
const OBJECT_PRONOUN = /\bit\b/i;
const CONTINUATION = /\b(?:continue(?:\s+that)?|do\s+that\s+again|finish\s+what\s+we\s+started|repeat\s+that)\b/i;
const REFERENCE_NOUNS: Array<[RegExp, CanonicalEntityType]> = [
  [/\b(?:that|the|this)\s+invoice\b/i, "invoice"],
  [/\b(?:that|the|this)\s+(?:appointment|booking)\b/i, "appointment"],
  [/\b(?:that|the|this)\s+quote\b/i, "quote"],
  [/\b(?:that|the|this)\s+proposal\b/i, "proposal"],
  [/\b(?:that|the|this)\s+work\b/i, "work"],
];
const PARTY_TYPES = new Set<CanonicalEntityType>(["household", "contact", "lead", "external_contact", "user"]);

interface CatalogEntry {
  entityType: CanonicalEntityType;
  entityId: string;
  label: string;
  aliases: string[];
  status?: string;
  householdId?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  leadId?: string | null;
}

type NamedExpressionCue = "party" | "appointment" | "invoice" | "quote" | "proposal" | "history";
interface NamedExpression {
  name: string;
  organization?: string;
  cue: NamedExpressionCue;
  index: number;
}

interface ReferenceGroup {
  expression: string;
  kind: string;
  candidates: ConversationReference[];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}@._]+/gu, " ").trim().replace(/\s+/g, " ");
}

function refKey(ref: { entityType: string; entityId: string }): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function source(
  stage: ConversationResolutionProvenance["stage"],
  sourceName: string,
  result: ConversationResolutionProvenance["result"],
  ref?: string,
  reason?: string,
): ConversationResolutionProvenance {
  return { stage, source: sourceName, result, ...(ref ? { ref } : {}), ...(reason ? { reason } : {}), asOf: new Date().toISOString() };
}

export async function resolveCanonicalHumanPrincipal(ctx: TenantContext): Promise<string> {
  const candidate = ctx.employeeId ?? (UUID.test(ctx.userId) ? ctx.userId : null);
  if (!candidate || ctx.userId.startsWith("system:")) throw new Error("canonical_human_principal_required");
  const valid = await withTenant(ctx.tenantId, async (db) => {
    const [row] = await db.select({ id: users.id }).from(users).where(and(
      eq(users.tenantId, ctx.tenantId),
      eq(users.id, candidate),
      eq(users.status, "active"),
    )).limit(1);
    return row?.id ?? null;
  }, candidate);
  if (!valid) throw new Error("canonical_human_principal_not_active");
  return valid;
}

function extractNamedExpressions(instruction: string): NamedExpression[] {
  const found: NamedExpression[] = [];
  const add = (name: string | undefined, organization: string | undefined, cue: NamedExpressionCue, index: number) => {
    const clean = name?.replace(/\s+/g, " ").trim().replace(/[.,!?]+$/, "");
    if (!clean || clean.length < 2) return;
    if (/^(?:the|this|that|my|our|him|her|them|it)$/i.test(clean)) return;
    const cleanOrganization = organization?.trim().replace(/[.,!?]+$/, "");
    const existing = found.find((item) => normalized(item.name) === normalized(clean) && normalized(item.organization ?? "") === normalized(cleanOrganization ?? ""));
    if (existing) {
      // A target-specific cue is more informative than the generic party cue,
      // while the earliest mention remains the stable ordering key.
      if (existing.cue === "party" && cue !== "party") existing.cue = cue;
      existing.index = Math.min(existing.index, index);
      return;
    }
    found.push({ name: clean, cue, index, ...(cleanOrganization ? { organization: cleanOrganization } : {}) });
  };
  for (const match of instruction.matchAll(/\b([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s+from\s+([A-Z][\p{L}\d&.' -]{1,80}?)(?=[,.!?]|\s+(?:and|use|then)\b|$)/gu)) add(match[1], match[2], "party", match.index ?? 0);
  for (const match of instruction.matchAll(/\b(?:[Ee]mail|[Cc]all|[Tt]ext|[Cc]ontact|[Mm]essage|[Nn]otify)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\b/gu)) add(match[1], undefined, "party", match.index ?? 0);
  for (const match of instruction.matchAll(/\b(?:move|moving|reschedule|schedule|book)\s+(?:the\s+)?([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)\b/gu)) add(match[1], undefined, "appointment", match.index ?? 0);
  for (const match of instruction.matchAll(/\b(?:the\s+)?([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)\s+(appointment|invoice|quote|proposal|account)\b/gu)) {
    const noun = match[2]?.toLocaleLowerCase();
    add(match[1], undefined, noun === "account" ? "party" : noun as NamedExpressionCue, match.index ?? 0);
  }
  for (const match of instruction.matchAll(/\b([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s+(?:we\s+discussed|we\s+talked\s+about)\b/gu)) add(match[1], undefined, "history", match.index ?? 0);
  return found.sort((left, right) => left.index - right.index).slice(0, 5);
}

function labelMatches(entry: CatalogEntry, expression: { name: string; organization?: string }): boolean {
  const needle = normalized(expression.name);
  const tokens = needle.split(" ");
  const aliases = [entry.label, ...entry.aliases].map(normalized);
  const nameMatch = aliases.some((alias) => alias === needle || alias.endsWith(` ${needle}`) || (tokens.length === 1 && alias.split(" ").includes(needle)));
  if (!nameMatch) return false;
  if (!expression.organization) return true;
  return normalized(entry.organizationName ?? "") === normalized(expression.organization)
    || normalized(entry.organizationName ?? "").includes(normalized(expression.organization));
}

async function loadCanonicalCatalog(tenantId: string, ownerEmployeeId: string): Promise<CatalogEntry[]> {
  return withTenant(tenantId, async (db) => {
    // Drizzle shares a single pg client inside withTenant. Keep these queries
    // ordered so pg never receives concurrent operations on that client.
    const householdRows = await db.select({ id: households.id, contactInfo: households.contactInfo, address: households.address }).from(households).where(eq(households.tenantId, tenantId)).limit(2000);
    const contactRows = await db.select({ id: contacts.id, householdId: contacts.householdId, name: contacts.name, firstName: contacts.firstName, lastName: contacts.lastName }).from(contacts).where(and(eq(contacts.tenantId, tenantId), isNull(contacts.archivedAt))).limit(2000);
    const leadRows = await db.select({ id: leads.id, householdId: leads.householdId, name: leads.name, email: leads.email }).from(leads).where(and(eq(leads.tenantId, tenantId), isNull(leads.archivedAt))).limit(2000);
    const externalRows = await db.select({ id: externalContacts.id, name: externalContacts.name, organizationId: externalContacts.externalOrganizationId }).from(externalContacts).where(and(eq(externalContacts.tenantId, tenantId), eq(externalContacts.active, true))).limit(2000);
    const organizationRows = await db.select({ id: externalOrganizations.id, name: externalOrganizations.name }).from(externalOrganizations).where(and(eq(externalOrganizations.tenantId, tenantId), eq(externalOrganizations.active, true))).limit(2000);
    const appointmentRows = await db.select({ id: appointments.id, subjectType: appointments.subjectType, subjectId: appointments.subjectId, status: appointments.status, scheduledAt: appointments.scheduledAt }).from(appointments).where(and(eq(appointments.tenantId, tenantId), inArray(appointments.status, ["hold", "confirmed"]), isNull(appointments.archivedAt))).limit(2000);
    const invoiceRows = await db.select({ id: invoices.id, householdId: invoices.householdId, status: invoices.status, memo: invoices.memo }).from(invoices).where(eq(invoices.tenantId, tenantId)).limit(2000);
    const quoteRows = await db.select({ id: quotes.id, householdId: quotes.householdId, leadId: quotes.leadId, status: quotes.status }).from(quotes).where(and(eq(quotes.tenantId, tenantId), isNull(quotes.archivedAt))).limit(2000);
    const proposalRows = await db.select({ id: proposals.id, householdId: proposals.householdId, content: proposals.content, status: proposals.status }).from(proposals).where(eq(proposals.tenantId, tenantId)).limit(2000);
    const catalog: CatalogEntry[] = [];
    const householdLabels = new Map<string, string>();
    for (const row of householdRows) {
      const info = object(row.contactInfo);
      const label = typeof info.name === "string" && info.name.trim() ? info.name.trim() : row.address;
      householdLabels.set(row.id, label);
      catalog.push({ entityType: "household", entityId: row.id, label, aliases: [row.address] });
    }
    for (const row of contactRows) {
      if (row.householdId) {
        catalog.push({ entityType: "household", entityId: row.householdId, label: row.name, aliases: [householdLabels.get(row.householdId) ?? "", row.firstName ?? "", row.lastName ?? ""], householdId: row.householdId });
      } else {
        catalog.push({ entityType: "contact", entityId: row.id, label: row.name, aliases: [row.firstName ?? "", row.lastName ?? ""] });
      }
    }
    for (const row of leadRows) {
      if (row.householdId) catalog.push({ entityType: "household", entityId: row.householdId, label: row.name, aliases: [householdLabels.get(row.householdId) ?? "", row.email ?? ""], householdId: row.householdId });
      else catalog.push({ entityType: "lead", entityId: row.id, label: row.name, aliases: [row.email ?? ""], householdId: row.householdId });
    }
    const orgNames = new Map(organizationRows.map((row) => [row.id, row.name]));
    for (const row of organizationRows) catalog.push({ entityType: "external_organization", entityId: row.id, label: row.name, aliases: [] });
    for (const row of externalRows) catalog.push({ entityType: "external_contact", entityId: row.id, label: row.name, aliases: [], organizationId: row.organizationId, organizationName: row.organizationId ? orgNames.get(row.organizationId) ?? null : null });
    for (const row of appointmentRows) {
      const subject = catalog.find((item) => item.entityType === row.subjectType && item.entityId === row.subjectId);
      catalog.push({ entityType: "appointment", entityId: row.id, label: `${subject?.label ?? row.subjectType} appointment`, aliases: [row.scheduledAt.toISOString()], status: row.status, householdId: row.subjectType === "household" ? row.subjectId : subject?.householdId });
    }
    for (const row of invoiceRows) catalog.push({ entityType: "invoice", entityId: row.id, label: `${householdLabels.get(row.householdId) ?? "Customer"} invoice`, aliases: [row.memo ?? ""], status: row.status, householdId: row.householdId });
    for (const row of quoteRows) catalog.push({ entityType: "quote", entityId: row.id, label: `${row.householdId ? householdLabels.get(row.householdId) ?? "Customer" : "Lead"} quote`, aliases: [], status: row.status, householdId: row.householdId, leadId: row.leadId });
    for (const row of proposalRows) {
      const content = object(row.content);
      const title = typeof content.title === "string" && content.title.trim() ? content.title.trim() : "proposal";
      catalog.push({ entityType: "proposal", entityId: row.id, label: `${householdLabels.get(row.householdId) ?? "Customer"} ${title}`, aliases: [title], status: row.status, householdId: row.householdId });
    }
    return catalog;
  }, ownerEmployeeId);
}

function dedupeCatalog(entries: CatalogEntry[]): CatalogEntry[] {
  const map = new Map<string, CatalogEntry>();
  for (const entry of entries) if (!map.has(refKey(entry))) map.set(refKey(entry), entry);
  return [...map.values()];
}

function conversationRef(entry: CatalogEntry, sourceKind: ConversationReference["source"], messageId?: string, sequence?: number): ConversationReference {
  return {
    entityType: entry.entityType,
    entityId: entry.entityId,
    label: entry.label,
    source: sourceKind,
    ...(messageId ? { sourceMessageId: messageId } : {}),
    ...(sequence ? { mentionedAtSequence: sequence } : {}),
    currentTruthAsOf: new Date().toISOString(),
  };
}

function referencesFromMessage(message: EmployeeConversationMessage, catalog: Map<string, CatalogEntry>): ConversationReference[] {
  const snapshot = object(message.resolutionSnapshot);
  const rows = Array.isArray(snapshot.resolvedReferences) ? snapshot.resolvedReferences : [];
  return rows.flatMap((candidate) => {
    const value = object(candidate);
    const key = `${String(value.entityType)}:${String(value.entityId)}`;
    const current = catalog.get(key);
    return current ? [conversationRef(current, "history_search", message.id, message.sequence)] : [];
  });
}

function extractExplicitPreference(instruction: string): { subjectKey: string; proposition: string; structuredValue: Record<string, unknown> } | null {
  const directEmail = instruction.match(/\buse\s+([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\s+(?:from\s+now\s+on|going\s+forward)\b/i);
  if (directEmail?.[1]) return {
    subjectKey: "communication.sender.email:outbound_sales",
    proposition: instruction.trim(),
    structuredValue: { channel: "email", purpose: "sales", selector: directEmail[1].toLowerCase(), explicit: true },
  };
  const namedEmail = instruction.match(/\buse\s+my\s+([\w.-]+)\s+email\s+(?:when|for)\s+([^.!?]+)/i);
  if (namedEmail?.[1] && namedEmail[2]) return {
    subjectKey: "communication.sender.email:outbound_sales",
    proposition: instruction.trim(),
    structuredValue: { channel: "email", purpose: "sales", selector: namedEmail[1].toLowerCase(), condition: namedEmail[2].trim(), explicit: true },
  };
  const remember = instruction.match(/\b(?:remember\s+that\s+)?i\s+(?:prefer|want)\s+([^.!?]+)/i);
  if (remember?.[1]) return {
    subjectKey: `preference:${normalized(remember[1]).slice(0, 120)}`,
    proposition: instruction.trim(),
    structuredValue: { preference: remember[1].trim(), explicit: true },
  };
  return null;
}

async function resolveSenderPreference(params: {
  tenantId: string;
  employeeId: string;
  instruction: string;
  personalMemories: EmployeePersonalMemory[];
  provenance: ConversationResolutionProvenance[];
}): Promise<{ communicationIdentityId: string; channel: "email"; purpose: string } | null | "ambiguous" | "unavailable"> {
  if (!CONSEQUENTIAL.test(params.instruction) || !/\bemail\b/i.test(params.instruction)) return null;
  const preference = params.personalMemories.find((memory) => memory.subjectKey === "communication.sender.email:outbound_sales" && !memory.supersededAt);
  if (!preference) return null;
  const selector = typeof preference.structuredValue.selector === "string" ? normalized(preference.structuredValue.selector) : "";
  const purpose = typeof preference.structuredValue.purpose === "string" ? preference.structuredValue.purpose : "sales";
  const access = await listAvailableIdentityAccess(params.tenantId, params.employeeId);
  const matches = access.communicationIdentities.filter((identity) => {
    if (identity.channel !== "email" || identity.status !== "active") return false;
    const haystack = normalized([identity.key, identity.address ?? "", identity.purpose].join(" "));
    return selector ? haystack.includes(selector) : identity.purpose === purpose;
  });
  if (matches.length === 1) {
    params.provenance.push(source("sender_identity", "current_identity_access", "selected", matches[0]!.id, "remembered selector revalidated against current access"));
    return { communicationIdentityId: matches[0]!.id, channel: "email", purpose };
  }
  params.provenance.push(source("sender_identity", "current_identity_access", matches.length ? "rejected" : "unavailable", undefined, matches.length ? "multiple current identities match remembered selector" : "remembered identity is no longer currently available"));
  return matches.length ? "ambiguous" : "unavailable";
}

function clarification(kind: string, candidates: ConversationReference[]): string {
  if (candidates.length === 0) return `Which ${kind} do you mean? I could not verify a current target.`;
  const labels = [...new Set(candidates.map((candidate) => candidate.label))].slice(0, 5);
  return `Which ${kind} do you mean: ${labels.join(", ")}?`;
}

export interface PreparedEmployeeConversationTurn {
  threadId: string;
  employeeId: string;
  userMessage: EmployeeConversationMessage;
  duplicate: boolean;
  context: EmployeeConversationContext;
}

export async function prepareEmployeeConversationTurn(params: {
  ctx: TenantContext;
  threadId?: string;
  instruction: string;
  instructionId: string;
  idempotencyKey?: string;
  channel: EmployeeConversationChannel;
  transportSessionId?: string;
  originTransportKey?: string;
  activeContext?: { selectedEntities?: Array<{ entityType: CanonicalEntityType; entityId: string }>; focusedEntity?: { entityType: CanonicalEntityType; entityId: string } } | Record<string, unknown>;
}): Promise<PreparedEmployeeConversationTurn> {
  const employeeId = await resolveCanonicalHumanPrincipal(params.ctx);
  const threadSummary = params.threadId
    ? (await loadEmployeeConversationThread({ tenantId: params.ctx.tenantId, ownerEmployeeId: employeeId, threadId: params.threadId, messageLimit: 1 }))?.thread
    : await createEmployeeConversationThread({ tenantId: params.ctx.tenantId, ownerEmployeeId: employeeId, originTransportKey: params.originTransportKey });
  if (!threadSummary) throw new Error("conversation_thread_not_found");
  const appended = await appendEmployeeConversationMessage({
    tenantId: params.ctx.tenantId,
    ownerEmployeeId: employeeId,
    threadId: threadSummary.id,
    role: "user",
    channel: params.channel,
    originalText: params.instruction,
    instructionId: params.instructionId,
    idempotencyKey: `user:${params.idempotencyKey ?? params.instructionId}`,
    transportSessionId: params.transportSessionId,
    transportProvenance: { kind: params.channel === "voice" ? "voice_transport" : "browser_transport", canonical: false },
  });
  await mirrorConversationMessageToZep({
    tenantId: params.ctx.tenantId,
    employeeId,
    threadId: threadSummary.id,
    messageId: appended.message.id,
    role: "user",
    content: params.instruction,
    createdAt: appended.message.createdAt,
  });

  const explicitPreference = extractExplicitPreference(params.instruction);
  if (explicitPreference) {
    await rememberExplicitEmployeeMemory({
      tenantId: params.ctx.tenantId,
      ownerEmployeeId: employeeId,
      sourceThreadId: threadSummary.id,
      sourceMessageId: appended.message.id,
      role: "user",
      memoryType: "preference",
      ...explicitPreference,
      provenance: { extractor: "phase6_explicit_human_rule", originalMessageId: appended.message.id },
    });
  }

  // Resolve these in order. Local/CI pools can be restarted between requests and
  // production intentionally uses a single short-lived session per function.
  const loaded = await loadEmployeeConversationThread({ tenantId: params.ctx.tenantId, ownerEmployeeId: employeeId, threadId: threadSummary.id, messageLimit: 40 });
  const personalMemories = await listEmployeePersonalMemories({ tenantId: params.ctx.tenantId, ownerEmployeeId: employeeId, limit: 50 });
  const catalog = await loadCanonicalCatalog(params.ctx.tenantId, employeeId);
  if (!loaded) throw new Error("conversation_thread_not_found");
  const catalogMap = new Map(dedupeCatalog(catalog).map((entry) => [refKey(entry), entry]));
  const provenance: ConversationResolutionProvenance[] = [];
  const named = extractNamedExpressions(params.instruction);
  const exactContext = object(params.activeContext);
  const explicitRefs = [
    ...(Array.isArray(exactContext.selectedEntities) ? exactContext.selectedEntities : []),
    ...(exactContext.focusedEntity ? [exactContext.focusedEntity] : []),
  ].flatMap((candidate) => {
    const value = object(candidate);
    const current = catalogMap.get(`${String(value.entityType)}:${String(value.entityId)}`);
    if (!current) return [];
    provenance.push(source("explicit", "operating_interaction_context", "selected", refKey(current)));
    return [conversationRef(current, "explicit_context")];
  });
  const activeRefs = loaded.thread.activeReferences.flatMap((candidate) => {
    const value = object(candidate);
    const current = catalogMap.get(`${String(value.entityType)}:${String(value.entityId)}`);
    if (!current) {
      provenance.push(source("company_twin", "active_thread_reference", "rejected", `${String(value.entityType)}:${String(value.entityId)}`, "no longer current"));
      return [];
    }
    return [conversationRef(current, "thread", typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined, typeof value.mentionedAtSequence === "number" ? value.mentionedAtSequence : undefined)];
  });
  let olderRelevantMessages: EmployeeConversationMessage[] = [];
  if (named.length > 0 && /\b(?:discussed|earlier|before|talked about)\b/i.test(params.instruction)) {
    const seen = new Set<string>();
    for (const expression of named) {
      const matches = await searchEmployeeConversationMessages({ tenantId: params.ctx.tenantId, ownerEmployeeId: employeeId, query: expression.name, limit: 20 });
      for (const message of matches) if (!seen.has(message.id)) {
        seen.add(message.id);
        olderRelevantMessages.push(message);
      }
    }
  }
  const historyRefs = dedupeCatalog(olderRelevantMessages.flatMap((message) => referencesFromMessage(message, catalogMap)).map((ref) => ({ ...ref, aliases: [] } as CatalogEntry))).map((entry) => conversationRef(entry, "history_search"));

  const groups: ReferenceGroup[] = [];
  const addGroup = (expression: string, kind: string, refs: ConversationReference[]) => {
    const candidates = [...new Map(refs.map((candidate) => [refKey(candidate), candidate])).values()];
    groups.push({ expression, kind, candidates });
    for (const candidate of candidates) {
      const stage = candidate.source === "thread" ? "thread" : candidate.source === "history_search" ? "history" : candidate.source === "work" ? "work" : candidate.source === "explicit_context" ? "explicit" : "company_twin";
      provenance.push(source(stage, candidate.source, "candidate", refKey(candidate)));
    }
  };
  const partyMatchesFor = (expression: NamedExpression): ConversationReference[] => {
    const historyMatches = (expression.cue === "history" || /\b(?:discussed|earlier|before|talked about)\b/i.test(params.instruction))
      ? historyRefs.filter((ref) => {
        const entry = catalogMap.get(refKey(ref));
        return entry ? PARTY_TYPES.has(entry.entityType) && labelMatches(entry, expression) : false;
      })
      : [];
    if (historyMatches.length > 0) return historyMatches;
    return dedupeCatalog(catalog.filter((entry) => PARTY_TYPES.has(entry.entityType) && labelMatches(entry, expression))).map((entry) => conversationRef(entry, "company_twin"));
  };
  const householdIdsFor = (refs: ConversationReference[]): Set<string> => new Set(refs.flatMap((ref) => {
    const entry = catalogMap.get(refKey(ref));
    return entry?.entityType === "household" ? [entry.entityId] : entry?.householdId ? [entry.householdId] : [];
  }));
  const entityMatchesFor = (type: CanonicalEntityType, parties: ConversationReference[]): ConversationReference[] => {
    const householdIds = householdIdsFor(parties);
    const leadIds = new Set(parties.filter((party) => party.entityType === "lead").map((party) => party.entityId));
    return catalog.filter((entry) => entry.entityType === type && (
      (entry.householdId ? householdIds.has(entry.householdId) : false)
      || (entry.leadId ? leadIds.has(entry.leadId) : false)
    ) && (type !== "invoice" || entry.status !== "void")).map((entry) => conversationRef(entry, "company_twin"));
  };

  let targetKind = "target";
  if (explicitRefs.length > 0) {
    targetKind = "explicit target";
    addGroup("operating interaction context", targetKind, explicitRefs);
  } else {
    if (CONTINUATION.test(params.instruction)) {
      targetKind = "work item";
      const workIds = new Set(loaded.messages.flatMap((message) => message.workId ? [message.workId] : []));
      if (loaded.thread.activeWorkId) workIds.add(loaded.thread.activeWorkId);
      const workRows = workIds.size > 0 ? await withTenant(params.ctx.tenantId, async (db) => db
        .select({ id: works.id, instruction: works.initialInstruction, status: works.status })
        .from(works)
        .where(and(
          eq(works.tenantId, params.ctx.tenantId),
          inArray(works.id, [...workIds]),
          or(eq(works.createdBy, employeeId), eq(works.currentOwnerId, employeeId), eq(works.assignedTo, employeeId)),
        )), employeeId) : [];
      addGroup("continuation", targetKind, workRows.map((work) => ({ entityType: "work", entityId: work.id, label: work.instruction.slice(0, 120), source: "work", currentTruthAsOf: new Date().toISOString() })));
    }

    const namedPartyMatches = new Map<string, ConversationReference[]>();
    for (const expression of named) {
      const parties = partyMatchesFor(expression);
      if (expression.cue === "party" || expression.cue === "history") namedPartyMatches.set(normalized(expression.name), parties);
      const type = expression.cue === "appointment" || expression.cue === "invoice" || expression.cue === "quote" || expression.cue === "proposal" ? expression.cue : null;
      targetKind = type ?? expression.name;
      addGroup(expression.name, type ?? "person", type ? entityMatchesFor(type, parties) : parties);
    }

    const nounType = REFERENCE_NOUNS.find(([pattern]) => pattern.test(params.instruction))?.[1];
    if (PERSON_PRONOUN.test(params.instruction)) {
      targetKind = "person";
      const sameTurnParties = [...namedPartyMatches.values()].flat();
      const partyRefs = sameTurnParties.length > 0
        ? sameTurnParties
        : (() => {
          const partyActive = activeRefs.filter((ref) => PARTY_TYPES.has(ref.entityType));
          const maxSequence = Math.max(0, ...partyActive.map((ref) => ref.mentionedAtSequence ?? 0));
          return partyActive.filter((ref) => (ref.mentionedAtSequence ?? 0) === maxSequence);
        })();
      addGroup("person pronoun", targetKind, partyRefs);
    }
    if (OBJECT_PRONOUN.test(params.instruction)) {
      targetKind = nounType?.replace("_", " ") ?? "object";
      const objectRefs = activeRefs.filter((ref) => !PARTY_TYPES.has(ref.entityType) && (!nounType || ref.entityType === nounType));
      const maxSequence = Math.max(0, ...objectRefs.map((ref) => ref.mentionedAtSequence ?? 0));
      addGroup("object pronoun", targetKind, objectRefs.filter((ref) => (ref.mentionedAtSequence ?? 0) === maxSequence));
    }
    if (nounType && named.length === 0 && !OBJECT_PRONOUN.test(params.instruction)) {
      targetKind = nounType.replace("_", " ");
      addGroup(`active ${targetKind}`, targetKind, activeRefs.filter((ref) => ref.entityType === nounType));
    }
  }

  const candidates = [...new Map(groups.flatMap((group) => group.candidates).map((candidate) => [refKey(candidate), candidate])).values()];
  const referenceRequired = groups.length > 0;
  const consequential = CONSEQUENTIAL.test(params.instruction);
  const selected = [...new Map(groups.filter((group) => group.candidates.length === 1).flatMap((group) => group.candidates).map((candidate) => [refKey(candidate), candidate])).values()];
  const sender = await resolveSenderPreference({ tenantId: params.ctx.tenantId, employeeId, instruction: params.instruction, personalMemories, provenance });
  const senderProblem = sender === "ambiguous" || sender === "unavailable";
  const unresolvedGroups = groups.filter((group) => group.candidates.length !== 1);
  const ambiguous = consequential && ((referenceRequired && unresolvedGroups.length > 0) || senderProblem);
  const unresolvedExpressions = ambiguous
    ? [...unresolvedGroups.map((group) => group.expression), ...(senderProblem ? ["remembered sender identity"] : [])]
    : [];
  const resolution: ConversationReferenceResolution = {
    status: ambiguous ? "clarification_required" : selected.length ? "resolved" : "none",
    originalInstruction: params.instruction,
    resolvedReferences: selected,
    candidates,
    unresolvedExpressions,
    clarificationQuestion: ambiguous
      ? senderProblem
        ? sender === "unavailable"
          ? "Your remembered email sender is no longer available. Which currently connected sender should I use?"
          : "More than one current email sender matches your preference. Which sender should I use?"
        : clarification(unresolvedGroups.flatMap((group) => group.candidates).length > 0 ? unresolvedGroups[0]!.kind : targetKind, unresolvedGroups.flatMap((group) => group.candidates))
      : null,
    consequential,
    senderIdentityRef: sender && sender !== "ambiguous" && sender !== "unavailable" ? sender : null,
    provenance,
  };
  const truthSnapshot = {
    asOf: new Date().toISOString(),
    source: "current_company_twin",
    references: [...candidates, ...selected].map((ref) => {
      const entry = catalogMap.get(refKey(ref));
      return { entityType: ref.entityType, entityId: ref.entityId, label: ref.label, status: entry?.status ?? null };
    }),
  };
  await updateEmployeeConversationMessageContext({
    tenantId: params.ctx.tenantId,
    ownerEmployeeId: employeeId,
    threadId: threadSummary.id,
    messageId: appended.message.id,
    resolutionSnapshot: resolution as unknown as Record<string, unknown>,
    resolutionProvenance: provenance as unknown as Array<Record<string, unknown>>,
    companyTruthSnapshot: truthSnapshot,
  });
  const existing = activeRefs.map((ref) => ({ ...ref }));
  const mergedRefs = [...selected.map((ref) => ({ ...ref, sourceMessageId: appended.message.id, mentionedAtSequence: appended.message.sequence })), ...existing]
    .filter((ref, index, all) => all.findIndex((other) => refKey(other) === refKey(ref)) === index)
    .slice(0, 100);
  const summaryCandidates = loaded.messages.filter((message) => message.sequence <= appended.message.sequence - 20).slice(-20);
  const shouldRollSummary = summaryCandidates.length > 0 && appended.message.sequence - loaded.thread.summaryThroughSequence >= 20;
  await updateEmployeeConversationThreadContext({
    tenantId: params.ctx.tenantId,
    ownerEmployeeId: employeeId,
    threadId: threadSummary.id,
    activeReferences: mergedRefs as unknown as Array<Record<string, unknown>>,
    unresolvedReferences: unresolvedExpressions.map((expression) => ({ expression, messageId: appended.message.id, sequence: appended.message.sequence })),
    ...(shouldRollSummary ? {
      summary: summaryCandidates.map((message) => `[${message.sequence} ${message.role}] ${message.originalText.slice(0, 500)}`).join("\n").slice(0, 65_536),
      summaryThroughSequence: summaryCandidates.at(-1)!.sequence,
    } : {}),
  });
  const zepHits = await queryConsolidatedFacts(params.ctx.tenantId, employeeId, params.instruction, 5);
  const refreshed = await loadEmployeeConversationThread({ tenantId: params.ctx.tenantId, ownerEmployeeId: employeeId, threadId: threadSummary.id, messageLimit: 30 });
  if (!refreshed) throw new Error("conversation_thread_not_found");
  return {
    threadId: threadSummary.id,
    employeeId,
    userMessage: { ...appended.message, resolutionSnapshot: resolution as unknown as Record<string, unknown>, resolutionProvenance: provenance as unknown as Array<Record<string, unknown>>, companyTruthSnapshot: truthSnapshot },
    duplicate: appended.duplicate,
    context: {
      version: 1,
      ownerEmployeeId: employeeId,
      thread: refreshed.thread,
      exactRecentMessages: refreshed.messages,
      summary: refreshed.thread.summary ? { text: refreshed.thread.summary, throughSequence: refreshed.thread.summaryThroughSequence } : null,
      olderRelevantMessages,
      personalMemories,
      zepFacts: zepHits.map((hit) => ({ fact: hit.chunk, source: "zep_employee_graph", ...(hit.occurredAt ? { createdAt: hit.occurredAt } : {}) })),
      resolution,
    },
  };
}

export async function linkEmployeeConversationTurnToWork(params: {
  tenantId: string;
  employeeId: string;
  threadId: string;
  userMessageId: string;
  workId: string;
  workInputId?: string;
  objectiveLoopId?: string;
}): Promise<void> {
  await updateEmployeeConversationMessageContext({ tenantId: params.tenantId, ownerEmployeeId: params.employeeId, threadId: params.threadId, messageId: params.userMessageId, workId: params.workId, ...(params.workInputId ? { workInputId: params.workInputId } : {}) });
  await updateEmployeeConversationThreadContext({ tenantId: params.tenantId, ownerEmployeeId: params.employeeId, threadId: params.threadId, activeWorkId: params.workId, ...(params.objectiveLoopId ? { activeObjectiveLoopId: params.objectiveLoopId } : {}) });
}

export async function persistEmployeeAssistantTurn(params: {
  tenantId: string;
  employeeId: string;
  threadId: string;
  instructionId: string;
  channel: EmployeeConversationChannel;
  text: string;
  workId?: string;
  workInputId?: string;
  outcomeRefs: Array<Record<string, unknown>>;
}): Promise<EmployeeConversationMessage> {
  const appended = await appendEmployeeConversationMessage({
    tenantId: params.tenantId,
    ownerEmployeeId: params.employeeId,
    threadId: params.threadId,
    role: "assistant",
    channel: params.channel,
    originalText: params.text,
    instructionId: params.instructionId,
    workId: params.workId,
    workInputId: params.workInputId,
    idempotencyKey: `assistant:${params.instructionId}`,
    outcomeRefs: params.outcomeRefs,
    transportProvenance: { kind: "assistant_response", canonical: true },
  });
  await updateEmployeeConversationThreadContext({ tenantId: params.tenantId, ownerEmployeeId: params.employeeId, threadId: params.threadId, ...(params.workId ? { activeWorkId: params.workId } : {}), outcomeRefs: params.outcomeRefs });
  await mirrorConversationMessageToZep({ tenantId: params.tenantId, employeeId: params.employeeId, threadId: params.threadId, messageId: appended.message.id, role: "assistant", content: params.text, createdAt: appended.message.createdAt });
  return appended.message;
}
