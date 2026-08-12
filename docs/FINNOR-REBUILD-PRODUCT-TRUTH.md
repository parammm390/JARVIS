# FINNOR rebuild: product truth, live-site audit, and positioning decision

Date: 2026-08-09  
Scope: live `finnorai.com`, public marketing and demo routes, signed-out JARVIS routes, repository product code, release evidence, execution contracts, integrations, policies, approvals, recovery, memory, evidence, and product surfaces.

## Decision

FINNOR is not best described as voice AI, an answering service, a booking product, household memory, a CRM replacement, or a generic AI operating system.

**Selected category:** the governed execution system for water treatment companies.

**Product definition:** FINNOR converts a business instruction into grounded context, an executable plan, an authority decision, durable cross-system work, verified operational change, and a permanent evidence record.

**JARVIS definition:** JARVIS is FINNOR's command surface. It is where an operator can understand the business, issue an instruction, review the plan, govern authority, watch execution, inspect recovery, and see what changed.

**Anchor promise:** One instruction. The whole operation moves.

**Narrative test:** every major section must advance one continuous transformation from complexity to verified change. A section that does not advance that transformation does not belong on the homepage.

## What the product actually is

### Instruction and understanding

- Accepts typed, voice, console, webhook, and worker-originated instructions.
- Creates durable instruction sessions and emits real lifecycle events: received, context retrieved, planning, plan ready, action created, gated/executing, and terminal outcome.
- Has a deterministic fast read lane for safe operational questions, separate from action selection.
- Grounds known entity IDs against tenant-scoped records before presenting a plan.
- Uses a fixed registered action vocabulary rather than allowing a model to invent arbitrary capabilities.

### Context and memory

- Assembles short-term session context, long-term household context, semantic retrieval, episodic action history, and detected operating patterns.
- Retrieves structured operational facts before semantic context when answering questions.
- Carries source citations and confidence with answers; low-confidence paths can refuse rather than invent.
- Auto-ingests completed workflow, receipt, report, and transcript evidence into semantic memory.
- Records operator corrections as first-class facts that outrank later semantic matches on the same topic.
- Can layer Zep temporal consolidation on top of the native memory tiers when configured; the product degrades honestly when it is not configured.

### Planning and critique

- Plans against 44 registered action contracts owned by 24 domain plugins.
- Supports both single actions and durable multi-step workflows.
- Compiles workflow-shaped actions into executable command graphs and tracks plan dependencies.
- Includes an optional independent critic for clear instruction/action mismatches.
- Includes a repair pass for known planner ambiguities; it does not silently apply low-confidence natural-language fixes.
- Can request clarification or suggest a manual step rather than forcing an unsafe action.

### Authority, policy, and approval

- Business rules are tenant data: policies, permissions, confirmation rules, timeouts, and effective versions.
- Missing policy defaults to deny-by-default human confirmation.
- Risk profiles distinguish read-only, drafts, internal writes, operational changes, external side effects, financial writes, batch actions, spend, and durable workflows.
- Consequential actions are gated in the executor and database, not merely in the UI.
- Higher-risk actions can require explicit typed confirmation.
- Owners can approve, reject, escalate, and, where supported, revert.
- Candidate policy changes can be simulated against recent receipt history without changing policy or replaying work.

### Execution

- Executes against native business records and connected provider tools through one registry and consistent validation boundary.
- Minimizes PII per external tool, loads secrets at the tool boundary, and records tool health without logging inputs and outputs.
- Uses operation claims and request hashes so retries do not duplicate successful external side effects.
- Supports workflow pause, resume, cancel, retry, and escalate with optimistic concurrency and a receipt for each control decision.
- Separates native systems of record from optional external bindings such as GoHighLevel.

### Reliability and recovery

