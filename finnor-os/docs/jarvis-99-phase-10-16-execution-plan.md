# Phases 10–16 Execution Plan (companion to jarvis-99-roadmap.md)

**Scope note:** Phases 1–9 are built and verified (7–9 confirmed as-built:
`packages/orchestration/src/repair.ts`, `tiering.ts`, `packages/memory/src/patterns.ts`
and their three integration test files all exist; `planner.ts` is now 437 lines with
tier branching and pattern wiring live). This document is the execution plan for
Phases 10–16 — the rest of the roadmap.

**How this document was written:** every file each phase touches was read in full
first — all six console pages, the entire LangGraph `graph/` directory, the scheduler
and all five scan handlers, the full Vapi webhook route and voice-os package, every
capability contract and emulator, `run-workflow-step.ts`'s binding table, the security
package, both hardening docs, and the as-built Phase 7–9 modules. Where the roadmap's
prose and the code disagree, the code won, and the discrepancy is called out. The
target reader is a low/medium-reasoning-effort execution pass with no room to
improvise architecture — every judgment call that matters is made here.

**How to use:** paste `jarvis-99-roadmap.md`'s `SHARED CONTEXT` block into a fresh
session, then ONE phase's `EXECUTION PROMPT` block from this document (not the
roadmap's shorter one). Do phases in the order given at the bottom. After each phase
passes its verify bar, **commit** before starting the next — Phases 1–6 sat uncommitted
for days and that must not repeat.

**Verification bar for every phase** (unchanged from Phases 1–9 — do not relax):
1. `npx tsc -p tsconfig.json` clean.
2. Full suite (`node --env-file=.env node_modules/.bin/vitest run` from `finnor-os/`)
   green, twice consecutively, real Postgres, no mocks (except the established
   stub-global-fetch seam for external HTTP providers).
3. New capability/integration → real conformance/integration test.
4. Honest written note: what's real vs. simplified. No completeness claims beyond what
   actually ran.

---

## Read this before writing any code — cross-phase ground truth

Fifteen facts about the *current* code, each found by reading the actual files. Three
of them (§2, §6, §9) are landmines that would silently zero out a phase's value if
missed.

**1. The console really is 6 pages, ~580 lines, inline styles, zero dependencies
beyond React/Next/Vapi-web.** Confirmed: `apps/console/app/` holds `layout.tsx` (45),
`page.tsx` (74), `confirm/page.tsx` (131), `audit/page.tsx` (74), `policy/page.tsx`
(80), `comms/page.tsx` (63), `talk/page.tsx` (91), plus `lib/api.ts` (24).
`package.json` deps: next 14, react 18, `@vapi-ai/web`, two workspace type packages.
No Tailwind, no framer-motion, no state library, no CSS files at all — the only
"design system" is a `<style>` tag in `layout.tsx` defining `.card`, `.toast`,
`.pulse`, and button transitions. Data flow: every page polls with
`setInterval(load, 6000–8000)` against `lib/api.ts`'s `api<T>()` helper, which sends
dev-bypass headers (`x-tenant-id`, `x-user-role`) absent a stored token.

**2. No API route exposes `workflow_runs`/`workflow_steps` or `business_events`
today.** The full route list is: actions (list/pending/confirm/reject), admin/migrate,
audit, comms, health, insights, integrations/status, policies, price-book,
read-models/[view], resources/[kind], setup/status, stats, webhooks (ghl, marketing,
payment, vapi). `resources/[kind]`'s `workflows` kind serves **`workflow_states`**
(the 2-workflow business-stage tracker), NOT the durable runtime's
`workflow_runs`/`workflow_steps`. Phase 10's "live view of in-flight runs" and "event
timeline" therefore need **two new API routes** — the UI cannot be built against
endpoints that don't exist.

**3. The confirm/reject flow that must not regress, precisely:** `confirm/page.tsx`
POSTs `/api/actions/:id/confirm` or `/reject` with optimistic card slide-out
(350ms), an `inflight` ref that excludes mid-decision cards from the 6s poll merge,
and `load()` rollback on server error. Both routes enforce RBAC via `canApprove()`
before deciding. The queue reads `/api/actions/pending?filter=pending|blocked`.

**4. RBAC is enforced, in exactly one place.** `apps/api/lib/auth.ts`'s
`canApprove(ctx, actionType)` — raw SQL against `role_permissions` with a wildcard
`action_type='*'` row convention and a fail-safe default (`no rows → owner only`) —
is called from both the confirm and reject routes. Nothing seeds `role_permissions`,
and nothing else reads it. Phase 16's RBAC review has a real enforcement point and a
real gap (no seeds, no dispatcher/technician coverage tests).

**5. Observability outside the LLM path is nearly zero.** Sentry appears in exactly
four files: `apps/api/lib/auth.ts` (errorResponse capture), `packages/tools/src/`
`observability.ts`, `llm.ts` (per-LLM-call breadcrumbs), `registry.ts` (per-tool-call
breadcrumbs). The worker (`apps/worker/src/queue.ts`, all handlers) and the Temporal
worker have **no Sentry init and no breadcrumbs at all** — a worker crash today is
`console.error` or nothing. Phase 16's tracing work starts from that reality.

**6. Vapi webhook: zod strips the fields Phase 14 needs — and probably one it needs
today.** `VapiWebhookSchema` (`packages/policy-schema/src/index.ts:74-83`) declares
`call: z.object({ id: z.string() }).partial().optional()` **without `.passthrough()`**.
Zod's default is to STRIP unknown keys, so everything inside `call` except `id` —
including `customer.number` (used at `webhooks/vapi/route.ts:143` for caller identity)
and `phoneNumberId` (which Phase 14 needs for tenant routing) — is deleted at parse
time. The route's `callMeta?.customer?.number` read is therefore very likely always
`undefined` in the tool-calls path — meaning caller-identity resolution silently never
resolves and every `finnor_instruct` gets the "can't verify this line" handoff. This
went unnoticed because prod's `tenants.owner_phone` is still a placeholder. **Phase 14
step 0 fixes and regression-tests this before building anything on top.**

**7. LangGraph expansion is config + proof, not new nodes.** The allowlist is the env
var `ORCHESTRATION_ENGINE_GRAPH_ACTION_TYPES` (comma-separated), parsed in
`graph/allowlist-executor.ts:11-19`; `AllowlistExecutor.resolve()` routes per
action_type to `LangGraphExecutor` or the legacy `GatedExecutor`. The graph's seven
nodes (`validate → draftAction → gate → pause(interrupt) → execute | failed |
rejected`) are **action-type agnostic** — they call `plugins.resolve(actionType)`
generically. Adding the four vertical-workflow action types requires zero new nodes.
Checkpoints: `PostgresSaver` on the shared pool, `finnor_langgraph` schema, created by
`npm run setup:langgraph` (never on cold start). One caveat: `LangGraphExecutor.execute`
resumes with `Command({resume:"approve"})` whenever the thread is paused — the
approve/reject distinction on resume comes from `runAction` only being called after
`decide()` flips status, plus `close()` sending `resume:"reject"`.

**8. For workflow action types, LangGraph wraps only the GATE, not the workflow.**
`start_*_workflow` plugins' `execute()` bodies just call `submitCommand()` +
`enqueueStep()` into `@finnor/workflow-runtime` — the durable multi-step machinery
(leases, outbox, reconciliation) lives there and stays untouched. What the graph path
adds for these types is checkpointed validate→draft→pause→execute state for the
*gating* of the submission. The Phase 13 restart-proof must therefore prove: process
killed while paused at the gate → restart → resume → `submitCommand` fires exactly
once (its own `idempotencyKey` making the double-fire check meaningful).

**9. "Recent error rates per provider from Sentry breadcrumbs" is not buildable as
written.** `withObservability()` (`packages/tools/src/llm.ts:199-216`) sends
breadcrumbs TO Sentry; nothing anywhere reads them back, and Sentry's ingest is not a
queryable local store. Phase 13's provider selection must build its own small
in-process health tracker (per-provider sliding window of ok/fail/latency) — same
information, honestly sourced. The roadmap's phrasing overpromised; this plan corrects
it.

