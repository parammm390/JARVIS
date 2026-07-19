// §5.7 (JARVIS 95% MAESTRO PACK): 40 hand-labeled Q -> expected-source fixtures over
// Dealer Zero's known corpus. Two kinds of "known corpus":
//
// 1. Dealer Zero's REAL configured business values (domain_policies, price_book_items,
//    seeded households/equipment) — pulled directly from the live seeded tenant, not
//    invented. SOP_DOCS below restates these as the prose a real dealer's own
//    documents would contain, so semantic retrieval has real content to find.
// 2. Dealer Zero's REAL structured facts, queried through the real answer-action
//    plugins (water knowledge's canned table, the live business overview, real
//    household records) — no ingestion needed, these are always live.
//
// Honest gap: Dealer Zero's auto-ingested operational history (decision_receipts ->
// embeddings via the §5.2 hook) is real but machine-log-shaped (`visitId: <uuid>`,
// `status: confirmed`) — the life simulator doesn't yet generate narrative visit notes
// or complaint transcripts a customer would plausibly ask about in natural language.
// SOP_DOCS exists specifically to give this eval a real, honestly-sourced corpus of
// natural-language dealer content instead of building fixtures against IDs nobody
// would ever ask about.

export const DEALER_ZERO_TENANT_ID = "00000000-0000-4000-8000-0000000000d0";

// Real households seeded by scripts/seed-dealer-zero.ts (verified live against this
// environment's own database — addresses/equipment are real seeded rows, not invented).
export const REAL_HOUSEHOLDS = {
  softener: { id: "f76f9517-671f-49f2-a527-f748e12f7350", address: "8289 Main St, Cedar Falls, IA", equipmentType: "water_softener" },
  carbonFilter: { id: "34a773a3-ef65-406e-8449-24884319b114", address: "5253 Cedar Heights Dr, Waterloo, IA", equipmentType: "whole_house_filter" },
};

export interface SopDoc {
  sourceDocId: string;
  text: string;
}

// Restates Dealer Zero's real domain_policies/pricing_catalog/schema values as prose —
// every number here is copied from the live seeded policy rows (see the commit message
// for the exact query), not invented.
export const SOP_DOCS: SopDoc[] = [
  { sourceDocId: "eval-sop:service-area", text: "Finnor Water Co. services within a 25 mile radius of Cedar Falls and Waterloo, Iowa. Requests further out are declined or referred elsewhere." },
  { sourceDocId: "eval-sop:amc-price", text: "Our annual maintenance contract renews at $249 per year, with annual or semi-annual billing options available." },
  { sourceDocId: "eval-sop:amc-renewal-window", text: "We reach out to renew a maintenance agreement starting 30 days before it's set to expire." },
  { sourceDocId: "eval-sop:scheduling-windows", text: "Water test appointments are offered in two windows: 9am to noon, or 1pm to 5pm." },
  { sourceDocId: "eval-sop:visit-duration", text: "A standard water test visit is scheduled for 45 minutes." },
  { sourceDocId: "eval-sop:labor-rate", text: "Our labor rate is $95 per hour, plus 7% sales tax on parts and labor." },
  { sourceDocId: "eval-sop:ro-membrane-life", text: "Reverse osmosis membranes should be replaced every 2 to 3 years for best performance." },
  { sourceDocId: "eval-sop:carbon-filter-life", text: "Whole-house carbon filters need replacing every 6 to 12 months depending on water usage." },
  { sourceDocId: "eval-sop:sediment-filter-life", text: "Sediment pre-filters should be swapped every 3 to 6 months." },
  { sourceDocId: "eval-sop:pfas-standard", text: "The EPA's 2024 rule sets the maximum contaminant level for PFOA and PFOS at 4 parts per trillion." },
  { sourceDocId: "eval-sop:fluoride-standard", text: "The EPA's secondary standard for fluoride is 2 milligrams per liter, with a maximum contaminant level of 4 milligrams per liter." },
  { sourceDocId: "eval-sop:compliance-format", text: "Compliance summaries are generated as a PDF citing the EPA National Primary and Secondary Drinking Water Regulations." },
  { sourceDocId: "eval-sop:review-request", text: "After a completed job we text the customer a link asking for a Google review." },
  { sourceDocId: "eval-sop:reorder-policy", text: "When inventory drops below its reorder threshold, we automatically draft a reorder flag for the owner to approve." },
  { sourceDocId: "eval-sop:service-due-followup", text: "When equipment may be due for service, we send a message asking the customer to reply or call to book a visit." },
  { sourceDocId: "eval-sop:ad-budget", text: "Ad campaigns launch paused with a default daily budget of $30, capped at a maximum of $50 per day." },
  { sourceDocId: "eval-sop:recent-install-followup", text: "We send installation proposals to recent installs in batches of up to 10 households, covering a rolling 30 day window." },
  { sourceDocId: "eval-sop:hardness-classification", text: "Water hardness of 7 to 10.5 grains per gallon is classified as hard; above 10.5 grains per gallon is very hard." },
  { sourceDocId: "eval-sop:invoicing", text: "We invoice customers once a job is complete and offer online payment on that invoice." },
  { sourceDocId: "eval-sop:technician-count", text: "We have 3 technicians on staff covering the Cedar Falls and Waterloo service area." },
  { sourceDocId: "eval-sop:emergency-service", text: "For urgent issues like a leak or no water, call our line directly and we'll prioritize same-day dispatch when possible." },
  { sourceDocId: "eval-sop:iron-filter-product", text: "Our iron filter installations use an Iron and Sulfur Removal System, effective for both dissolved iron and rotten-egg odor." },
  { sourceDocId: "eval-sop:softener-product", text: "Our standard water softener install is the HE Softener 45k, sized to the household's actual hardness level." },
  { sourceDocId: "eval-sop:carbon-filter-product", text: "For chlorine taste and odor, we install whole-house carbon filtration systems." },
  { sourceDocId: "eval-sop:workmanship-guarantee", text: "If something goes wrong with a recent installation, contact us and we'll send a technician back out to make it right — installation issues are covered under our workmanship guarantee." },
  { sourceDocId: "eval-sop:sizing-process", text: "We size your equipment to your household's actual water usage and test results before quoting, rather than a one-size-fits-all recommendation." },
  { sourceDocId: "eval-sop:water-test-process", text: "A water test visit includes a raw water sample collected before any existing treatment equipment, tested for hardness, iron, and other common contaminants." },
];