- Uses durable workflow runs and steps, leases, heartbeats, priority lanes, and stuck-run deadlines.
- Uses a transactional outbox, inbound-event deduplication, retry with backoff, dead-letter handling, and reconciliation cases.
- Provides owner-gated replay/discard and advisory dead-letter triage; suggestions never execute themselves.
- Records compensation as a terminal business fact and updates the original receipt with compensation outcome.
- Can repair or escalate terminal plan failures without pretending an incomplete run succeeded.
- Distinguishes unknown delivery, unmatched provider events, unavailable configuration, and terminal failure.

### Evidence

- Opens decision receipts before consequential workflow steps and finalizes them with actual result or explicit failure.
- Receipts carry objective, proposed action, expected result, approval, policy ID/version, risk tier, correlation, workflow/action links, citations, and actual outcome.
- Maintains tenant-scoped audit and action logs, including immutable audit protections in the database.
- Work projections correlate exact durable IDs; they do not merge records by customer name, timestamp, or fuzzy similarity.
- External research can become versioned evidence with URL identity, retrieval time, content/change hashes, and freshness.

### Operational product surfaces

- **Home:** command surface, business pulse, current changes, approvals, instruction lifecycle, and operational briefing.
- **Work:** an exact causal spine from instruction through plan, owner, approval, execution, evidence/outcome, and next action.
- **Customers:** Household 360 across identity, contact methods, equipment, service, work, schedule, money, conversations, documents, and events.
- **Schedule:** dispatch field, placed/unplaced stops, stored coordinates, technician context, exact visit links, and route evidence.
- **Money:** open pressure, collected cash, overdue balance, invoice ledger, and exact invoice-to-cash work.
- **Agents:** five bounded channels under one authority boundary: JARVIS, follow-up, service reminder, win-back, and payment collector.

### Action scope

The current registered action scope includes:

- business overview and grounded business questions;
- customer and water-domain questions;
- contact, lead, opportunity, interaction, and assignment work;
- scheduling, rescheduling, technician availability and assignment, route suggestions, and water tests;
- quoting, equipment sizing, proposals, signatures, installation workflows, and compliance summaries;
- invoices, payments, payment reminders, overdue calls, and invoice-to-cash workflows;
- inventory checks, usage logging, and reorder risk;
- service reminders, maintenance renewals, visit reports, and issue flags;
- customer messages, follow-up, approved bulk outreach, review requests, win-back, and bounded voice channels;
- ad performance, approved campaign launch, web search, competitor scans, business reviews, and evidence retrieval.

### Integration truth

The source contains integration adapters and health contracts for Vapi, GoHighLevel, Stripe, DocuSign, QuickBooks, Meta Ads, Google Ads, Resend, email, Exa, Firecrawl, maps/geocoding, routing, Supabase/Postgres, Redis, Sentry, and optional consolidated memory.

This is not the same as saying every provider is live in production. The evidence shows a mixed posture:

- the native business layer and local execution contracts are real;
- 44 action registrations are source-verified;
- sandbox/native modes persist real FINNOR records while explicitly simulating only the final carrier hop where a live provider is absent;
- Vapi and several provider-specific write paths remain configuration- or owner-authorization-gated in current certification evidence;
- deployed frontend/backend version skew and environment drift have previously blocked real surfaces even when the matching source path passed locally;
- no marketing claim may promote “adapter exists” or “provider key exists” into “live, verified provider outcome.”

## Live-site route audit

The rendered live site and matching source were reviewed route by route. Signed-out product routes were inspected as their actual public boundary; authenticated behavior was reconstructed from current source and the checked-in system-contract evidence rather than bypassing access controls.