**10. The binding-selection pattern Phase 15 must copy is in
`apps/worker/src/handlers/run-workflow-step.ts:53-114`** — per-domain env-var switch
functions (`SCHEDULING_BINDING`, `COMMUNICATIONS_BINDING`, `DOCUMENTS_BINDING`,
`INVENTORY_BINDING`, `ACCOUNTING_BINDING`, `CRM_BINDING`, `MARKETING_BINDING`)
feeding a `STEP_HANDLERS` registry. The two Phase 15 seams are explicit hardcodes
today: `request_signature` (line 144) and `create_payment_link` (line 161) both pin
`() => …EmulatorBinding`. A `CapabilityBinding` is `{name, call(input),
reconcile?, compensate?}`; contracts carry
`idempotencyKeyFrom/retryPolicy/requiredPermission/piiAllowlist/retryOnUnknown`.
Emulator output shapes to match: `create_payment_link → {paymentLinkUrl, linkId}`,
`request_signature → {signatureRequestId, status:"sent"}`.

**11. The inbound halves of Phase 15 already exist as provider-agnostic appliers.**
`POST /api/webhooks/payment` validates a generic `{tenantId, invoiceId,
providerEventId, amountUsd, status}` shape and calls `applyPaymentWebhookEvent()`
(invoice-to-cash plugin) — dedup via `webhook_receipts` + `inbox_events` both. For
e-signature, `applySignatureOutcome()` (proposal-signature plugin) exists but has NO
webhook route — tests invoke it directly. Phase 15 adds real-provider signature
verification in front of the payment route and a new `/api/webhooks/esign` route in
front of `applySignatureOutcome`.

**12. Phase 7–9 as-built seams Phase 12 wires into:**
`classifyReasoningTier({requiresConfirmation, compiledGraph, payload,
amountThresholdUsd?})` returns `"low"|"medium"|"high"` (tiering.ts:19-30);
`scoreCandidate({actionType, groundedPayload, patternScore?})` (tiering.ts:39-44);
`buildPatternContext(tenantId, householdId?)` returns `{householdProposals,
technicianReliability}` (patterns.ts:111-116), assembled into
`MemorySnapshot.patterns` by `buildMemorySnapshot` and serialized into the planner's
`user` JSON at planner.ts:99. Extending pattern context = extending `PatternContext`
in shared-types + `buildPatternContext` + (if the planner should react) planner.ts.

**13. Scan-system ground truth.** Scheduler: 15-min ticker, per-(scan, tenant,
time-bucket) idempotency key `scan:<type>:<tenant>:<bucket>` via `enqueueJob`'s
`ON CONFLICT DO NOTHING` — self-healing, race-free (scheduler.ts). Who drafts vs. who
only logs: `scan_cold_leads` drafts `bulk_notify_existing_customers` **only when**
`domain_policies…policy.winback_offer_script` is configured, else writes a
`scan_findings` row — this config-gated pattern is the template. `scheduled_reminder`
drafts `renew_maintenance_agreement`. `scan_low_inventory` and `scan_service_due` only
write findings. `scan_appointment_no_shows` mutates directly (status flip + business
event + task — deterministic closure, not gated). `scan_data_quality` writes
`data_quality_findings` (its own open/resolved lifecycle). **`scan_findings` columns:
id, tenant_id, scan_type, summary, details jsonb, created_at, digested_at — no
severity, no status, no link to any drafted action.** `owner_digest` reads undigested
rows, one call/day max, marks all digested; already consumes
`followUpDebt`/`cashCollections`/`slaBreaches` read-models.

**14. Memory-layer ground truth for Phase 11.** `long-term.ts`'s
`readHouseholdMemory()` reads ONLY pre-canonical tables (households, equipment,
service_visits, maintenance_agreements, communications_log) — the entire Phase 1
canonical layer (contacts, contact_methods, leads, opportunities, quotes, invoices,
payments, work_orders, appointments, conversations, messages, documents,
business_events) is invisible to it. Also: `planner.ts` serializes `shortTerm`,
`semantic`, `recentEpisodes`, `patterns` into the LLM prompt but **not `longTerm`** —
a pre-existing, known gap (flagged in the 7–9 plan). Phase 11's traversal is a
read-model + API + console surface, NOT a planner-prompt change — do not "fix" the
longTerm gap as a side effect (token-budget blast radius; it stays a named non-goal).
`business_events` has exactly the two indexes traversal needs:
`(tenant_id, entity_type, entity_id)` and `(tenant_id, event_type, occurred_at)`.

**15. Housekeeping constants.** Tenant UUIDs `…00–02, aa, ab, cd, d1–d4, e1, f1–fb`
are taken; this plan assigns `…fc` (P11), `…fd` (P12), `…fe` (P13), `…e2`+`…e3`
(P14, two tenants), `…e4` (P15). Next migration number is **0012**; after adding any
migration run `npm run db:bundle` (regenerates `packages/db/migrations-bundle.ts`) —
forgetting this breaks the deployed `/api/admin/migrate` path. New shared-types fields
ride the existing package; no new packages are needed in any phase except none at all
— every phase below extends existing packages.

---

## PHASE 10 — Frontend Mission Control

### Decisions made here so the executor doesn't improvise

- **Zero new npm dependencies.** No Tailwind, no framer-motion, no cmdk. The design
  system is CSS custom properties + a real global stylesheet; motion is CSS
  transitions/keyframes (the codebase already does this well in `layout.tsx`); the
  command palette is a hand-rolled overlay (~120 lines). Rationale: a low-effort
  executor integrating a CSS framework into a no-framework Next 14 app has far more
  failure surface than writing plain CSS, and every existing page already works
  inline-styled — the migration is mechanical.
- **Keep the polling architecture.** No SSE/websockets. Tighten the mission-control
  poll to 4s. The durable runtime advances via a 2s worker poll anyway — sub-second
  push adds infra for no perceptible gain.
- **Preserve, don't rewrite, the five working flows** (confirm/reject optimistic
  queue, policy load/save, audit filter, comms list, talk mic session). They get
  restyled and enriched, but every existing API call, optimistic-update behavior, and
  error path stays semantically identical.

### Step 1 — two new API routes (data before UI)

**`apps/api/app/api/workflows/runs/route.ts`** — GET, `requireContext`, returns
in-flight + recent runs with their steps:

```ts
// Response shape:
// { runs: Array<{ id, workflowType, status, createdAt, updatedAt,
//     steps: Array<{ id, stepType, sequence, status, attempts, terminalReason, updatedAt }> }> }
```

Query: `workflow_runs` for the tenant, `status='running'` first then latest 20
terminal, join `workflow_steps` ordered by `sequence` (one query each, zip in JS —
mirror how `read-models/index.ts` composes multi-query results). Support
`?status=running` filter.

**`apps/api/app/api/events/route.ts`** — GET, `requireContext`, the business_events
timeline: latest 50, optional `?entityType=&entityId=` pair (uses the
`business_events_entity_idx` index) and `?before=<iso>` cursor for paging. Response
`{ events: [{ id, entityType, entityId, eventType, payload, occurredAt, source }] }`.

Both are read-only selects inside `withTenant` — copy the auth/error pattern from
`read-models/[view]/route.ts` verbatim (requireContext → work → `errorResponse(err)`).

### Step 2 — design tokens + global stylesheet

New file `apps/console/app/globals.css`, imported from `layout.tsx` (delete the
inline `<style>` block — its rules move here). Token set as CSS custom properties on
`:root` (dark, the default) and `[data-theme="light"]`:

```css
:root {
  --bg: #0b1220; --bg-raised: #101a30; --bg-overlay: #14243f;
  --border: #1e2a44; --border-hover: #2b3d63;
  --text: #e7ecf5; --text-muted: #9fb0cc; --text-faint: #7f92b5;
  --accent: #8fb4ff; --success: #9dffb0; --success-strong: #1d7a46;
  --warn: #ffd479; --danger: #ff9d9d; --danger-strong: #7a1d2b;
  --radius: 12px; --radius-sm: 8px;
  --space-1: 4px; --space-2: 8px; --space-3: 14px; --space-4: 18px; --space-5: 24px;
  --dur-fast: .15s; --dur-med: .3s; --dur-slow: .5s;
  --font-size-xs: 12px; --font-size-sm: 13px; --font-size-md: 14px;
  --font-size-lg: 16px; --font-size-xl: 22px; --font-size-stat: 34px;
}
```

Light theme derives the same slots (`--bg:#f5f7fb; --bg-raised:#fff; --text:#101a30;`
etc.). Theme toggle: a nav button stamping `data-theme` on `<html>` + persisting to
`localStorage("finnor_theme")`, read in a tiny inline script in `layout.tsx` head to
avoid flash. All component classes (`.card`, `.btn`, `.btn-approve`, `.btn-danger`,
`.toast`, `.tile`, `.badge`, `.table`, form controls) live in this file referencing
only tokens. **Definition of done for the token system: zero hex colors remain in any
`.tsx` file under `apps/console/`** — greppable (`grep -rn "#[0-9a-f]\{3,6\}"
apps/console/app`), so the executor can verify mechanically.

