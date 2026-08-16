import type { OperatingContext } from "@finnor/shared-types";

const COMPETITOR_RESEARCH = /\b(?:competitor|competitors|comparable compan(?:y|ies)|peer compan(?:y|ies))\b/i;
const RESEARCH = /\b(?:find|identify|research|search|look up|compare|benchmark)\b/i;
const MUTATION = /\b(?:create|send|contact|call|email|text|launch|buy|purchase|approve|delete|update)\b/i;
const COMPANY_PRONOUN = /\b(?:me|my|us|our|ours|we|the company|our company)\b/i;
const COMPARATIVE = /\b(?:better|worse|outperform|underperform|ahead|behind)\b/i;

export interface ResolvedResearchContext {
  companyName: string;
  industry: string;
  niche?: string;
  geographies: string[];
  idealCustomerProfile: Record<string, unknown>;
  comparison: {
    founderAge?: number;
    ageToleranceYears?: number;
    founderAgeMin?: number;
    founderAgeMax?: number;
    scaleMetric?: string;
    minScaleUsd?: number;
    maxScaleUsd?: number;
    performanceMetric?: string;
    companyBaseline?: string | number;
  };
  sourceKinds: ["PROFILE", "WEB"];
}

export type ResearchResolution =
  | { route: "not_research" }
  | {
      route: "clarification";
      action: {
        action_type: "clarification_request";
        payload: { question: string; missingFields: string[]; context: string };
        reasoning: string;
      };
    }
  | {
      route: "resolved";
      action: {
        action_type: "search_web";
        payload: { query: string; numResults: number; researchContext: ResolvedResearchContext };
        reasoning: string;
      };
    };

function numberFact(facts: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = facts[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && /^\d{1,3}(?:\.\d+)?$/.test(value.trim())) return Number(value);
  }
  return undefined;
}

function employeeAge(context: OperatingContext): number | undefined {
  const facts = context.employee.profile.profileFacts;
  const explicit = numberFact(facts, "age", "founderAge", "ownerAge");
  if (explicit && explicit >= 18 && explicit <= 100) return Math.floor(explicit);
  const birthDate = [facts.birthDate, facts.dateOfBirth].find((value): value is string => typeof value === "string");
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  const asOf = new Date(context.assembledAt);
  if (Number.isNaN(birth.getTime()) || birth > asOf) return undefined;
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  if (asOf.getUTCMonth() < birth.getUTCMonth() || (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 18 && age <= 100 ? age : undefined;
}

function explicitAge(instruction: string): number | undefined {
  const match = instruction.match(/\b(?:age(?:d)?\s*[:=]?\s*|I(?:'m| am)\s+|around\s+)(\d{2})(?:\s*years?\s*old|-year-old)?\b/i);
  const age = match ? Number(match[1]) : undefined;
  return age && age >= 18 && age <= 100 ? age : undefined;
}

function explicitAgeRange(instruction: string): { founderAgeMin: number; founderAgeMax: number } | null {
  const match = instruction.match(/\b(?:ages?|founder(?:\/owner)?\s+ages?|age\s+range)\s*[:=]?\s*(\d{2})\s*(?:[-–—]|to|through)\s*(\d{2})\b/i);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return min >= 18 && max <= 100 && min <= max ? { founderAgeMin: min, founderAgeMax: max } : null;
}

function scaleRange(instruction: string): { minScaleUsd: number; maxScaleUsd: number } | null {
  const match = instruction.match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?\s*(?:[-–—]|to|through)\s*\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)\b/i);
  if (!match) return null;
  const multiplier = (unit: string | undefined) => /^(?:m|million)$/i.test(unit ?? "") ? 1_000_000 : /^(?:k|thousand)$/i.test(unit ?? "") ? 1_000 : 1;
  const min = Number(match[1]) * multiplier(match[2] ?? match[4]);
  const max = Number(match[3]) * multiplier(match[4] ?? match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) return null;
  return { minScaleUsd: min, maxScaleUsd: max };
}

function geographyFromInstruction(instruction: string): string | undefined {
  const match = instruction.match(/\b(?:in|near|within)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?=\s+(?:around\s+my\s+age|doing|that|with|at|in\s+the|and\s+(?:doing|around)|\$)|[,;?.]|$)/i);
  return match?.[1]?.trim().replace(/\s+/g, " ");
}

function scaleMetricFromInstruction(instruction: string): string | undefined {
  if (/\b(?:annual\s+)?revenue\b/i.test(instruction)) return "annual revenue";
  if (/\bARR\b|annual recurring revenue/i.test(instruction)) return "ARR";
  if (/\b(?:gross\s+)?sales\b/i.test(instruction)) return "annual sales";
  if (/\bEBITDA\b/i.test(instruction)) return "EBITDA";
  return undefined;
}

function performanceMetricFromInstruction(instruction: string): string | undefined {
  const metrics: Array<[RegExp, string]> = [
    [/\bcustomer acquisition cost\b|\bCAC\b/i, "customer acquisition cost"],
    [/\bcustomer acquisition\b/i, "customer acquisition performance"],
    [/\blead conversion(?: rate)?\b/i, "lead conversion rate"],
    [/\brevenue growth\b/i, "revenue growth"],
    [/\bprofit(?:ability| margin)?\b|\bmargin\b/i, "profit margin"],
    [/\bcustomer retention\b|\bchurn\b/i, "customer retention"],
    [/\bonline reviews?\b|\brating\b/i, "customer review rating"],
  ];
  return metrics.find(([pattern]) => pattern.test(instruction))?.[1];
}

function baselineFor(context: OperatingContext, metric: string | undefined): string | number | undefined {
  if (!metric) return undefined;
  const facts = context.tenant.profile.businessFacts;
  const normalized = metric.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const [key, value] of Object.entries(facts)) {
    if (key.toLowerCase().replace(/[^a-z0-9]+/g, "") !== normalized) continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 100);
  }
  return undefined;
}

