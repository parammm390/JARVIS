export const DEPLOYMENT_START_USD = 30_000;

export type InteractionMode = "text" | "voice";
export type IntelligencePolicy = "efficient" | "balanced" | "frontier";

export const interactionModes = [
  {
    key: "text",
    name: "Text / chat-native",
    summary: "Typed instructions, chat, webhooks and worker channels.",
    scopeEffect: "The simplest interaction boundary and the normal starting point.",
  },
  {
    key: "voice",
    name: "Text + voice-native",
    summary: "Adds a configured live voice channel to the same operating system.",
    scopeEffect: "Adds call flows, interruption handling, channel policy, testing and support.",
  },
] as const;

export const intelligencePolicies = [
  {
    key: "efficient",
    name: "Efficient",
    summary: "Fast, cost-conscious intelligence for repeatable, well-bounded work.",
    bestFor: "High-volume classification, extraction, routing and routine assistance.",
  },
  {
    key: "balanced",
    name: "Balanced",
    summary: "A practical mix of speed, cost and deeper reasoning across daily operations.",
    bestFor: "Most company deployments and mixed operational work.",
  },
  {
    key: "frontier",
    name: "Frontier / complex reasoning",
    summary: "Stronger reasoning reserved for ambiguous, research-heavy or high-consequence work.",
    bestFor: "Complex planning, synthesis and decisions where more reasoning materially helps.",
  },
] as const;

export const advancedIntelligenceNote =
  "FINNOR routes intelligence by purpose, channel, latency, availability and tenant budget. Approved provider or model preferences and restrictions can be configured when required, but they are not the normal buying decision.";

export const operatingAreas = [
  {
    name: "Customers",
    verb: "Keep the relationship attached",
    copy: "Identity, history, equipment, conversations and the next commitment stay connected to the same operating record.",
    accent: "electric",
  },
  {
    name: "Work",
    verb: "Turn intent into owned work",
    copy: "Requests become bounded work with owners, dependencies, status and a clear definition of done.",
    accent: "blue",
  },
  {
    name: "Schedule / dispatch",
    verb: "Make the day executable",
    copy: "Availability, route, technician skill and customer timing are planned together instead of reconciled later.",
    accent: "violet",
  },
  {
    name: "Inventory",
    verb: "Attach stock to the promise",
    copy: "Equipment and materials can be checked and reserved against the exact work they are meant to complete.",
    accent: "orange",
  },
  {
    name: "Quotes / proposals",
    verb: "Keep price grounded",
    copy: "Proposals and quote preparation stay tied to configured price data, scope and the work that produced them.",
    accent: "electric",
  },
  {
    name: "Communications",
    verb: "Respect the channel and authority",
    copy: "Text or voice-enabled contact can be prepared, held, approved and recorded according to the deployment policy.",
    accent: "blue",
  },
  {
    name: "Money",
    verb: "Close the commercial loop",
    copy: "Invoices, payments and collections remain downstream of completed work and the company’s authority boundary.",
    accent: "violet",
  },
  {
    name: "Research / intelligence",
    verb: "Bring outside facts into context",
    copy: "Configured research can support a decision while remaining distinct from the company records that define operational truth.",
    accent: "orange",
  },
  {
    name: "Agents",
    verb: "Give each agent a bounded job",
    copy: "Agent scope, tools, channels and escalation rules are configured around the roles the company chooses to activate.",
    accent: "electric",
  },
] as const;