Motion (CSS only): card enter (existing `cardIn`), card leave (existing `.leaving`),
step-transition pulse on workflow step status change (a `@keyframes stepFlash`
triggered by keying the element on `status`), palette fade/scale-in, respects
`@media (prefers-reduced-motion: reduce)` (disable all non-essential animation).

### Step 3 — layout, navigation, command palette

Rewrite `layout.tsx`: sticky nav (tokens, active-route highlight via
`usePathname()` in a small client `<Nav/>` component), main container widened to
1200px for the dashboard grid, palette mounted globally.

`apps/console/components/CommandPalette.tsx` (new, client): opens on `⌘K`/`ctrl+K`,
closes on Escape/backdrop; fuzzy-filters a static command list — the 6 page
navigations plus "Approve queue → pending", "Approve queue → blocked", "Toggle
theme"; arrow keys + Enter; `role="dialog"` + focus trap. No action-execution
commands in v1 (approving from a palette without seeing the card would weaken the
gate's "human actually read it" property — deliberate non-goal, note it in code).

### Step 4 — Mission Control home (`app/page.tsx` rewrite)

Grid of real panels, all real data, 4s poll via a shared `usePoll(fn, ms)` hook
(new `apps/console/lib/use-poll.ts` — extracts the repeated
`useCallback+useEffect+setInterval` pattern the pages currently copy-paste):

1. **Stat row** — pending, blocked, messages produced (existing three) + open
   reconciliation cases and stuck runs from `/api/read-models/sla-breaches`.
2. **In-flight workflows panel** — `/api/workflows/runs?status=running`: each run a
   card with workflowType, age, and a horizontal step tracker (dots colored by step
   status: pending=faint, leased=pulse, completed=success, failed=danger,
   compensating/compensated=warn) — this is Phase 2's durable runtime made visible.
3. **Event timeline panel** — `/api/events` latest 20, icon by eventType prefix
   (quote_*, appointment_*, work_order_*, contact_*, payment…), relative timestamps.
4. **Read-models strip** — pipeline health (lead/quote/proposal status counts as
   segmented bars), stock risk (belowThreshold list), cash collections (overdue $
   prominent), follow-up debt count, data-quality unresolved count. One fetch per
   view against `/api/read-models/:view`; each panel renders independently and shows
   a quiet placeholder on individual fetch failure (never blank the whole page —
   same "stats are cosmetic" resilience `page.tsx` already practices).

**Reasoning display rule (roadmap non-goal, enforce):** wherever an action appears,
show only stored fields (`summary`, and `DomainAction.reasoning` if the API exposes
it) — never generate or paraphrase "AI thoughts" client-side.

### Step 5 — page restyles (no behavior change)

`confirm/page.tsx`: keep every line of state logic (optimistic slide, inflight ref,
rollback-on-error, toasts); restyle with tokens; add per-card `groundedPayload`
badges if present on the pending payload (`verified`=success, `not_found`=danger,
`unverifiable`=muted) — the API's pending route already returns full rows.
`audit/page.tsx`: token table styles, `overflow-x:auto` wrapper. `policy`, `comms`,
`talk`: token migration only. Every page: responsive — the dashboard grid collapses
to one column under 720px, nav becomes horizontally scrollable, stat tiles wrap;
verify at 375px width.

### Non-goals

No auth UI, no websockets, no charting library (segmented bars are divs), no
customer-360 page (that's Phase 11's data — roadmap explicitly forbids UI for data
that doesn't exist yet), no palette-driven approvals.

### Verify

This phase is frontend: **drive it in a real browser, don't just read component
code.** Create `.claude/launch.json` entries if absent (api on :3100
`npm run dev:api`, console on :3101 `npm run dev:console`; embedded Postgres must be
up via `npx tsx scripts/dev-db.ts`, seeded). Then: load `/`, confirm all four panels
render real data (seed tenant has rows); walk the confirm/reject flow end-to-end
(draft an action via `POST /api/actions` or a scan, approve it in the UI, watch the
optimistic slide + toast, verify status in DB); load every other page; toggle theme;
open palette and navigate; resize to 375px and re-check `/` and `/confirm`;
screenshot proof. Plus the standard bar: typecheck + full suite twice (the two new
API routes get an integration test each — seed rows, call route handlers' `GET`
directly with a dev-bypass Request, assert shapes; tenant can reuse the seed tenant
per existing route-test precedent, or `…fc` if isolation is needed).

### EXECUTION PROMPT (paste after SHARED CONTEXT)

```
/goal Implement Phase 10 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 10" section — read that section fully first, then read every file in
apps/console/app/ (it's ~580 lines total) before changing anything. Order of work is
fixed: (1) the two new API routes (workflows/runs, events) with integration tests —
ground truth fact §2 in the doc explains why the UI cannot come first; (2) globals.css
token system + layout/nav/palette; (3) mission-control home rewrite; (4) restyle the
five existing pages WITHOUT changing their behavior — the confirm page's optimistic
logic (inflight ref, rollback, toasts) must survive verbatim. Zero new npm
dependencies — the doc explains why. Definition of done includes: grep finds no hex
colors left in apps/console/app/*.tsx, and you actually drove every page in the
browser (dev servers via .claude/launch.json + embedded Postgres) including the full
confirm/reject round trip and a 375px-width pass, with screenshots. Then the standard
verify bar: typecheck clean, full suite green twice, real Postgres. Commit when green.
```

---

## PHASE 11 — Memory Depth Extension

### What this actually is

One new read-model — `household360` — that traverses everything connected to a
household across BOTH table generations (pre-canonical: equipment, service_visits,
maintenance_agreements, communications_log; canonical: contacts+contact_methods,
leads, opportunities, quotes, invoices+payments, work_orders, appointments,
conversations+messages, documents, plus the business_events timeline), exposed via
the read-models API, surfaced as a console Customer-360 view, and measured for
performance before anyone utters "graph database."

### Step 1 — the traversal read-model

Extend `packages/read-models/src/index.ts` (same file — it's the established home;
269 lines today, this adds ~120):

```ts
export interface Household360 {
  household: { id: string; address: string; contactInfo: Record<string, unknown>; marketingConsent: boolean; createdAt: string };
  contacts: Array<{ id: string; name: string; role: string | null; methods: Array<{ methodType: string; value: string; consent: boolean }> }>;
  equipment: Array<{ id: string; type: string; model: string | null; installDate: string | null; source: string }>;
  leads: Array<{ id: string; name: string; status: string; source: string | null; createdAt: string }>;
  opportunities: Array<{ id: string; pipelineStage: string; expectedValueUsd: number | null; createdAt: string }>;
  quotes: Array<{ id: string; status: string; totalUsd: number | null; createdAt: string }>;
  invoices: Array<{ id: string; status: string; amountUsd: number; dueDate: string | null; payments: Array<{ amountUsd: number; method: string; status: string; receivedAt: string }> }>;
  workOrders: Array<{ id: string; type: string; status: string; technicianId: string | null; scheduledAt: string | null; completedAt: string | null }>;
  serviceVisits: Array<{ id: string; type: string; technicianId: string | null; scheduledAt: string | null; completedAt: string | null }>;
  appointments: Array<{ id: string; subjectType: string; status: string; scheduledAt: string; technicianId: string | null }>;
  conversations: Array<{ id: string; channel: string; status: string; lastActivityAt: string; messageCount: number }>;
  documents: Array<{ id: string; kind: string; title: string; createdAt: string }>;
  timeline: Array<{ entityType: string; entityId: string; eventType: string; occurredAt: string; payload: Record<string, unknown> }>;
  queryMs: number;
}

export async function household360(tenantId: string, householdId: string): Promise<Household360 | null>
```

Implementation notes the executor must follow:
- One `withTenant` scope, all sub-queries `Promise.all`'d — 12 parallel indexed
  selects, not a 12-way join.
- **Appointments are polymorphic** (`subjectType`/`subjectId`, no householdId): match
  `subjectType='household' AND subjectId=:hh` **UNION** appointments whose subject is
  one of this household's leads or work orders (collect those ids first — this makes
  it a two-stage traversal: direct children, then children-of-children; do leads +
  work_orders in stage 1, appointments in stage 2).
- **Timeline**: `business_events` where `(entityType,entityId)` ∈ the union of all
  collected ids (household itself, leads, quotes, work_orders, invoices,
  opportunities, appointments, contacts) — batched `inArray` per entityType (uses the
  entity index), merged and sorted desc in JS, capped 100.
- `communications_log` (pre-canonical) folds into `conversations` count? No — keep
  honest: expose it as part of `conversations` only if a conversations row exists;
  otherwise surface raw `communicationsLog` entries as a 13th array
  `legacyCommunications` — do not pretend the two generations are unified when
  they're linked by nothing but householdId.
- `queryMs`: `performance.now()` wall-clock for the whole function — this is Phase
  11's built-in performance measurement (roadmap: graph DB only if relational is
  *measured* insufficient). Log a warning above 500ms.