| Route | Current role | Audit finding |
| --- | --- | --- |
| `/` | Main marketing page | Broadly enumerates operations but still defines the category as “voice-native AI operations.” The story is a sequence of sections rather than one causal product event. The real JARVIS UI is described more often than shown. The page repeats deployment messaging and overuses labels, cards, pills, generic gradients, particles, and an orb as the dominant product image. |
| `/resources` | Resource hub | Repeats the homepage thesis, duplicates comparison headings, and routes back toward leads/answering services. Useful trust material exists, but the hub does not reinforce a distinctive category. |
| `/resources/dispatch-ai-glossary` | Glossary | Most terms are missed-lead, call-routing, booking, urgency, and recovery concepts. It materially narrows the product back to the old story. |
| `/resources/missed-call-cost-calculator` | Impact calculator | Renamed as an operations estimator but still calculates unanswered/slow-followed leads and job value. It is honest about assumptions, yet it is misaligned with the larger execution product. |
| `/resources/pilot-setup-checklist` | Deployment checklist | Still centers call forwarding, coverage windows, lead sources, booking questions, recording, and recovery fields. It does not prepare a buyer for policies, permissions, workflow certification, provider bindings, recovery, or evidence. |
| `/resources/admissions-ai-glossary` | Legacy route | Permanent redirect to the operations glossary; the legacy name is harmless but should remain intentionally non-canonical. |
| `/trust-safety` | Trust page | Correct high-level territory, but several card headings and body claims are mismatched: approval is paired with receipt copy, permissions with pricing, verification with setup, recovery with unknown-field behavior, and audit history with pilot minimization. This damages credibility precisely where precision matters most. |
| `/privacy` | Legal | Very short and still written around the v1 demo flow. It does not describe production scope beyond a general disclaimer. Preserve legal restraint; update styling and product naming without inventing policy. |
| `/terms` | Legal | Very short and oriented to illustrative demos and separately scoped production. Preserve its conservative boundary; update styling and product naming. |
| `/demo` | Public company demo builder | Real public-site inspection and bounded demo generation are useful, but its visible configuration is still primarily water-treatment quoting and booking. It should become a supporting proof route, not the definition of FINNOR. |
| `/demo/lifecycle` | Narrative demo | Strong craft and useful continuity, but “the next two years” and “one continuous memory” make memory the product. It should be reframed as evidence of continuity inside the larger execution system. |
| `/demo/[slug]` | Legacy dynamic demo | Redirects to `/demo`; the former synthetic dashboard was intentionally removed. Keep the redirect. |
| `/jarvis` | Main product | Actual command surface. Signed-out live page shows the wake boundary; authenticated evidence proves instruction, plan, approval, execution, receipt, and business-surface changes. Metadata still overweights speech and enumerated actions. |
| `/jarvis/login` | Authentication | Clear and appropriately restrained. |
| `/jarvis/work` | Product surface | One of the strongest product truths: exact causal records from instruction to proof. Signed-out state is honest. |
| `/jarvis/customers` | Product surface | Strong Household 360 concept and honest empty/source boundaries. Current title is double-suffixed with FINNOR. |
| `/jarvis/schedule` | Product surface | Strong exact-record and exception posture. Current title is double-suffixed with FINNOR. |
| `/jarvis/money` | Product surface | Strong cash-pressure and exact invoice-to-cash posture. Current title is double-suffixed with FINNOR. |
| `/jarvis/agents` | Product surface | Strong bounded-fleet model. Public signed-out rendering exposes source-unavailable details but honestly distinguishes provider status from agent readiness. |
| `/jarvis/bridge` | Alternate product surface | Useful activity/approval/vitals prototype, but “D1” is internal language and the route is visually less complete than the current primary surfaces. |
| `/jarvis/classic` | Legacy product surface | Duplicates the main personalized home and is correctly described as legacy; it should not influence marketing. |
| `/jarvis/next` | Feature-flagged route | Correctly 404s when disabled; represents the instruction-thread direction that has since informed the main product. |
| `/jarvis/showtime` | Dealer Zero demo | Explicitly synthetic and receipt-inspectable. Good internal proof source; not a production-outcome claim. |
| `/jarvis/stage` | Internal visual harness | Owner-gated and `noindex`. Correct boundary. |
| `/jarvis/reset-password` | Authentication | Functional, but inherits the global old product description when its own metadata omits a description. |

