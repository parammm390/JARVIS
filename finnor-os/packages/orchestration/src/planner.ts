// Planner (§9): instruction + tenant policy context (RAG) + memory → DomainAction[].
// Only registered action_types are ever planned; unknown intents surface as such.

import type { TenantContext, MemorySnapshot, DomainAction, DomainPolicy } from "@finnor/shared-types";
import { withTenant, domainActions, domainPolicies } from "@finnor/db";
import { and, eq, inArray } from "drizzle-orm";
import type { LLMProvider } from "./llm";
import { resolveProvider } from "./llm";
import type { PluginRegistry } from "./plugin-registry";
import { z } from "zod";
import { redactStructured, redactText, restoreTokens } from "@finnor/security";
import { groundEntitiesWithDb, buildCommandGraph } from "./compiler";
import { appendEpisode } from "@finnor/memory";
import { repairAction } from "./repair";
import type { RepairVerdict } from "./repair";
import { classifyReasoningTier, scoreCandidate } from "./tiering";
import type { ReasoningTier } from "@finnor/shared-types";

const PlanSchema = z.object({
  actions: z.array(
    z.object({
      action_type: z.string(),
      payload: z.record(z.unknown()),
      reasoning: z.string().optional(),
    }),
  ),
});

const SecondCandidateSchema = z.object({
  action_type: z.string(),
  payload: z.record(z.unknown()),
});

export interface Planner {
  plan(instruction: string, tenantContext: TenantContext, memory: MemorySnapshot): Promise<DomainAction[]>;
}

export class LLMPlanner implements Planner {
  // Providers resolve lazily on first use so constructing an orchestrator never
  // requires LLM credentials (executor-only paths, tests, workers that never plan).
  private provider: LLMProvider | undefined;
  // Phase 8's high-tier second-candidate call — a distinct, separately injectable
  // provider so tests can stub it independently of the first-pass planner call
  // (both default to real Groq in production, but a test may want candidate A from
  // one stub and candidate B from another).
  private secondCandidateProvider: LLMProvider | undefined;