### Step 2 — expose it

`read-models/[view]/route.ts`: the `VIEWS` map's functions are all
`(tenantId) => …` — `household360` needs a param. Change the map's value type to
`(tenantId: string, searchParams: URLSearchParams) => Promise<unknown>` (existing
entries ignore the second arg — mechanical), add
`"household-360": (t, sp) => { const hh = sp.get("householdId"); if (!hh) throw new
AuthError("householdId query param required", 400); return household360(t, hh); }`,
and pass `new URL(req.url).searchParams` through. 404 stays for unknown views;
`household360` returning null → `Response.json({error:"No such household"},{status:404})`.

### Step 3 — planner context (bounded)

Per ground-truth §14, do NOT dump this into the LLM prompt. The bounded change:
`readHouseholdMemory()` (`packages/memory/src/long-term.ts`) gains a compact
`canonicalSummary` field — counts and most-recent-status only (`{openLeads: 2,
openQuotes: 1, unpaidInvoicesUsd: 450, lastWorkOrder: {type, status}, openTasks: 3}`),
~10 lines of aggregation reusing the same queries' count forms. That keeps
`longTerm` cheap enough that a LATER phase can safely start serializing it; actually
serializing `longTerm` into the prompt stays out of scope (named non-goal, same as
the 7–9 plan).

### Step 4 — console Customer 360 (small, additive)

`apps/console/app/customers/page.tsx` (new): household list (existing
`/api/resources/households`), click → `/api/read-models/household-360?householdId=…`
rendered as: header card (address, consent badge, contacts+methods), a stat strip
(open leads/quotes/unpaid $/work orders), and the merged timeline (reuse Phase 10's
timeline panel component — extract it to `components/Timeline.tsx` when this phase
touches it). Add "Customers" to nav + palette. Token styles only.

### Non-goals

No graph database (unless `queryMs` measured against the seeded ~110-household
dataset says otherwise — record the actual number in the phase report). No
opportunity-lifecycle second traversal (household→everything subsumes the useful
part; note this decision). No planner prompt expansion.

### Verify

Integration test `tests/integration/household-360.test.ts`, tenant `…fc`: seed one
household with 2 contacts (3 methods), 1 lead, 1 opportunity, 1 quote, 1 invoice + 1
payment, 1 work order, 1 appointment (subject=work order — proves the two-stage
traversal), 1 conversation + 2 messages, 1 document, plus business events; assert
every array's contents and that the appointment found via the work-order hop is
present; assert a *second* household's rows never leak in (seed a decoy); assert
`queryMs` present. FK-ordered cleanup. Route param test (400 without householdId).
Browser-verify the customers page renders the seeded fixture. Standard bar. Commit.

### EXECUTION PROMPT

```
/goal Implement Phase 11 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 11" section. Read packages/read-models/src/index.ts and
packages/memory/src/long-term.ts first. Build the household360 read-model exactly as
specced — note the two schema gotchas: appointments are polymorphic
(subjectType/subjectId, requiring the two-stage traversal the doc describes) and the
pre-canonical communications_log is NOT unified with canonical conversations (surface
it as legacyCommunications, never pretend they're one system). Extend the
read-models route to support query params as specced. Measure and record queryMs —
no graph database, this phase's own measurement is the evidence either way. Add the
console /customers page (tokens from Phase 10, additive, reuse the Timeline
component). Integration test with tenant 00000000-0000-4000-8000-0000000000fc
covering the traversal, the work-order-hop appointment, and a cross-household leak
check. Standard verify bar, browser-check the new page, commit when green.
```

---

## PHASE 12 — Autonomous Loop Closure

### What closes the loop, concretely

Scan findings currently dead-end in a daily digest line. After this phase: (a) open
findings appear in the planner's pattern context so drafts are informed by them,
(b) high-severity findings raise the reasoning tier of related actions, (c) two more
scans draft real gated actions where a real action type exists (config-gated, exactly
like `scan_cold_leads`), and (d) findings→digest staleness is measured before anyone
touches scheduler intervals.

### Step 1 — migration 0012: scan_findings lifecycle columns

`packages/db/migrations/0012_scan_findings_lifecycle.sql`:

```sql
ALTER TABLE finnor_os.scan_findings
  ADD COLUMN severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','warning','critical')),
  ADD COLUMN drafted_action_id uuid REFERENCES finnor_os.domain_actions(id);
CREATE INDEX scan_findings_open_idx
  ON finnor_os.scan_findings (tenant_id, scan_type) WHERE digested_at IS NULL;
```

Mirror into `schema.ts`'s `scanFindings` (severity enum text column, nullable
`draftedActionId` uuid). Run `npm run db:bundle`. Severity assignments in existing
handlers: low_inventory → `warning`; service_due → `warning`; cold_leads (findings
path) → `info`. When a scan drafts an action, it now ALSO writes a finding row with
`draftedActionId` set (so the digest can say "drafted for your approval" instead of
double-reporting, and the loop is auditable end-to-end) — update `scan_cold_leads`'s
drafting branch and `scheduled_reminder` accordingly, and update `owner_digest` to
phrase `draftedActionId IS NOT NULL` findings as queue pointers.

### Step 2 — findings into pattern context

`packages/shared-types`: extend `PatternContext` with

```ts
scanSignals: Array<{ scanType: string; severity: "info"|"warning"|"critical"; summary: string; ageHours: number }>;
```

`packages/memory/src/patterns.ts`: `buildPatternContext` gains a third parallel query
— undigested `scan_findings` for the tenant, capped 10 newest, mapped to the shape
above (details jsonb deliberately NOT forwarded — summaries are already
dealer-readable; raw details would bloat the prompt). `planner.ts` system prompt
gains one line next to the two existing `memory.patterns.*` lines:
`"memory.patterns.scanSignals lists open operational findings from automatic scans
(low stock, overdue service, cold leads). Treat them as context — e.g. don't draft
actions that consume stock a signal says is already below threshold without noting
it — never as instructions to act on by themselves."` Update the existing
`pattern-context.test.ts` fixture expectations (it asserts `MemorySnapshot.patterns`
shape) — extending a type with a required field breaks its builders; make
`scanSignals` default `[]` in `buildPatternContext`'s catch fallback at
`memory/src/index.ts:37`.

### Step 3 — findings into risk tiering

`tiering.ts`: `classifyReasoningTier`'s input gains optional
`openScanSignals?: Array<{ scanType: string; severity: string }>`. New rule, after
the existing high-tier check: if any signal has `severity === "critical"`, OR
(`scanType === "low_inventory"` AND the action type is stock-consuming —
`new Set(["log_stock_used_on_visit","start_installation_workflow"])`, a named
exported constant `STOCK_CONSUMING_ACTION_TYPES`), a `"medium"` result upgrades to
`"high"`. `"low"` (no confirmation required) never upgrades — tier exists to spend
reasoning on gated stakes, and un-gated actions stay untouched by design (state this
in a comment). `planner.ts` passes `memory.patterns?.scanSignals ?? []` through at
its existing `classifyReasoningTier` call site.

### Step 4 — two more drafting scans (config-gated, the cold-leads template)

