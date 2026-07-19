// Water-domain knowledge layer (§39 blueprint): NOT dealer-specific business logic.
// Shared, stable, public-domain water treatment knowledge — populated now, because it
// doesn't wait on any dealer's SOPs. Exposed as a lookup plugin: answer_water_question.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult } from "@finnor/shared-types";
import { hybridRetrieve, type SemanticHit } from "@finnor/memory";
import { readConfidenceThreshold } from "../shared/plugin-interface";
import { z } from "zod";

export const WaterQuestionPayloadSchema = z.object({
  topic: z.string().min(1),
});

/** Public-domain reference thresholds and treatment approaches. */
export const WATER_KNOWLEDGE: Record<string, { summary: string; treatment: string }> = {
  hardness: {
    summary:
      "Water hardness is measured in grains per gallon (gpg). 0–3.5 gpg is soft, 3.5–7 moderately hard, 7–10.5 hard, above 10.5 very hard. Hard water scales pipes, fixtures, and appliances.",
    treatment: "Ion-exchange water softener sized to household usage and hardness level.",
  },
  iron: {
    summary:
      "Iron above 0.3 ppm (the EPA secondary standard) causes staining, metallic taste, and appliance damage. Common in well water.",
    treatment: "Oxidizing iron filter (air-injection or greensand); softeners handle only low, dissolved (ferrous) iron.",
  },
  pfas: {
    summary:
      "PFAS ('forever chemicals') are regulated by the EPA at 4 ppt for PFOA/PFOS in drinking water (2024 rule). They do not break down naturally.",
    treatment: "Activated carbon, ion exchange resin, or reverse osmosis at point of use; RO is the common residential answer.",
  },
  lead: {
    summary:
      "The EPA action level for lead is 15 ppb, with a stated goal of zero — no level of lead exposure is considered safe. Usually enters water from plumbing, not the source.",
    treatment: "NSF/ANSI 53-certified filtration or reverse osmosis at point of use; fix or bypass lead service lines where present.",
  },
  chlorine: {
    summary:
      "Municipal water is disinfected with chlorine or chloramine (typically 0.2–4 ppm). Safe, but affects taste and odor and dries skin.",
    treatment: "Whole-home activated carbon filtration; catalytic carbon for chloramine.",
  },
  sulfur: {
    summary:
      "Hydrogen sulfide gas causes rotten-egg odor, most often in well water. Detectable by smell well below 1 ppm.",
    treatment: "Air-injection oxidizing filter or chlorination followed by carbon filtration, depending on concentration.",
  },
};

const ACTION = "answer_water_question";

export const waterDomainKnowledgePlugin: DomainEnginePlugin = {
  name: "water-domain-knowledge",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: WaterQuestionPayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = WaterQuestionPayloadSchema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => i.message) };
  },

  draft(actionType, payload, policy): DraftAction {
    const p = WaterQuestionPayloadSchema.parse(payload);
    return {
      actionType,
      summary: `Answer a water treatment question about: ${p.topic}`,
      payload: { ...p, tenantId: policy.tenantId, retrievalConfidenceThreshold: readConfidenceThreshold(policy) },
      // Read-only knowledge lookup — policies may still gate it, default is not to.
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const topic = String(draft.payload.topic ?? "").toLowerCase();
    const confidenceThreshold = typeof draft.payload.retrievalConfidenceThreshold === "number" ? draft.payload.retrievalConfidenceThreshold : undefined;
    const match = Object.entries(WATER_KNOWLEDGE).find(([k]) => topic.includes(k));
    // §5.3: the canned table below IS this action's structured source — a real,
    // versioned, public-domain reference, not a guess. Semantic memory supplements
    // with anything dealer-specific (their own SOP for a topic) but never overrides a
    // canned entry when one exists — retrieval order is law even for a static lookup.
    const structured = match ? [{ source: "water_knowledge_reference", ref: match[0], data: match[1] }] : [];
    const retrieval = tenantId
      ? await hybridRetrieve({ tenantId, query: topic, structured, confidenceThreshold })
      : { citations: [], semanticHits: [] as SemanticHit[] };

    if (!match) {
      return {
        status: "success",
        output: {
          answer: `No canned knowledge entry for "${topic}". Known topics: ${Object.keys(WATER_KNOWLEDGE).join(", ")}.`,
          citations: retrieval.citations,
        },
      };
    }
    const [key, entry] = match;
    return {
      status: "success",
      output: { topic: key, summary: entry.summary, treatment: entry.treatment, citations: retrieval.citations },
      expected: { answered: true },
    };
  },
};

export default waterDomainKnowledgePlugin;