export const faqItems = [
  {
    question: "What is FINNOR?",
    answer:
      "FINNOR is a customized AI operating and execution system for water-treatment companies. It is configured around how a specific company runs, then coordinates customers, work, schedule, inventory, quotes, communication, money, research and agents where those areas are included in the deployment.",
  },
  {
    question: "What is JARVIS?",
    answer:
      "JARVIS is FINNOR’s command and work surface. It is where operators understand the business, state an outcome, inspect the proposed work, approve consequential actions, follow execution and review recovery and evidence. FINNOR is the operating layer behind that surface.",
  },
  {
    question: "Is FINNOR a chatbot, voice agent or generic automation tool?",
    answer:
      "No. Conversation can be one way to give FINNOR an instruction, but the product is the configured operating and execution layer that keeps records, policy, approvals, actions, recovery and evidence connected. A text-only deployment and a voice-enabled deployment use the same underlying control model.",
  },
  {
    question: "Does FINNOR replace our CRM, field-service or accounting system?",
    answer:
      "Not by default. FINNOR coordinates the operating state across the native records and configured systems a company relies on. During deployment, the team defines which source is authoritative for customers, work, schedule, inventory, quotes, communication and money. An integration is never implied merely because a product name exists in the market.",
  },
  {
    question: "What is company-specific in a FINNOR deployment?",
    answer:
      "The scope can differ by workflow, integration, operating surface, location, role, authority policy, approval route, AI policy, text or voice channel, agent scope and workspace requirement. Source quality, vendor agreements, recovery paths, access controls, retention and support needs also affect what can be activated.",
  },
  {
    question: "Why start with one consequential workflow?",
    answer:
      "That workflow is the first certified operating chain inside a broader company deployment—not the whole product. FINNOR maps it end to end, tests the normal and failure paths, proves authority and recovery, then uses the evidence to decide where the deployment should expand next.",
  },
  {
    question: "Can a deployment be text-only or voice-enabled?",
    answer:
      "Yes. Some companies may begin with typed commands, webhooks, workers or text communication. Others may include a configured voice channel. Voice changes the implementation scope, channel policy, testing and support requirements; it does not change FINNOR’s product category.",
  },
  {
    question: "Does FINNOR use more than one AI model or provider?",
    answer:
      "It can. Buyers normally choose an understandable intelligence policy—Efficient, Balanced or Frontier / complex reasoning—rather than a model name. FINNOR can then route different tasks by purpose, channel, latency, cost, tenant budget and availability, with provider fallback where configured. Approved provider or model preferences can remain an advanced restriction. FINNOR is not an LLM marketplace or token resale product.",
  },
  {
    question: "Can FINNOR contact customers or move money automatically?",
    answer:
      "Only when the deployment’s authority policy permits the specific action. Customer contact, invoices, payments and collections can cross a confirmation boundary. Missing authority resolves to a hold or escalation rather than turning an instruction into unlimited permission.",
  },
  {
    question: "What happens when a configured system fails?",
    answer:
      "A provider acknowledgement is not treated as final success. FINNOR preserves the instruction and recovery state while it handles the supported retry, pause, escalation, dead-letter, compensation or reconciliation path. The work stays open until the actual operating state is known.",
  },
  {
    question: "What does a production deployment include?",
    answer:
      "A typical scope can include an operating review, workflow mapping, source and system mapping, integrations, policy and authority configuration, workspace setup, recovery testing, onboarding, production activation and ongoing operating support. The exact work is agreed for the company rather than selected from a generic feature tier.",
  },
  {
    question: "How much does FINNOR cost?",
    answer:
      "Production deployments start around $30,000. A focused implementation commonly sits in the $30,000–$50,000 range. Final pricing depends on interaction mode, intelligence policy, operating coverage, workflow and integration complexity, locations, authority, agent channels, custom workspace engineering, reliability and ongoing support. Excluding unneeded areas reduces scope; voice, stronger intelligence, more connected operations and custom design increase it.",
  },
  {
    question: "Why can two FINNOR deployments receive materially different quotes?",
    answer:
      "A text-native deployment covering one certified workflow, a few operating areas and existing source systems has a very different implementation boundary from a voice-native, multi-location deployment with complex reasoning, layered approvals, several agents, custom workspaces and higher reliability requirements. The quote follows that boundary, not a generic seat count or hidden model menu.",
  },
] as const;
