// Planner (§9): instruction + tenant policy context (RAG) + memory → DomainAction[].
// Only registered action_types are ever planned; unknown intents surface as such.

import type { TenantContext, MemorySnapshot, DomainAction } from "@finnor/shared-types";
import { withTenant, domainActions, domainPolicies } from "@finnor/db";
import { inArray } from "drizzle-orm";
import type { LLMProvider } from "./llm";
import { resolveProvider } from "./llm";
import type { PluginRegistry } from "./plugin-registry";
import { z } from "zod";

const PlanSchema = z.object({
  actions: z.array(
    z.object({
      action_type: z.string(),
      payload: z.record(z.unknown()),
      reasoning: z.string().optional(),
    }),
  ),
});

export interface Planner {
  plan(instruction: string, tenantContext: TenantContext, memory: MemorySnapshot): Promise<DomainAction[]>;
}

export class LLMPlanner implements Planner {
  // Provider resolves lazily on first plan() so constructing an orchestrator never
  // requires LLM credentials (executor-only paths, tests, workers that never plan).
  private provider: LLMProvider | undefined;

  constructor(
    private plugins: PluginRegistry,
    provider?: LLMProvider,
  ) {
    this.provider = provider;
  }

  private systemPromptCache: { day: string; prompt: string } | null = null;

  private systemPrompt(): string {
    const day = new Date().toISOString().slice(0, 10);
    if (this.systemPromptCache?.day === day) return this.systemPromptCache.prompt;
    const actionTypes = this.plugins.actionTypes();
    const prompt = [
      "You are the planning core of Finnor, an AI operating system for water treatment dealers.",
      "Translate the dealer instruction into zero or more domain actions.",
      `The ONLY valid action_type values are: ${actionTypes.join(", ")}.`,
      "Each action_type has a REQUIRED payload JSON schema. Follow it exactly — field names matter:",
      this.plugins.payloadSpecJson(),
      `Today is ${day}. Resolve relative dates to ISO 8601 datetimes.`,
      "memory.shortTerm.turns (if present) is this same call's own recent history — each turn has the instruction that was said and which action_type/payload it resolved to. USE IT to resolve references the current instruction doesn't spell out: \"call them\" / \"that one\" / \"the second one\" / \"do the same for the Petersons\" mean whatever household, invoice, or action the most recent relevant turn was about — carry its identifying fields (householdId, phone, address — fields that identify a REAL EXISTING row) into the new payload rather than leaving them blank.",
      "CRITICAL: a prior turn with awaitingApproval:true has NOT actually happened yet — it is a draft sitting in the confirmation queue, nothing was created, and it has no real id of its own kind (e.g. a pending create_invoice has no real invoice id — only a domain_action id, which is a different thing and must never be used as an invoiceId/visitId/etc.). If the current instruction depends on something from a turn that was awaitingApproval:true (e.g. \"remind him about that invoice\" when the invoice draft is still pending), do NOT invent or reuse an id — instead route to answer_business_question explaining that the prior action needs approval first, or ask for the missing identifier some other real way (phone/name lookup).",
      "If the instruction is a QUESTION about the business (revenue, financial totals, a specific customer's history, trends, anything informational) and no narrower action_type fits exactly, route it to answer_business_question with the verbatim question as payload — that action queries real data across every domain (invoices, leads, inventory, visits, communications history) and answers honestly from whatever is actually there, including saying so when a specific figure isn't tracked. Prefer it over returning empty for any business QUESTION.",
      "Only return an empty actions array when the instruction is not a business question or action at all (chit-chat, out of scope, or something no plugin could ever plausibly do) — never because the exact phrasing didn't match a narrower action_type.",
      'Respond with JSON: {"actions":[{"action_type":"...","payload":{...},"reasoning":"..."}]}',
      "Payloads must contain only facts from the instruction or the provided memory — never invent phone numbers, addresses, or prices.",
    ].join("\n");
    this.systemPromptCache = { day, prompt };
    return prompt;
  }

  async plan(
    instruction: string,
    tenantContext: TenantContext,
    memory: MemorySnapshot,
  ): Promise<DomainAction[]> {
    const actionTypes = this.plugins.actionTypes();
    const system = this.systemPrompt();
    const user = JSON.stringify({
      instruction,
      memory: {
        shortTerm: memory.shortTerm,
        semantic: memory.semantic.map((s) => s.chunk).slice(0, 5),
        recentEpisodes: memory.episodic.slice(0, 5),
      },
    });

    let raw: string;
    try {
      this.provider ??= resolveProvider();
      raw = await this.provider.complete({ system, user, json: true });
    } catch (err) {
      throw new Error(`Planner LLM call failed: ${(err as Error).message}`);
    }

    let parsed: z.infer<typeof PlanSchema>;
    try {
      parsed = PlanSchema.parse(JSON.parse(raw));
    } catch {
      // Model returned malformed JSON — treat as "no plan", never guess.
      parsed = { actions: [] };
    }

    const valid = parsed.actions.filter((a) => actionTypes.includes(a.action_type));

    if (valid.length === 0) return [];

    // One transaction, one policy lookup, one batch insert — not 2N round trips.
    return withTenant(tenantContext.tenantId, async (db) => {
      const policies = await db
        .select({ id: domainPolicies.id, actionType: domainPolicies.actionType })
        .from(domainPolicies)
        .where(inArray(domainPolicies.actionType, [...new Set(valid.map((a) => a.action_type))]));
      const policyByType = new Map(policies.map((p) => [p.actionType, p.id]));
      const rows = await db
        .insert(domainActions)
        .values(
          valid.map((a) => ({
            tenantId: tenantContext.tenantId,
            actionType: a.action_type,
            payload: a.payload,
            policyId: policyByType.get(a.action_type) ?? null,
            status: "draft" as const,
          })),
        )
        .returning();
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        actionType: row.actionType,
        payload: row.payload as Record<string, unknown>,
        policyId: row.policyId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }
}