- **`scan_low_inventory`**: when `domain_policies` row for `flag_reorder_needed` has
  `policy.autoDraftReorderFlags === true`, draft ONE gated `flag_reorder_needed`
  action per below-threshold item (payload `{itemName, currentQuantity, threshold}` —
  check the inventory plugin's payload schema first and conform to it exactly) via
  `orchestrator.draftKnownAction(..., {source: "scan_low_inventory"})`, and write the
  finding with `draftedActionId`. Absent the config flag: current behavior, unchanged.
- **`scan_service_due`**: when the `send_follow_up` policy has a configured
  `policy.serviceDueScript` (string), draft one gated `send_follow_up` per due
  household (dedupe: skip if a pending `send_follow_up` for that household already
  exists — same guard shape `scheduled_reminder` uses at its line 45). Absent config:
  findings only, unchanged. Never fabricate the outreach text — config over code.

### Step 5 — staleness measurement (not interval changes)

`learning.ts`'s `computeLearningDigest` gains
`scanFindingLagHours: { avg: number|null; max: number|null; sampleSize: number }`
— `digested_at - created_at` over the window's digested findings. Surfaced via the
existing `GET /api/insights`. **Do not change any scheduler interval this phase** —
the roadmap requires real data first; this field IS that data.

### Verify

Integration test `tests/integration/loop-closure.test.ts`, tenant `…fd`:
(1) seed an undigested critical finding → `buildPatternContext` returns it in
`scanSignals`; (2) stub-provider planner run (the Phase 9 test's captured-`user`
technique) → the literal substring `"scanSignals"` and the finding's summary appear
in the prompt; (3) `classifyReasoningTier` unit-style cases: warning+unrelated action
→ medium stays medium; critical → high; low_inventory + `log_stock_used_on_visit` →
high; requiresConfirmation:false + critical → still low; (4) low-inventory scan with
`autoDraftReorderFlags: true` policy seeded → a pending `flag_reorder_needed` row
exists AND the finding row carries its `draftedActionId`; same scan without the flag
→ finding only (regression); (5) lag metric computes correctly on two seeded
digested findings. Migration bundled, standard bar, commit.

### EXECUTION PROMPT

```
/goal Implement Phase 12 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 12" section. Read apps/worker/src/scheduler.ts, all five scan handlers in
apps/worker/src/handlers/, packages/orchestration/src/tiering.ts, and
packages/memory/src/patterns.ts first — this phase is an extension of those exact
seams, not a new framework. Work in the doc's step order: migration 0012 (then npm
run db:bundle — forgetting this breaks deployed migrations), scanSignals into
PatternContext/buildPatternContext/planner prompt (update pattern-context.test.ts's
expectations — the doc explains the default-[] fallback), the tiering upgrade rule
(critical→high, STOCK_CONSUMING_ACTION_TYPES; never upgrade un-gated "low"), the two
new config-gated drafting scans copying scan-cold-leads' exact pattern (config
present → draftKnownAction + finding with draftedActionId; absent → finding only,
never fabricate outreach text), and the staleness metric in computeLearningDigest —
do NOT change any scheduler interval. Integration test with tenant
00000000-0000-4000-8000-0000000000fd covering all five numbered cases in the doc's
Verify section. Standard verify bar, commit when green.
```

---

## PHASE 13 — Orchestration Expansion

### Part A — LangGraph over the vertical-workflow action types

Per ground-truth §7–8 this is configuration plus PROOF, and the proof is the phase.

1. Default the allowlist in code, not just env: change
   `graphActionTypeAllowlist()` to seed from a new exported
   `DEFAULT_GRAPH_ACTION_TYPES = ["schedule_water_test", "start_water_test_workflow",
   "request_proposal_signature", "start_installation_workflow",
   "start_invoice_to_cash_workflow"]` when the env var is unset (env var still
   overrides — kill switch preserved; empty-string env = explicit empty allowlist,
   preserve that distinction: `raw === undefined ? DEFAULT : parse(raw)`).
2. Confirm `setup:langgraph` ran (checkpoint tables exist) in the test's beforeAll —
   call `setupLangGraphCheckpointer()` directly, it's idempotent.
3. **Restart proof** (the real deliverable): a new integration test
   `tests/integration/langgraph-workflow-actions.test.ts` (tenant `…fe`) that mirrors
   `langgraph-gate-flow.test.ts`'s structure but for
   `start_invoice_to_cash_workflow`, PLUS a genuine process-boundary case mirroring
   how `scripts/chaos-test.ts` proves recovery: drive the action to the paused gate
   with executor instance A, **construct a brand-new FinnorOrchestrator (new graph,
   new LangGraphExecutor — same Postgres checkpointer)** to simulate the restart,
   `decide(approve)` through instance B, and assert (a) the run resumed from the
   checkpoint (executes without re-running validate/draft — assert via action_log:
   exactly one `validate` and one `draft` episode exist), (b) the plugin's
   `submitCommand` fired exactly once (exactly one `commands` row for its
   idempotencyKey), (c) a second `decide(approve)` is idempotent. If a full
   `process.kill` harness variant is cheap to add via the existing chaos-runner
   pattern, add it; the new-instance-same-checkpointer proof is the required minimum
   and is an honest process-restart equivalent for checkpoint state (say exactly that
   in the test header).
4. Reject path: same setup, `decide(reject)` on instance B → thread closed, action
   `rejected`, no `commands` row.

### Part B — provider health + informed selection

Per ground-truth §9, Sentry breadcrumbs are write-only; build the health store.

New file `packages/tools/src/provider-health.ts`:

```ts
export interface ProviderHealthSnapshot {
  provider: string; window: number;           // window = samples considered (cap 50)
  failures: number; failureRate: number;      // failures/window, 0 when window===0
  p50LatencyMs: number | null;
  consecutiveFailures: number;
  lastFailureAt: string | null;
}
export function recordOutcome(provider: string, ok: boolean, ms: number): void;
export function healthSnapshot(provider: string): ProviderHealthSnapshot;
export function isDegraded(provider: string): boolean;
// degraded ⇔ consecutiveFailures >= 3 OR (window >= 10 AND failureRate > 0.5)
export function resetProviderHealth(): void;  // tests
```

In-process ring buffers (Map<string, array capped 50>). **Honest scope note for the
module header:** per-process only — the worker and the API each see their own call
outcomes, which is correct-enough because selection happens where calls happen; no
cross-process store until real usage shows one is needed (measure-first rule).

Wire-up in `llm.ts`:
- `withObservability()` additionally calls `recordOutcome(provider.name, ok, ms)` —
  one line in each branch; Sentry breadcrumbs unchanged.
- `CompositeProvider` (read its current implementation first) gains
  health-aware ordering: before iterating its provider list, stable-partition it so
  non-degraded providers come first (never *dropping* a provider — a degraded one is
  still the last resort; if all are degraded, original order). Log the reorder via
  the existing breadcrumb mechanism (`Sentry.addBreadcrumb({category:"llm",
  message:"provider-reorder", data:{order}})`).
- `resolveProvider` behavior is otherwise unchanged — policy-pinned providers
  (`modelProvider` on a domain policy) stay pinned; health only reorders fallback
  chains, never overrides an explicit config choice (config over code).

Auditability: the planner already logs provider-relevant episodes; add the chosen
provider name to the existing LLM breadcrumb data (it's already `message:
provider.name` — confirm and leave). No action_log change needed — reordering is a
transport concern, not a business decision (state this; it keeps scope tight).

### Non-goals

No per-call cost models, no "which of N tools" reasoning, no cross-process health
persistence, no dropping providers from chains.

### Verify

Part A test above (tenant `…fe`, real Postgres + checkpointer schema). Part B:
`tests/unit/provider-health.test.ts` — recordOutcome/isDegraded thresholds,
snapshot math, reset; plus a CompositeProvider test using two fake providers where
the first is driven degraded (3 thrown calls) and the next `complete()` provably
calls the second first (order-capturing fakes), and a policy-pinned provider test
proving pinning is untouched. Standard bar, commit.

### EXECUTION PROMPT

```
/goal Implement Phase 13 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 13" section. Read packages/orchestration/src/graph/ (all seven files),
tests/integration/langgraph-gate-flow.test.ts, and packages/tools/src/llm.ts fully
first. Part A is configuration + PROOF: default the allowlist to the five action
types as specced (env var still overrides — preserve the unset-vs-empty distinction),
then write the restart proof exactly as the doc describes — pause at the gate on
orchestrator instance A, build a completely fresh orchestrator instance B on the same
Postgres checkpointer, approve through B, and assert single validate/draft episodes,
exactly-one commands row, and idempotent re-approve. Part B: build
provider-health.ts as specced (in-process, per-process honest scope), record outcomes
inside withObservability, and make CompositeProvider stable-partition degraded
providers to the back — never drop one, never override a policy-pinned provider.
Tenant 00000000-0000-4000-8000-0000000000fe for the integration test. Standard verify
bar, commit when green.
```

---

## PHASE 14 — Voice OS Depth

### Step 0 — fix the zod stripping bug (ground truth §6) BEFORE anything else

`packages/policy-schema/src/index.ts` — replace the `call` sub-schema:

```ts
call: z.object({
  id: z.string().optional(),
  phoneNumberId: z.string().optional(),                       // Vapi's id of the DIALED number
  customer: z.object({ number: z.string().optional() }).passthrough().optional(),
  phoneNumber: z.object({ number: z.string().optional() }).passthrough().optional(), // dialed number, expanded form
  metadata: z.record(z.unknown()).optional(),
}).passthrough().optional(),
```

Regression test first (red→green, this repo's discipline): parse a realistic payload
containing `call.customer.number` + `call.phoneNumberId` and assert both survive.
Then verify the downstream effect: the existing `voice-os.test.ts` covers the
functions; add one route-level test that POSTs a signed tool-calls body with a
customer number matching a seeded `tenants.ownerPhone` and asserts the response is
NOT the "can't verify this line" handoff — this is the proof the live identity bug is
actually fixed, not just the schema.

### Step 1 — migration 0013 + tenant routing

`packages/db/migrations/0013_tenant_phone_numbers.sql` (then `npm run db:bundle`):

```sql
CREATE TABLE finnor_os.tenant_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  phone_number text NOT NULL,            -- E.164 of the dealer's Vapi line
  vapi_phone_number_id text,             -- Vapi's own id for it (preferred match key)
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_number),
  UNIQUE (vapi_phone_number_id)
);
```

Uniques are GLOBAL (not per-tenant) on purpose — one dialed number must resolve to
exactly one tenant; write that comment. RLS: this table is read during tenant
*resolution* (tenant unknown yet), so like `jobs` it is looked up via
`getPool().query` outside `withTenant` — add it to migration 0013 WITHOUT an RLS
policy and document why, mirroring how `jobs` is handled. Schema.ts gets
`tenantPhoneNumbers`. Seed: `packages/db/seed.ts` maps the seed tenant to
`VAPI_PHONE_NUMBER_ID`'s env value when present.

New resolver in the webhook route (or `apps/api/lib/` if it grows):

```ts
async function resolveTenantFromCall(call: {phoneNumberId?: string; phoneNumber?: {number?: string}} | undefined): Promise<string> {
  // 1. vapi_phone_number_id match  2. E.164 match  3. env default + loud console.warn
}
```

Replace both `defaultTenant()` call sites (`handleToolCalls` line 132, end-of-call
line 367) with it. The env fallback stays (single-tenant deploys keep working) but
logs `"[vapi] no tenant_phone_numbers match — falling back to
VAPI_DEFAULT_TENANT_ID"` so misrouting is visible.