function baselineFromInstruction(instruction: string): string | undefined {
  const labeled = instruction.match(/\b(?:company\s+comparison\s+baseline|company\s+baseline|our\s+baseline)\s*[:=]\s*([^;,.\n]{1,80})/i)?.[1]?.trim();
  if (labeled) return labeled;
  const comparative = instruction.match(/\b(?:our|the\s+company(?:'s)?|company(?:'s)?)\b[^.\n]{0,100}?\b(?:is|at|equals?)\s+(\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|million|m|thousand|k))?)/i)?.[1]?.trim();
  return comparative || undefined;
}

function usdCompact(value: number): string {
  if (value >= 1_000_000) return `$${value / 1_000_000}M`;
  if (value >= 1_000) return `$${value / 1_000}K`;
  return `$${value}`;
}

function clarificationQuestion(missing: string[]): string {
  const prompts: Record<string, string> = {
    "company industry/niche": "your company's industry or niche",
    "authenticated user age": "your age (or a target founder-age range)",
    "scale metric": "whether the dollar bracket means annual revenue, ARR, sales, or another scale metric",
    "comparison metric": "the metric that defines better/worse (for example lead conversion, CAC, growth, or margin)",
    "company comparison baseline": "your company's current value for that comparison metric",
    geography: "the target geography",
  };
  const items = missing.map((field) => prompts[field] ?? field);
  if (items.length === 1) return `Before I research actual comparable companies, what is ${items[0]}?`;
  return `Before I research actual comparable companies, please provide ${items.slice(0, -1).join(", ")}, and ${items.at(-1)}.`;
}