## Marketing diagnosis

### What is working

- The niche is explicit: water treatment companies.
- The page now acknowledges calls, CRM, schedule, proposals, invoices, inventory, technicians, campaigns, approval, and verification.
- It does not claim to replace the CRM.
- It generally marks demo and production boundaries.
- The light marketing palette is more distinctive than a generic dark-AI page.

### What is not working

- “Voice-native” still owns the category even though voice is only one input and one agent channel.
- Capability breadth is communicated by lists and cards, not by a product event the buyer can follow.
- The hero says the whole operation moves, but the primary visual is an ambient orb with sample states, not the operation moving.
- Real JARVIS screens appear as prose descriptions or isolated proof blocks instead of the main cinematic asset.
- The homepage repeats its deployment thesis and relies on generic pills, numbered labels, card grids, blurred color fields, background particles, and a custom cursor.
- The resource system contradicts the homepage by returning to missed calls, lead recovery, booking, and memory.
- Trust copy contains claim/heading mismatches.
- Root documentation and some metadata are stale, including old inbound-call positioning, old action/plugin counts, duplicated title suffixes, and legacy structured data.
- The site asks a visitor to understand architecture by reading. It does not make context assembly, plan formation, approval, execution, surface change, recovery, or evidence visible.

## Positioning territories

Scores are 1–10. Accuracy measures fidelity to executable product truth. Desire measures the buyer's felt value. Differentiation measures separation from voice AI, chatbots, CRMs, workflow builders, and generic agent platforms.

| Territory | Story | Accuracy | Desire | Differentiation | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| **From intent to verified change** | FINNOR is the governed execution system that turns one instruction into approved, proven operational change. | 9.8 | 9.5 | 9.7 | **29.0** |
| **One live operating picture** | FINNOR is the control plane that lets an owner see and direct Customers, Work, Schedule, Money, and Agents as one operation. | 9.4 | 9.6 | 9.0 | **28.0** |
| **AI with a chain of command** | FINNOR is the accountable operator: it can act broadly, but authority, recovery, and proof are built into every consequential step. | 9.6 | 9.0 | 9.8 | **28.4** |

### Selected territory: From intent to verified change

This territory wins because it maps directly to the code path and produces the strongest single story. It can absorb the best parts of the other two territories without becoming either a dashboard pitch or a safety pitch:

- “One live operating picture” becomes the visible consequence: Customers, Work, Schedule, Money, and Agents change together.
- “AI with a chain of command” becomes the governing mechanism: policies, approvals, roles, recovery, and receipts.

## Homepage story

The homepage will follow one representative, explicitly synthetic but contract-grounded scenario:

> Get the Peterson installation unstuck. Rebook it for Thursday, assign Marcus, reserve the system, notify the customer, and prepare the remaining invoice. Hold customer contact and money for approval.

This instruction is narratively richer than a missed-call or single-booking example and maps to registered action families for rescheduling, technician assignment, inventory, customer communication, and accounting.

### Chapter progression

1. **Complexity:** a water treatment company is shown as relationships among customer, equipment, job, technician, schedule, stock, invoice, policies, messages, and provider systems—not as a row of app logos.
2. **Instruction:** the operator states the outcome in plain language through JARVIS.
3. **Context assembly:** exact records, operating policy, availability, equipment, customer history, balance, and permissions converge around the instruction.
4. **Plan:** JARVIS produces an ordered, dependency-aware plan and names what is known, unknown, and blocked.
5. **Approval:** customer contact and money pause at visible authority boundaries; operational reads and permitted preparation continue.
6. **Activation:** the workflow runtime and bounded agent channels execute the approved steps across native records and connected bindings.
7. **Operational change:** Customers, Work, Schedule, and Money visibly update as four views of the same causal event.
8. **Recovery:** a provider failure is shown as a first-class state with retry, compensation, reconciliation, and human escalation—not as a broken spinner.
9. **Evidence:** the receipt proves what was proposed, approved, attempted, changed, recovered, and left incomplete.
10. **Outcome:** the installation is no longer a loose collection of tasks; it is one governed, inspectable outcome.