### Step 2 — cross-call phrase depth for parseSpokenDecision

Two halves, both honest:
- **Config seam:** `parseSpokenDecision(transcript, extra?: {approve?: string[];
  reject?: string[]})` — extra phrases are word-boundary-escaped
  (`escapeRegExp`, no user-supplied regex) and matched with the same last-signal-wins
  logic. The Vapi route loads them from the tenant's `domain_policies` row for a new
  conventional action type key `voice_confirmation` (`policy.approvePhrases`,
  `policy.rejectPhrases` — arrays of strings; absent → today's behavior exactly).
  Fail-closed property must be preserved and re-tested: unclear NEVER approves.
- **Retrieval that feeds it:** extend `computeLearningDigest` with
  `unclearConfirmations: Array<{transcript: string; at: string}>` — voice_turns of
  sessions whose pending_confirmations resolved, where `parseSpokenDecision` on the
  caller turn returns `"unclear"` (cap 20, redact via `redactText`). Surfaced in
  `/api/insights`: the dealer (or Param) reads real unclear phrasings and adds them to
  the policy. **This is retrieval feeding a config loop, not auto-learning — no
  transcript ever auto-adds a phrase** (a misheard "yeah nah" auto-promoted to
  approve-phrase would be a gate weakening; say so in the code comment).

### Step 3 — interruption/barge-in: configuration check, not code

Vapi handles barge-in at the platform/assistant level. Deliverable is a short section
in `docs/voice-orchestration-contract.md`: which assistant settings govern
interruption (e.g. `stopSpeakingPlan`/transcriber endpointing as of the current
dashboard), what the current assistant (id in env) has set, and the recommendation.
**No custom interruption code.** If the executor cannot check Vapi's live dashboard/
docs from its environment, it writes the doc section with what's verifiable from the
repo and marks the dashboard check as the one human step — never invents settings.

### Verify

Integration test `tests/integration/tenant-phone-routing.test.ts`, tenants `…e2` and
`…e3`: seed both with distinct phone-number rows; POST two synthetic tool-calls
webhook bodies (dev-mode signature path: unset `VAPI_WEBHOOK_SECRET`, NODE_ENV test)
differing only in `call.phoneNumberId`; assert each call's side effects (voice_session
row, drafted action) land under the correct tenant and never the other (the leak
assertion is the point of having two tenants). Schema regression test from step 0.
`parseSpokenDecision` extra-phrases unit tests incl. fail-closed cases
("yeah nah" → whatever last-signal yields today, stays consistent; empty extras =
identical behavior). Unclear-confirmations digest test. Standard bar, commit.

### EXECUTION PROMPT

```
/goal Implement Phase 14 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 14" section. Read apps/api/app/api/webhooks/vapi/route.ts,
packages/voice-os/src/index.ts, packages/orchestration/src/voice.ts, and
VapiWebhookSchema in packages/policy-schema/src/index.ts first. Step 0 is mandatory
and first: the zod call-object stripping bug (doc ground-truth §6) — write the
red-then-green schema regression test, fix with .passthrough() as specced, and prove
at route level that a seeded owner number no longer gets the handoff response. Then
migration 0013 tenant_phone_numbers (global uniques, no RLS policy — the doc explains
why, mirror the jobs-table precedent; npm run db:bundle after), the
resolveTenantFromCall resolver replacing both defaultTenant() call sites with a loud
warn on env fallback, the parseSpokenDecision config seam (escaped phrases, fail-closed
preserved and re-tested, NEVER auto-learned from transcripts) plus the
unclearConfirmations digest retrieval, and the barge-in DOC check — no custom
interruption code. Two-tenant routing integration test with tenants
00000000-0000-4000-8000-0000000000e2/e3 asserting no cross-tenant leak. Standard
verify bar, commit when green.
```

---

## PHASE 15 — Capability & Tool Ecosystem Growth (Stripe + DocuSign)

### Shape of the work

Two real adapters + two binding switches + one webhook route + signature verification
on an existing one + conformance tests that run for real against free test-mode
credentials when present and skip cleanly when absent. **No other integrations.**

### Step 1 — Stripe payment-link binding