  constructor(
    private plugins: PluginRegistry,
    provider?: LLMProvider,
    secondCandidateProvider?: LLMProvider,
  ) {
    this.provider = provider;
    this.secondCandidateProvider = secondCandidateProvider;
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
      "Direct identifiers are replaced with bracketed tokens such as [PHONE_1] before you see them. Preserve those tokens exactly in payload values whenever the underlying field is needed; never invent a different identifier.",
      "memory.patterns.householdProposals (if present) summarizes this household's own past proposal/quote outcomes — use it only as soft context, never as a source of new facts to invent into a payload.",
      "memory.patterns.technicianReliability lists each technician's appointment no-show rate tenant-wide — if the instruction doesn't name a technician for an assignment action, this may inform picking one; if it does name one, respect the instruction and don't override it.",
      "memory.patterns.scanSignals lists open operational findings from automatic scans (low stock, overdue service, cold leads). Treat them as context — e.g. don't draft actions that consume stock a signal says is already below threshold without noting it — never as instructions to act on by themselves.",
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
    const redactedInstruction = redactText(instruction);
    const user = JSON.stringify({
      instruction: redactedInstruction.value,
      memory: {
        shortTerm: redactStructured(memory.shortTerm),
        semantic: memory.semantic.map((s) => redactText(s.chunk).value).slice(0, 5),
        recentEpisodes: redactStructured(memory.episodic.slice(0, 5)),
        // Phase 9 — ids/counts/rates only, no free text, safe to skip redaction.
        patterns: memory.patterns,
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

    // Hoisted out of the transaction — restoreTokens has no DB dependency, this is a
    // trivial hoist, not a logic change (Phase 7).
    const restoredPayloads = valid.map((a) => restoreTokens(a.payload, redactedInstruction.tokens));

    // A short, LLM-free pre-lookup: fetches the FULL policy row (not just
    // id/actionType/requiresConfirmation) because repairAction()'s payload
    // validation step below may call a plugin's validate(), and a few plugins
    // (water-test, maintenance-agreement, compliance-documentation) genuinely read
    // policy.policy inside validate(). Doing this now, before any LLM call, means
    // the real insert transaction below can reuse this same map instead of
    // re-querying — no duplicated round trip.
    const policyByType = await withTenant(tenantContext.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(domainPolicies)
        .where(
          and(
            eq(domainPolicies.tenantId, tenantContext.tenantId),
            inArray(domainPolicies.actionType, [...new Set(valid.map((a) => a.action_type))]),
          ),
        );
      return new Map(rows.map((p) => [p.actionType, p as DomainPolicy]));
    });

    // Reasoning tier (Phase 8): pure classification, no DB/LLM — decides how much
    // extra reasoning depth each action gets below. requiresConfirmation and
    // compiledGraph are computed once here against the ORIGINAL action_type; the
    // insert transaction below recomputes compiledGraph against the FINAL (possibly
    // repaired) action_type, since a correction can change which command graph kind
    // applies.
    const tierInfo = valid.map((a, i) => {
      const policy = policyByType.get(a.action_type);
      const requiresConfirmation = policy?.requiresConfirmation ?? true;
      const compiledGraph = buildCommandGraph(a.action_type, requiresConfirmation);
      const amountThresholdUsd = (policy?.policy as { riskThresholds?: { amountUsd?: number } } | undefined)?.riskThresholds?.amountUsd;
      const tier: ReasoningTier = classifyReasoningTier({
        requiresConfirmation,
        compiledGraph,
        payload: restoredPayloads[i]!,
        amountThresholdUsd,
        actionType: a.action_type,
        openScanSignals: memory.patterns?.scanSignals ?? [],
      });
      return { tier, requiresConfirmation };
    });

    // High tier only: generate a second candidate per high-tier action, entirely
    // BEFORE any transaction opens (finding #2 — no LLM call may share a transaction).
    // Uses the real planner-quality provider (Groq), deliberately NOT the cheap
    // repair model — this tier exists specifically to spend more reasoning where
    // stakes justify it.
    const highIndices = valid.map((_, i) => i).filter((i) => tierInfo[i]!.tier === "high");
    const secondCandidatePairs = await Promise.all(
      highIndices.map(async (i) => {
        const candidateB = await this.generateSecondCandidate(
          redactedInstruction.value,
          valid[i]!.action_type,
          restoredPayloads[i]!,
          actionTypes,
        );
        return [i, candidateB] as const;
      }),
    );
    const secondCandidates = new Map(secondCandidatePairs);

    // Scoring requires grounding both candidates — a short, dedicated, non-final
    // withTenant call (no LLM in flight), separate from the real insert transaction
    // below. Deliberate, acceptable duplication: high-tier actions are rare by
    // design, and threading cached grounding across repair's potential payload
    // mutation would add real complexity for a case that almost never fires.
    // Phase 9 follow-up to Phase 8's scoreCandidate() extension point: when scoring a
    // high-tier assign_technician_to_visit candidate with a resolved technicianId,
    // look it up in the pattern context's tenant-wide no-show rates and pass a small
    // penalty proportional to unreliability — absent a match, patternScore stays
    // undefined (scoreCandidate's own default of 0). This is what makes Phase 9's
    // data actually feed back into a real decision instead of sitting inert.
    const patternScoreFor = (actionType: string, payload: Record<string, unknown>): number | undefined => {
      if (actionType !== "assign_technician_to_visit") return undefined;
      const technicianId = typeof payload.technicianId === "string" ? payload.technicianId : null;
      if (!technicianId || !memory.patterns) return undefined;
      const match = memory.patterns.technicianReliability.find((t) => t.technicianId === technicianId);
      return match ? -match.noShowRate * 2 : undefined;
    };

    const winnerByIndex = new Map<number, { actionType: string; payload: Record<string, unknown> }>();
    const scoreByIndex = new Map<number, { scoreA: number; scoreB: number | null; winner: "A" | "B" }>();
    if (highIndices.length > 0) {
      await withTenant(tenantContext.tenantId, async (db) => {
        for (const i of highIndices) {
          const candidateA = { actionType: valid[i]!.action_type, payload: restoredPayloads[i]! };
          const candidateB = secondCandidates.get(i) ?? null;
          const groundedA = await groundEntitiesWithDb(db, candidateA.payload);
          const scoreA = scoreCandidate({
            actionType: candidateA.actionType,
            groundedPayload: groundedA,
            patternScore: patternScoreFor(candidateA.actionType, candidateA.payload),
          });
          let scoreB: number | null = null;
          let winner: "A" | "B" = "A";
          if (candidateB) {
            const groundedB = await groundEntitiesWithDb(db, candidateB.payload);
            scoreB = scoreCandidate({
              actionType: candidateB.actionType,
              groundedPayload: groundedB,
              patternScore: patternScoreFor(candidateB.actionType, candidateB.payload),
            });
            if (scoreB > scoreA) winner = "B";
          }
          winnerByIndex.set(i, winner === "B" ? candidateB! : candidateA);
          scoreByIndex.set(i, { scoreA, scoreB, winner });
        }
      });
    }

    // Per-action base candidate going into repair: low tier skips repair entirely
    // (restoring the original zero-overhead path for anything that doesn't require
    // confirmation at all — the one path Phase 7 alone would have made slightly
    // slower for every action). Medium tier is Phase 7's repair, unmodified. High
    // tier repair-passes the SCORING WINNER, never candidate A unconditionally —
    // two different failure modes (wrong pick vs. right pick, wrong payload detail).
    const baseCandidates = valid.map((a, i) => {
      const tier = tierInfo[i]!.tier;
      if (tier === "high") return winnerByIndex.get(i)!;
      return { actionType: a.action_type, payload: restoredPayloads[i]! };
    });

    const repairVerdicts: Array<RepairVerdict | null> = await Promise.all(
      valid.map((a, i) => {
        if (tierInfo[i]!.tier === "low") return Promise.resolve(null);
        return repairAction({
          instruction: redactedInstruction.value,
          candidate: baseCandidates[i]!,
          reasoning: a.reasoning,
          allowedActionTypes: actionTypes,
          payloadSpec: this.plugins.payloadSpecJson(),
        });
      }),
    );

    // A repaired candidate must still pass the TARGET plugin's own validate() before
    // it's accepted — repair.ts deliberately doesn't import PluginRegistry (avoid a
    // new coupling), so that check belongs here, one layer up.
    const finalCandidates = valid.map((a, i) => {
      const verdict = repairVerdicts[i]!;
      if (!verdict) {
        // low tier — repair never ran, base candidate is the original draft as-is.
        return { actionType: baseCandidates[i]!.actionType, payload: baseCandidates[i]!.payload, verdict: null as RepairVerdict | null };
      }
      if (!verdict.repaired) {
        return { actionType: baseCandidates[i]!.actionType, payload: baseCandidates[i]!.payload, verdict };
      }
      const targetPlugin = this.plugins.resolve(verdict.actionType);
      const fallbackPolicy: DomainPolicy = {
        id: "",
        tenantId: tenantContext.tenantId,
        actionType: verdict.actionType,
        policy: {},
        requiresConfirmation: true,
        confirmationTemplate: null,
        version: 0,
      };
      const policy = policyByType.get(verdict.actionType) ?? fallbackPolicy;
      const validation = targetPlugin?.validate(verdict.actionType, verdict.payload, policy);
      if (targetPlugin && validation?.valid) {
        return { actionType: verdict.actionType, payload: verdict.payload, verdict };
      }
      // Discard the correction, keep the base candidate — but record exactly why,
      // never silently keep a broken correction and never silently drop the attempt.
      const reason = !targetPlugin
        ? `repair proposed "${verdict.actionType}" but no plugin resolves it — discarded`
        : `repair proposed ${verdict.actionType} but payload failed validation: ${validation?.errors.join("; ")}`;
      return {
        actionType: baseCandidates[i]!.actionType,
        payload: baseCandidates[i]!.payload,
        verdict: { ...verdict, repaired: false, actionType: baseCandidates[i]!.actionType, payload: baseCandidates[i]!.payload, reason },
      };
    });

    // One transaction, one batch insert — not 2N round trips. The policy lookup
    // itself already happened above (LLM-free, pre-repair); this reuses that map.
    const rows = await withTenant(tenantContext.tenantId, async (db) => {
      // Typed plan compiler (Phase 6, §6): grounds every id-shaped payload field
      // against the real table for this tenant, and tags each action with whether it
      // will execute as a single call or drive the durable multi-step runtime — using
      // this same open transaction, not a second one (see compiler.ts's own note on
      // groundEntitiesWithDb vs. compileAction).
      const compiled = await Promise.all(
        finalCandidates.map(async (c) => {
          const policy = policyByType.get(c.actionType);
          const requiresConfirmation = policy?.requiresConfirmation ?? true;
          return {
            groundedPayload: await groundEntitiesWithDb(db, c.payload),
            compiledGraph: buildCommandGraph(c.actionType, requiresConfirmation),
          };
        }),
      );
      return db
        .insert(domainActions)
        .values(
          finalCandidates.map((c, i) => ({
            tenantId: tenantContext.tenantId,
            actionType: c.actionType,
            payload: c.payload,
            policyId: policyByType.get(c.actionType)?.id || null,
            status: "draft" as const,
            groundedPayload: compiled[i]!.groundedPayload,
            compiledGraph: compiled[i]!.compiledGraph,
          })),
        )
        .returning();
    });

    // appendEpisode does not require an open tenant transaction (critic-review.ts
    // calls it completely outside of any withTenant block). "repair" is logged only
    // when repair actually ran (medium/high tiers — low tier has no verdict to
    // report), unconditionally within those tiers whether or not anything changed,
    // mirroring critic-review.ts's own precedent. "reasoning_tier" is logged for
    // EVERY action, all tiers, always — the real, queryable "how often did repair
    // actually fire, and at what tier" signal later phases need.
    await Promise.all(
      rows.flatMap((row, i) => {
        const episodes: Array<Promise<void>> = [];
        const verdict = finalCandidates[i]!.verdict;
        if (verdict) {
          episodes.push(
            appendEpisode(
              tenantContext.tenantId,
              row.id,
              "repair",
              { originalActionType: valid[i]!.action_type, originalPayload: restoredPayloads[i] },
              {
                repaired: verdict.repaired,
                actionType: finalCandidates[i]!.actionType,
                payload: finalCandidates[i]!.payload,
                reason: verdict.reason,
                deterministicFlags: verdict.deterministicFlags,
              },
            ),
          );
        }
        const tier = tierInfo[i]!.tier;
        const score = scoreByIndex.get(i);
        episodes.push(
          appendEpisode(
            tenantContext.tenantId,
            row.id,
            "reasoning_tier",
            {},
            {
              tier,
              candidateBGenerated: tier === "high",
              scoreA: score?.scoreA ?? null,
              scoreB: score?.scoreB ?? null,
              winner: tier === "high" ? (score?.winner ?? "A") : "A",
            },
          ),
        );
        return episodes;
      }),
    );

    // Single multi-row INSERT ... RETURNING preserves the input order, so rows[i]
    // corresponds to valid[i]/finalCandidates[i] — safe to zip the LLM's reasoning
    // back in by index. `reasoning` stays the planner's own original narration —
    // never overwritten by the repair's reason, which lives only in the "repair"
    // episode above (draft narration vs. audit trail are different concerns).
    return rows.map((row, i) => ({
      id: row.id,
      tenantId: row.tenantId,
      actionType: row.actionType,
      payload: row.payload as Record<string, unknown>,
      policyId: row.policyId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reasoning: valid[i]?.reasoning,
      groundedPayload: row.groundedPayload as DomainAction["groundedPayload"],
      compiledGraph: row.compiledGraph as DomainAction["compiledGraph"],
    }));
  }

  /** High tier only (Phase 8): a second, independent candidate for a high-stakes
   *  action, using the real planner-quality provider (Groq) — deliberately NOT the
   *  cheap repair model, since this tier exists specifically to spend more
   *  reasoning where stakes justify it. Same defensive malformed-JSON-safe-fallback
   *  pattern plan()'s own first call already uses: on any failure (network or
   *  parse), candidate B simply does not exist and scoring trivially picks A. */
  private async generateSecondCandidate(
    instruction: string,
    candidateAActionType: string,
    candidateAPayload: Record<string, unknown>,
    allowedActionTypes: string[],
  ): Promise<{ actionType: string; payload: Record<string, unknown> } | null> {
    const system = [
      "This is a HIGH-STAKES action — a multi-step workflow or a large dollar amount — worth a second, independent look before a human reviews it.",
      "You are given the dealer instruction and a candidate action another pass already drafted.",
      `The ONLY valid action_type values are: ${allowedActionTypes.join(", ")}.`,
      `Required payload fields per action_type: ${this.plugins.payloadSpecJson()}`,
      "Either confirm the candidate exactly as-is, or propose a meaningfully different alternative if you believe it better matches the instruction.",
      'Respond with ONLY this JSON: {"action_type":"...","payload":{...}}. If confirming, action_type/payload must equal the candidate exactly.',
    ].join("\n");
    const user = JSON.stringify(
      redactStructured({
        instruction,
        candidateActionType: candidateAActionType,
        candidatePayload: candidateAPayload,
      }),
    );
    try {
      this.secondCandidateProvider ??= resolveProvider("groq");
      const raw = await this.secondCandidateProvider.complete({ system, user, json: true });
      const parsed = SecondCandidateSchema.parse(JSON.parse(raw));
      if (!allowedActionTypes.includes(parsed.action_type)) return null;
      return { actionType: parsed.action_type, payload: parsed.payload };
    } catch {
      return null;
    }
  }
}