## Claim boundaries for the rebuild

### Safe to claim

- FINNOR accepts typed and voice instructions.
- JARVIS assembles tenant-scoped operational context, plans against registered capabilities, and exposes the plan.
- Consequential actions can be held for role- and risk-based approval.
- The source supports 44 registered action contracts across 24 domain plugins.
- The runtime supports durable workflows, idempotency, retry, dead-letter handling, compensation, reconciliation, run controls, and receipts.
- The product exposes Home, Work, Customers, Schedule, Money, and Agents surfaces.
- Current source and local evidence demonstrate a complete schedule-water-test command chain through approval, execution, Work, Household, Schedule, Agent attribution, and receipt.
- External bindings report configured/healthy/unavailable separately and the UI avoids inventing missing records.

### Must be qualified

- “Connected systems” means native and configured provider bindings; not every listed provider is currently live.
- Agent channels are bounded operating channels; provider configuration and assistant verification are separate facts.
- Multi-step example choreography is representative and contract-grounded, not a claim that a named real customer experienced it.
- Production compliance, data handling, retention, and vendor obligations depend on the deployed stack and signed terms.
- Automatic execution is policy-dependent; the source is not “approve everything” and not “nothing ever runs without approval.”

### Do not claim

- Every external integration is live or certified in production.
- JARVIS replaces the dealer's CRM, field service, accounting, or communication system.
- Fully autonomous, unsupervised operation.
- Guaranteed revenue, response, booking, route, or collections outcomes.
- Provider success when only a native/sandbox carrier hop or adapter contract is proven.

## Art-direction decision

The page should feel like an industrial control narrative built for the physical world of water treatment, not a space-themed AI product.

- Use a mineral-paper field, carbon typography, one process-blue accent, one safety-orange authority accent, and verified green only for completed evidence.
- Let the actual dark JARVIS UI appear as precise instrument surfaces inside the brighter editorial world.
- Use a persistent Three.js operational topology that changes meaning by chapter: fragmented dependencies, assembled context, executable graph, authority gates, activated lanes, and verified final state.
- Use GSAP pinning and scrubbing for chapter progression, plan construction, approval gates, and the four operational surface changes.
- Use Motion for local interaction and state transitions, not competing page-level scroll systems.
- Consider one CanvasUI-derived particle assembly only at the context threshold, with a static fallback and reduced-motion path; no site-wide effect layer.
- Preserve the live site's cursor-reactive network and product-presence cues as quiet connective tissue, while making the JARVIS sphere, command surface, operational topology, approvals, agents, and receipts carry specific narrative meaning. Avoid decorative glow fields and the feature-card cemetery.
- Keep the hero heading to two lines on desktop and no more than three on narrow mobile.
- Treat empty space as pacing, not as decoration. Each chapter must introduce a new spatial relationship, not repeat a left-copy/right-card layout.

## Acceptance criteria

- The old “voice-native AI operations” category is absent from primary metadata and homepage positioning.
- The homepage tells the full causal sequence without requiring a feature list to explain the product.
- Real JARVIS UI is the dominant proof asset across multiple chapters.
- Customers, Work, Schedule, Money, and Agents are shown as connected outcomes of one instruction.
- Approval, recovery, and evidence are visible mechanics, not trust-card claims.
- All public marketing routes share the new category, art direction, navigation, typography, and claim boundaries.
- Demo routes remain functional and are reframed as proof routes rather than the product definition.
- JARVIS product routes keep their authenticated behavior and current source-bound truth.
- Desktop, tablet, mobile, reduced-motion, keyboard, and no-WebGL fallbacks are verified.
- Performance testing includes bundle/build output, cold load, layout shift, console/runtime errors, and a real browser pass at major breakpoints.