export type FixtureRoute = "water_question" | "business_overview" | "business_question" | "customer_question";

export interface EvalFixture {
  id: string;
  route: FixtureRoute;
  question: string;
  /** water_question only: the payload.topic string (a pre-extracted keyword, matching
   *  this action's real payload contract — not raw customer speech). */
  topic?: string;
  /** customer_question only: ties the question to a real seeded household. */
  householdId?: string;
  /** The source this fixture expects to see among the returned citations. */
  expectedSource: "water_knowledge_reference" | "business_overview" | "household360" | "semantic_memory";
  /** For semantic_memory: a substring the winning citation's ref (sourceDocId) must contain. */
  expectedRefContains?: string;
}

export const FIXTURES: EvalFixture[] = [
  // --- Water knowledge (canned reference table), 6 ---
  { id: "water-hardness", route: "water_question", topic: "is my water considered hardness a problem", question: "Is my water hard?", expectedSource: "water_knowledge_reference" },
  { id: "water-iron", route: "water_question", topic: "orange stains from iron in the water", question: "Why does my water leave orange stains?", expectedSource: "water_knowledge_reference" },
  { id: "water-pfas", route: "water_question", topic: "pfas forever chemicals in tap water", question: "Are PFAS forever chemicals in my tap water dangerous?", expectedSource: "water_knowledge_reference" },
  { id: "water-lead", route: "water_question", topic: "lead levels in my drinking water", question: "How much lead is safe in drinking water?", expectedSource: "water_knowledge_reference" },
  { id: "water-chlorine", route: "water_question", topic: "chlorine taste from municipal water", question: "Why does my tap water taste like chlorine?", expectedSource: "water_knowledge_reference" },
  { id: "water-sulfur", route: "water_question", topic: "sulfur rotten egg smell in well water", question: "Why does my well water smell like rotten eggs?", expectedSource: "water_knowledge_reference" },

  // --- Business overview (live query), 4 ---
  { id: "biz-overview-all", route: "business_overview", question: "all", expectedSource: "business_overview" },
  { id: "biz-overview-invoices", route: "business_overview", question: "invoices", expectedSource: "business_overview" },
  { id: "biz-question-pending", route: "business_question", question: "How many actions are waiting on my approval right now?", expectedSource: "business_overview" },
  { id: "biz-question-inventory", route: "business_question", question: "Is anything low on inventory right now?", expectedSource: "business_overview" },

  // --- Household-specific (real seeded households), 3 ---
  { id: "household-softener-equipment", route: "customer_question", householdId: REAL_HOUSEHOLDS.softener.id, question: "What equipment do you have on file for my house?", expectedSource: "household360" },
  { id: "household-carbon-equipment", route: "customer_question", householdId: REAL_HOUSEHOLDS.carbonFilter.id, question: "What did you install at my address?", expectedSource: "household360" },
  { id: "household-service-history", route: "customer_question", householdId: REAL_HOUSEHOLDS.softener.id, question: "What's the service history on my account?", expectedSource: "household360" },

  // --- Semantic memory (real dealer SOPs, grounded in Dealer Zero's live policy values), 27 ---
  { id: "sop-service-area", route: "customer_question", question: "How far do you travel for service calls?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:service-area" },
  { id: "sop-amc-price", route: "customer_question", question: "How much does the annual maintenance contract cost to renew?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:amc-price" },
  { id: "sop-amc-renewal-window", route: "customer_question", question: "When do you contact customers about renewing their maintenance agreement?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:amc-renewal-window" },
  { id: "sop-scheduling-windows", route: "customer_question", question: "What time windows can I book a water test appointment in?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:scheduling-windows" },
  { id: "sop-visit-duration", route: "customer_question", question: "How long does a water test appointment usually take?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:visit-duration" },
  { id: "sop-labor-rate", route: "customer_question", question: "What do you charge per hour for labor?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:labor-rate" },
  { id: "sop-ro-membrane-life", route: "customer_question", question: "How often should I replace my reverse osmosis membrane?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:ro-membrane-life" },
  { id: "sop-carbon-filter-life", route: "customer_question", question: "How often do whole-house carbon filters need to be changed?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:carbon-filter-life" },
  { id: "sop-sediment-filter-life", route: "customer_question", question: "How often should the sediment pre-filter be replaced?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:sediment-filter-life" },
  { id: "sop-pfas-standard", route: "customer_question", question: "What's the EPA limit for PFOA and PFOS in drinking water?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:pfas-standard" },
  { id: "sop-fluoride-standard", route: "customer_question", question: "What fluoride limit does the EPA set for drinking water?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:fluoride-standard" },
  { id: "sop-compliance-format", route: "customer_question", question: "What format do you provide compliance reports in?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:compliance-format" },
  { id: "sop-review-request", route: "customer_question", question: "How do you ask customers to leave a review?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:review-request" },
  { id: "sop-reorder-policy", route: "customer_question", question: "What happens when you're running low on a part?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:reorder-policy" },
  { id: "sop-service-due-followup", route: "customer_question", question: "What message do you send when it's time for a service visit?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:service-due-followup" },
  { id: "sop-ad-budget", route: "customer_question", question: "What's your daily budget for advertising campaigns?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:ad-budget" },
  { id: "sop-recent-install-followup", route: "customer_question", question: "How do you follow up with recently installed customers about new proposals?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:recent-install-followup" },
  { id: "sop-hardness-classification", route: "customer_question", question: "At what hardness level is water officially considered hard?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:hardness-classification" },
  { id: "sop-invoicing", route: "customer_question", question: "How do I pay my invoice after a job is done?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:invoicing" },
  { id: "sop-technician-count", route: "customer_question", question: "How many technicians do you have on staff?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:technician-count" },
  { id: "sop-emergency-service", route: "customer_question", question: "What do I do if I have a water emergency like a leak?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:emergency-service" },
  { id: "sop-iron-filter-product", route: "customer_question", question: "What kind of system do you install for iron problems?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:iron-filter-product" },
  { id: "sop-softener-product", route: "customer_question", question: "What softener model do you typically install?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:softener-product" },
  { id: "sop-carbon-filter-product", route: "customer_question", question: "What do you install to remove chlorine taste from water?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:carbon-filter-product" },
  { id: "sop-workmanship-guarantee", route: "customer_question", question: "Do you guarantee your installation work?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:workmanship-guarantee" },
  { id: "sop-sizing-process", route: "customer_question", question: "How do you decide what size system I need?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:sizing-process" },
  { id: "sop-water-test-process", route: "customer_question", question: "What does a water test appointment actually involve?", expectedSource: "semantic_memory", expectedRefContains: "eval-sop:water-test-process" },
];