/** Bind external competitor research to authenticated company/user facts. */
export function resolveCompetitorResearch(instruction: string, context: OperatingContext): ResearchResolution {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!normalized || MUTATION.test(normalized) || !COMPETITOR_RESEARCH.test(normalized) || !RESEARCH.test(normalized)) return { route: "not_research" };

  const profile = context.tenant.profile;
  const industry = profile.niche ?? profile.industry ?? undefined;
  const geography = geographyFromInstruction(normalized) ?? profile.primaryGeographies[0];
  const wantsAuthenticatedAge = /\b(?:my|our founder(?:'s)?|owner(?:'s)?)\s+age\b|\baround\s+my\s+age\b/i.test(normalized);
  const ageRange = explicitAgeRange(normalized);
  const age = ageRange ? undefined : explicitAge(normalized) ?? (wantsAuthenticatedAge ? employeeAge(context) : undefined);
  const range = scaleRange(normalized);
  const scaleMetric = scaleMetricFromInstruction(normalized) ?? profile.comparisonDefaults.scaleMetric;
  const wantsComparison = COMPARATIVE.test(normalized);
  const performanceMetric = performanceMetricFromInstruction(normalized) ?? profile.comparisonDefaults.performanceMetric;
  const baseline = baselineFromInstruction(normalized) ?? baselineFor(context, performanceMetric);
  const missing: string[] = [];
  if (!industry) missing.push("company industry/niche");
  if (!geography) missing.push("geography");
  if (wantsAuthenticatedAge && !age && !ageRange) missing.push("authenticated user age");
  if (range && !scaleMetric) missing.push("scale metric");
  if (wantsComparison && !performanceMetric) missing.push("comparison metric");
  // The baseline is essential even when the comparison metric itself is still
  // unresolved. Asking for both in the same clarification prevents a second
  // question after the user supplies the metric.
  if (wantsComparison && baseline === undefined) missing.push("company comparison baseline");

  if (missing.length > 0) {
    return {
      route: "clarification",
      action: {
        action_type: "clarification_request",
        payload: {
          question: clarificationQuestion(missing),
          missingFields: missing,
          context: `Competitor research for ${context.tenant.companyName ?? "the authenticated company"}; unresolved fields were not inferred. Original request: ${normalized.slice(0, 650)}`,
        },
        reasoning: "Authenticated operating context was incomplete for a company-specific comparison, so one clarification replaces guessed research assumptions.",
      },
    };
  }

  const companyName = context.tenant.companyName ?? "the authenticated company";
  const candidateCount = Math.max(1, Math.min(Number(normalized.match(/\b(?:find|identify|research)\s+(\d{1,2})\b/i)?.[1] ?? 5), 10));
  const comparison: ResolvedResearchContext["comparison"] = {
    ...(age ? { founderAge: age, ageToleranceYears: 5 } : {}),
    ...(ageRange ?? {}),
    ...(scaleMetric ? { scaleMetric } : {}),
    ...(range ?? {}),
    ...(performanceMetric ? { performanceMetric } : {}),
    ...(baseline === undefined ? {} : { companyBaseline: baseline }),
  };
  const researchContext: ResolvedResearchContext = {
    companyName,
    industry: profile.industry ?? industry!,
    ...(profile.niche ? { niche: profile.niche } : {}),
    geographies: [geography!],
    idealCustomerProfile: profile.idealCustomerProfile,
    comparison,
    sourceKinds: ["PROFILE", "WEB"],
  };
  const constraints = [
    `${candidateCount} actual ${profile.niche ?? industry} companies in ${geography}`,
    range && scaleMetric ? `${scaleMetric} ${usdCompact(range.minScaleUsd)}-${usdCompact(range.maxScaleUsd)}` : null,
    age ? `founder/owner age about ${age} (±5), only when verifiable` : ageRange ? `founder/owner age ${ageRange.founderAgeMin}-${ageRange.founderAgeMax}, only when verifiable` : null,
    performanceMetric ? `compare ${performanceMetric} with ${companyName} baseline ${String(baseline)}` : null,
  ].filter(Boolean).join("; ");
  const query = `Identify ${constraints}. Return company-specific, source-backed candidates. Use primary/reputable evidence; exclude generic market statistics and never infer private finances, ages, or comparability.`.slice(0, 400);
  return {
    route: "resolved",
    action: {
      action_type: "search_web",
      payload: { query, numResults: Math.max(candidateCount, 5), researchContext },
      reasoning: `External research bound "${COMPANY_PRONOUN.test(normalized) ? "me/us" : "company"}" to authenticated PROFILE context; candidate claims still require WEB evidence.`,
    },
  };
}