New `packages/tools/src/stripe.ts` (plain `fetch`, no SDK dependency — matches the
QuickBooks adapter's dependency-free approach and keeps the stub-fetch test seam):

```ts
export function stripeProviderStatus(): { configured: boolean };   // STRIPE_SECRET_KEY set
export async function createStripePaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkOutput>;
```

Implementation contract (from Stripe's documented API — the executor should verify
field names against current docs if reachable, else these are correct as of this
plan): `POST https://api.stripe.com/v1/checkout/sessions` with
`Authorization: Bearer ${STRIPE_SECRET_KEY}`,
`Idempotency-Key: ${input.idempotencyKey}` (Stripe-native idempotency — the reason
this API over payment_links: sessions accept ad-hoc `price_data` amounts without
pre-creating catalog Price objects, which is exactly the invoice-amount use case),
form-encoded body: `mode=payment`,
`line_items[0][price_data][currency]=usd`,
`line_items[0][price_data][unit_amount]=${Math.round(amountUsd*100)}`,
`line_items[0][price_data][product_data][name]=Invoice ${invoiceId}`,
`line_items[0][quantity]=1`,
`metadata[invoiceId]`/`metadata[tenantId]`/`metadata[idempotencyKey]`,
`success_url`/`cancel_url` from `PAYMENTS_RETURN_URL_BASE` env (default
`https://finnorai.com/pay/{outcome}`). Map response → `{paymentLinkUrl: session.url,
linkId: session.id}`. Non-2xx → throw with Stripe's `error.message` prefixed
`[stripe]` (feeds `diagnoseFailure`'s existing `[integration]` convention — add
`stripe: "Stripe (your payment system)"` to `INTEGRATION_NAMES` in
`orchestration/src/voice.ts`). Auth errors (401/403) throw with `retryable: false`
per the wrap.ts convention.

Binding + contract wiring: `stripeCreatePaymentLinkBinding: CapabilityBinding<…>`
exported from `packages/tools/src/capabilities/accounting.ts`; in
`run-workflow-step.ts` replace line 161's hardcode with
`paymentLinkBinding()`: `PAYMENTS_BINDING === "stripe" ? stripe… : emulator…`.

Inbound: extend `POST /api/webhooks/payment` — when `STRIPE_WEBHOOK_SECRET` is set,
require and verify the `stripe-signature` header (`t=…,v1=…` HMAC-SHA256 over
`${t}.${rawBody}` — same shape as the Vapi verifier at `webhooks/vapi/route.ts:43-56`;
lift that into a shared helper `apps/api/lib/verify-hmac-signature.ts` and use it in
both places rather than copy #3), then map `checkout.session.completed` →
`applyPaymentWebhookEvent({tenantId: metadata.tenantId, invoiceId: metadata.invoiceId,
providerEventId: event.id, amountUsd: amount_total/100, status:"succeeded"})`. The
existing generic body shape stays accepted when the secret is unset (emulator path,
dev) — fail-closed once the secret exists, exactly the Vapi route's posture.

### Step 2 — DocuSign e-signature binding

New `packages/tools/src/docusign.ts`:

```ts
export function docusignProviderStatus(): { configured: boolean };
// requires: DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID,
//           DOCUSIGN_PRIVATE_KEY (PEM, JWT grant), DOCUSIGN_BASE_URL (default https://demo.docusign.net)
export async function requestDocusignSignature(input: RequestSignatureInput): Promise<RequestSignatureOutput>;
```

JWT grant flow (RS256 assertion → `POST {auth}/oauth/token`, auth host
`account-d.docusign.com` for demo; cache the access token in-module with expiry,
mirroring how quickbooks.ts handles its tokens — read that file and copy its refresh
discipline). Envelope: `POST /v2.1/accounts/{accountId}/envelopes` with a minimal
one-signer envelope — the document itself: this repo's documents are
`storageRef: native://…` with **no real PDF bytes** (ground truth from
`documents-emulator`/`createDocument`) — so the adapter generates a minimal PDF
placeholder from the document title (a tiny hand-built PDF byte template is
acceptable and honest; comment that real PDF rendering is a documents-capability gap,
not an e-sign gap). `signatureRequestId = envelopeId`, `status:"sent"`. Errors
prefixed `[docusign]`, added to `INTEGRATION_NAMES`.

Binding: `docusignRequestSignatureBinding` exported from
`capabilities/documents.ts`; `run-workflow-step.ts` line 144's hardcode becomes
`esignBinding()`: `ESIGN_BINDING === "docusign" ? docusign… : emulator…`.

Inbound: new `apps/api/app/api/webhooks/esign/route.ts` — DocuSign Connect HMAC
(`x-docusign-signature-1`: base64 HMAC-SHA256 of the raw body with
`DOCUSIGN_CONNECT_SECRET`; fail-open only when secret unset AND non-production,
fail-closed otherwise — the house posture), map envelope status
`completed|declined|voided` → `applySignatureOutcome({tenantId, quoteId, proposalId,
signatureRequestId: envelopeId, outcome: signed|declined|expired})`. The
quoteId/proposalId round-trip rides envelope `customFields` set at creation
(`tenantId`, `quoteId`, `proposalId` — the plugin's step payload already carries
proposal context via the workflow's `context` mechanism; thread what exists,
and if quoteId isn't in the step payload today, look it up from the proposal row in
the route — `proposals.quoteId` exists).

### Step 3 — conformance tests, credential-gated

`tests/integration/real-provider-conformance.test.ts`, tenant `…e4`, two suites:
`describe.skipIf(!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))` — refuses
to run against a live key by construction — creates a real test-mode checkout
session, asserts url/id shape, asserts idempotency (second call, same key → same
session id); `describe.skipIf(!docusignProviderStatus().configured)` — creates a real
demo-env envelope, asserts envelopeId, voids it in afterAll (cleanup). Plus
non-gated unit tests for both adapters via the stub-global-fetch seam
(critic-review.test.ts's technique) covering happy path, API-error mapping, and the
never-2xx-retry-on-401 property. Sandbox signup (free, no business required:
Stripe test mode + DocuSign developer demo account) is a HUMAN step — if credentials
aren't in `.env` when this phase runs, the gated suites skip, and the phase report
must say exactly that rather than claiming live-API proof.

### Non-goals

No Slack/Teams/ERP/anything else. No production keys. No PDF-rendering pipeline
(named gap). No payment methods beyond the checkout-session link.

### Verify

Standard bar + the conformance file (skipping counts as passing the SUITE but the
report must state which halves actually hit real APIs). The full-suite runs must
stay green with all four new env vars unset — graceful-degradation is part of the
contract. Commit.

### EXECUTION PROMPT

```
/goal Implement Phase 15 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 15" section. Read packages/tools/src/capabilities/accounting.ts and
documents.ts, the two emulators, packages/tools/src/quickbooks.ts (the real-adapter
template, esp. its token handling), and apps/worker/src/handlers/run-workflow-step.ts
lines 53–180 first. Build stripe.ts and docusign.ts as specced (plain fetch, no SDKs;
[stripe]/[docusign] error prefixes wired into INTEGRATION_NAMES), replace the two
hardcoded emulator bindings at run-workflow-step.ts:144 and :161 with
ESIGN_BINDING/PAYMENTS_BINDING env switches matching the file's existing seven
switch functions exactly, extract the Vapi HMAC verifier into a shared helper and use
it for Stripe webhook verification on /api/webhooks/payment (fail-closed once
STRIPE_WEBHOOK_SECRET exists, generic emulator shape still accepted without it), and
add /api/webhooks/esign in front of the existing applySignatureOutcome. Conformance
tests are credential-gated (sk_test_ prefix check for Stripe — never a live key) and
skip cleanly when creds are absent; stub-fetch unit tests run regardless. The whole
suite must stay green with none of the new env vars set. Report honestly which
provider calls actually ran live. Tenant 00000000-0000-4000-8000-0000000000e4.
Standard verify bar, commit when green.
```

---

## PHASE 16 — Production Hardening, Right-Sized

Five workstreams; (a) and (c) have human-blocked halves — the deliverable there is
the executable part plus a precise runbook for the human step, never a claim.

**(a) Secrets.** Code is done (`packages/security/src/secrets.ts`: env vs
aws-secrets-manager provider, `FINNOR_SECRET_IDS` JSON map, retry w/ non-retryable
fail-fast, 5-min refresh, single-flight init, prod plaintext guard). Deliverable:
`docs/secrets-runbook.md` — the exact `FINNOR_SECRET_IDS` JSON shape for THIS repo's
real secret set (enumerate from `.env.example`: GROQ_API_KEY, AWS_BEDROCK_API_KEY,
VAPI_API_KEY, VAPI_WEBHOOK_SECRET, GMAIL_APP_PASSWORD, SUPABASE_SERVICE_ROLE_KEY,
REDIS_URL, DATABASE_URL, STRIPE_SECRET_KEY, DOCUSIGN_* from Phase 15…), the IAM
policy JSON (secretsmanager:GetSecretValue on the named ARNs only), the Vercel/
Railway env-var flips (`SECRETS_PROVIDER=aws-secrets-manager`, AWS creds), the
verification call (`secretProviderStatus()` via a temporary admin check or log), and
rollback (unset SECRETS_PROVIDER). Plus one unit test hole to close if present:
`mappings()` on malformed JSON throws with a clear message (check
`tests/unit/secrets.test.ts` first — extend, don't duplicate).

**(b) Backup/restore drill — actually run it.** The script
(`scripts/backup-restore-drill.ts`) is honest that embedded-postgres ships no client
tools. Executable path on this machine: download the matching major-version Postgres
client binaries WITHOUT brew/Docker (neither exists here) — `npm i -D
@embedded-postgres/darwin-arm64` already vendors server binaries; client tools can
come from a portable build (e.g. `zonky` embedded binaries or postgresql.org
binaries unpacked into the session scratchpad, added to PATH for the drill run
only). If a portable client-tools download is achievable in-session: run the drill
end-to-end against the dev DB and paste the real output (row-count table, timestamp)
into `docs/backup-restore-runbook.md` under a new "Last drill" heading. If not
achievable (no network access to fetch binaries, say): the deliverable degrades
honestly to a tested dry-run harness + the runbook's existing instructions, and the
report says the drill remains human-blocked on client tools — never "reviewed the
script" dressed up as "ran the drill."

**(c) Staging.** `docs/staging-setup.md` already specifies everything and states
nothing is provisionable without founder accounts. Executable half: make the repo
staging-ready so the human step is a 30-minute checklist, not a project — verify
`railway.staging.json` exists and parses (create from `railway.json` if absent),
add a `npm run test:staging` script (`DATABASE_URL` must be explicitly set; refuses
to run against a URL containing `.devdb`/localhost… actually invert: refuses unless
`STAGING=1` is set, to prevent accidental prod pointing), and extend
`GET /api/setup/status` with an `environment` block (NODE_ENV, secretProvider,
bindings in effect: the seven *_BINDING env values + PAYMENTS/ESIGN from Phase 15) so
a staging deploy's config posture is verifiable from one endpoint. Provisioning
itself: human step, listed as such.

**(d) RBAC.** Enforcement exists (`canApprove`, both decide routes, owner-safe
default). Close the real gaps: (1) seed `role_permissions` in `seed.ts` with a
defensible baseline — dispatcher: `can_approve=true` for scheduling/communication
action types (`schedule_water_test`, `reschedule_visit`,
`assign_technician_to_visit`, `send_customer_message`, `send_follow_up`,
`start_water_test_workflow`); technician: none (approve nothing); owner: implicit via
default; (2) integration test `tests/integration/rbac-approval.test.ts` — dispatcher
approves a scheduling action (200), dispatcher rejected on `create_invoice` (403 —
assert the response, and that the action stays pending), technician 403 on both,
wildcard row honored, no-rows default = owner-only (regression); (3) the voice path:
`decide()` via `finnor_confirm` currently runs as the resolved owner identity only
(voice-os only ever grants owner staffCtx) — assert that in a test and leave a
comment that dispatcher-by-voice is future work (users table has no phone — ground
truth from voice-os.ts's own comment). No new roles invented — the roadmap says
extend only on real need.

**(e) Distributed tracing, breadcrumb-native.** Correlation id threaded across
process boundaries using existing mechanisms only: (1) `apps/api/lib/auth.ts`
`requireContext` generates `correlationId = req.headers.get("x-correlation-id") ??
crypto.randomUUID()` — attach via `Sentry.getCurrentScope().setTag()` and return it
on the context (extend `TenantContext` with optional `correlationId?: string`);
(2) `enqueueJob` gains an optional trailing param folding `_correlationId` into the
payload JSON (callers pass `ctx.correlationId` where they have a ctx — start with the
executor's `voice_confirm_request`/`critic_review` enqueues and `handleInstruction`'s
path; mechanical, ~6 call sites — grep `enqueueJob(`); (3) worker: `initObservability()`
at `apps/worker/src/index.ts` boot (it currently never initializes Sentry — ground
truth §5), and `queue.ts`'s job dispatch wraps each handler call with a scope tag
`correlation_id: payload._correlationId ?? job.id` + breadcrumb
`{category:"job", message: type, data:{ok, ms}}`, plus `Sentry.captureException` in
the existing catch-with-retry path (read queue.ts first — do not disturb the
try/finally client-release fix from commit 81d613e; the wrap goes around the handler
invocation only); (4) Temporal activities (`apps/temporal-worker/src/activities.ts`):
same pattern, correlation id via workflow args where already-plumbed args allow —
if not cheaply plumbable, tag with `workflowId` and note it. Verification:
integration test asserting `_correlationId` survives enqueueJob→payload round trip,
and a manual trace: one `handleInstruction` call → grep the correlation id across
api log + jobs.payload — paste it in the report. No OpenTelemetry, no new vendor.

### Verify

Standard bar + each workstream's own artifact: runbook files committed, drill output
(or honest blocker note), staging-readiness endpoint returning the environment block,
RBAC suite green, correlation-id test green + the manual trace. Commit.

### EXECUTION PROMPT

```
/goal Implement Phase 16 per finnor-os/docs/jarvis-99-phase-10-16-execution-plan.md's
"PHASE 16" section — five workstreams, in order (a) through (e). Read
packages/security/src/secrets.ts, scripts/backup-restore-drill.ts,
docs/backup-restore-runbook.md, docs/staging-setup.md, apps/api/lib/auth.ts
(canApprove + requireContext), apps/worker/src/queue.ts, and apps/worker/src/index.ts
first. Ground rules: (b) only claim the backup drill ran if it actually ran — if
portable Postgres client tools can't be fetched in this environment, say exactly that
and deliver the honest degraded artifact the doc describes; (c) staging provisioning
is a human step — deliver the readiness half (staging config parse check, guarded
test:staging script, setup/status environment block); (d) seed the specced
role_permissions baseline and write the four-case RBAC integration test including the
owner-only-default regression; (e) correlation ids ride existing mechanisms only —
Sentry init in the worker (it currently has none), scope tags + job breadcrumbs
around handler dispatch WITHOUT disturbing queue.ts's try/finally release fix from
commit 81d613e, _correlationId through enqueueJob payloads, and the manual
cross-process trace pasted into the report. No SIEM, no zero-trust, no canary
deploys, no OpenTelemetry. Standard verify bar, commit when green.
```

---

## Cross-phase file manifest

| File | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|
| `apps/api/app/api/workflows/runs/route.ts` | **new** | | | | | | |
| `apps/api/app/api/events/route.ts` | **new** | | | | | | |
| `apps/console/app/globals.css` + `components/*` + `lib/use-poll.ts` | **new** | edit | | | | | |
| `apps/console/app/*` (all six pages + layout) | edit | | | | | | |
| `apps/console/app/customers/page.tsx` | | **new** | | | | | |
| `packages/read-models/src/index.ts` | | edit | | | | | |
| `apps/api/app/api/read-models/[view]/route.ts` | | edit | | | | | |
| `packages/memory/src/long-term.ts` | | edit | | | | | |
| `packages/db/migrations/0012_scan_findings_lifecycle.sql` | | | **new** | | | | |
| `packages/db/migrations/0013_tenant_phone_numbers.sql` | | | | | **new** | | |
| `packages/db/schema.ts` + `seed.ts` + bundle | | | edit | | edit | | edit(seed) |
| `packages/shared-types/src/index.ts` | | | edit | | | | edit |
| `packages/memory/src/patterns.ts` | | | edit | | | | |
| `packages/orchestration/src/tiering.ts` + `planner.ts` | | | edit | | | | |
| `apps/worker/src/handlers/scan-*.ts` + `owner-digest.ts` | | | edit | | | | |
| `packages/orchestration/src/learning.ts` | | | edit | | edit | | |
| `packages/orchestration/src/graph/allowlist-executor.ts` | | | | edit | | | |
| `packages/tools/src/provider-health.ts` | | | | **new** | | | |
| `packages/tools/src/llm.ts` | | | | edit | | | |
| `packages/policy-schema/src/index.ts` | | | | | edit | | |
| `apps/api/app/api/webhooks/vapi/route.ts` | | | | | edit | | |
| `packages/orchestration/src/voice.ts` | | | | | edit | edit | |
| `packages/tools/src/stripe.ts` / `docusign.ts` | | | | | | **new** | |
| `packages/tools/src/capabilities/{accounting,documents}.ts` | | | | | | edit | |
| `apps/worker/src/handlers/run-workflow-step.ts` | | | | | | edit | |
| `apps/api/lib/verify-hmac-signature.ts` | | | | | | **new** | |
| `apps/api/app/api/webhooks/{payment,esign}/…` | | | | | | edit/**new** | |
| `docs/secrets-runbook.md` | | | | | | | **new** |
| `apps/api/lib/auth.ts` + `apps/worker/src/{index,queue}.ts` | | | | | | | edit |
| New tests | 2 routes | `household-360` | `loop-closure` | `langgraph-workflow-actions`, `provider-health` | `tenant-phone-routing` + schema regression | `real-provider-conformance` | `rbac-approval` + correlation |

Two migrations total (0012, 0013) — run `npm run db:bundle` after each. Tenant UUIDs
assigned in ground-truth §15. No new packages, no new npm dependencies in any phase
(Phase 15's adapters are deliberately fetch-based).

## Build order

**10 → 11 → 12 → 13 → 14 → 15 → 16**, strictly. The couplings that force it: 11's
console page consumes 10's tokens/Timeline component; 12 extends the PatternContext
seam and must not race 11's read-models edits in the same files' vicinity; 13 is
independent-ish but its restart proof benefits from a stable suite; 14's routing test
POSTs through code 13 doesn't touch (safe), but its schema fix should land before 15
adds more webhook surface; 15's HMAC helper extraction touches the Vapi route 14
just edited (do it after, once); 16 audits everything, so it goes last. **Commit
after every phase.** If splitting across parallel sessions is ever tempting: don't —
seven phases share `planner.ts`, `schema.ts`, `shared-types`, and the webhook routes
between them, and the merge cost exceeds the parallelism win.

## After Phase 16

Unchanged from the roadmap: the remaining gap to "100%" is real operating-dealer
credentials (production payment/e-sign keys, AWS IAM, Gmail app password, Vapi
webhook secret, a real dealer's pricing/policies) — business steps, not code steps.
The one code-adjacent leftover this plan consciously leaves behind: serializing
`MemorySnapshot.longTerm` into the planner prompt (ground truth §14) — do it as its
own micro-phase with a token-budget measurement, not as a rider on anything above.
