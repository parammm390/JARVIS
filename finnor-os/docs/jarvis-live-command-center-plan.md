# JARVIS Live Command Center — finnorai.com/jarvis rebuild + ship-state repair

**What this is:** the definitive plan to make `finnorai.com/jarvis` THE single product
surface — a live, immersive, JARVIS-style command center driven by the real Finnor OS
backend — and to fix the deployment disconnect that made a week of backend phases
invisible from the website. Written after verifying every claim below against the
actual code and the LIVE deployed endpoints (curl probes, 2026-07-17).

**Hard rules for the executor (non-negotiable):**
- **Zero backend changes.** No edits under `finnor-os/packages/`, `finnor-os/apps/api`
  (except env vars via Vercel), `finnor-os/apps/worker`, or anything voice/Vapi. The
  frontend consumes ONLY endpoints that already exist (enumerated in §4 — they cover
  everything needed).
- **Never touch the production voice agent** (Vapi assistant config/scripts) — it
  closes real customers. The browser-mic session on the page uses the existing
  `@vapi-ai/web` wiring only.
- **Never fabricate a number, delta, or activity.** No "Revenue Impact $12,540 ↑" with
  invented comparisons. Every stat on screen maps to a named real endpoint field or is
  visibly labeled as ambient/simulation (the page's existing LIVE/SIMULATION badge
  pattern). This is a standing brand rule, not a style preference.
- Marketing-repo conventions: additive components, Param strips em-dashes from copy
  (use commas/periods in user-facing strings), never the phrase "AI receptionist".
- **Never run `next build` while `next dev` is serving** — it corrupts `.next` chunk
  cache (page hangs on "Waking JARVIS…", zero console errors; fix is stop dev,
  `rm -rf .next`, restart). Cost 30 minutes once already.

---

## §1 Diagnosis — why the website never showed the work (verified, not guessed)

Three surfaces exist:

| Surface | What it is | State (verified 2026-07-17) |
|---|---|---|
| `finnor-os/apps/console` | Internal ops console, localhost:3101 / finnor-os-console.vercel.app | Got the Phase 10 mission-control restyle. Bland by design (zero-dep tokens). NOT the website. |
| `api-psi-brown-95.vercel.app` | The deployed Finnor OS API the website talks to | **STALE — pre-Phase-6 code.** `/api/read-models/pipeline-health`, `/api/events`, `/api/workflows/runs` all return 404 live. `/api/stats` works and its newest row is 2026-07-13 — the last deploy day. (`finnor-os-api.vercel.app` is dead entirely: 404 on `/api/health`.) |
| `finnorai.com/jarvis` | The public JARVIS page, in the MARKETING repo (`src/app/jarvis/page.tsx` + `src/components/jarvis/` — 1,553 lines) | Live, but polls only `/api/stats` + `/api/actions` (JarvisCommandCenter.tsx:196,252) with dev-bypass headers (line 47). Knows nothing about workflows, events, or read-models. |

So: every phase executed this week landed in the local `finnor-os` repo (commits
c86c2ef → d5c6902 verified present) and ran against the local embedded Postgres. The
deployed API was never redeployed, the production Supabase DB never received
migrations 0008-0011, and the public jarvis page was never taught the new endpoints.
Nothing is lost; nothing was overwritten; the pipes were never connected.

**Consolidation decision (per Param):** finnorai.com/jarvis is the single product
face. `apps/console` remains as an internal admin tool (policy editor, raw audit) —
untouched by this plan, deprioritized, never linked publicly.

---

## §2 Part 0 — Ship-state repair (do this BEFORE any pixels)

Order matters. Steps 0.3's migration is **gated on explicit human approval** — the
standing rule is never migrate the live Supabase without Param's direct say-so.

**0.1 Commit the uncommitted work** in `finnor-os/`: Phase 7-9 files
(`packages/orchestration/src/repair.ts`, `tiering.ts`, `packages/memory/src/patterns.ts`,
the three test files, the four modified files) as one commit ("Phase 7-9: repair pass,
risk tiering, pattern context"), the two plan docs as another. Verify `npx tsc -p
tsconfig.json` + full suite green first (established bar).

**0.2 Redeploy the finnor-os API.** Mechanics that already bit us once, follow
exactly: deploy from `finnor-os/` root (NOT `apps/api/` — the npm workspace packages
must upload), with explicit env vars rather than the shared link file (two projects
share one `.vercel/project.json` and `vercel link` silently clobbers it):
`VERCEL_ORG_ID=team_TlTo8L6Rvgb0H7uJh0G5GLDD VERCEL_PROJECT_ID=prj_STiPLs21g7WrNqKoUgeMoNp8PqTO vercel deploy --prod`.
First run `vercel project ls` to confirm which project serves `api-psi-brown-95` —
if the domain moved projects since 2026-07-13, target what actually serves it. After
deploy: `curl https://<api-domain>/api/health` must 200.

**0.3 Migrate production Supabase — ONLY with Param's explicit yes.** The new code
needs migrations 0008-0011 (canonical data platform, durable runtime, voice OS, plan
compiler). Everything is schema-isolated in `finnor_os` (designed for exactly this),
and the server-side path exists: `POST /api/admin/migrate` with `x-admin-secret`
(secret in the session scratchpad `admin-secret.txt` / `ADMIN_SECRET` env), which runs
the bundled migrations + seed. **Ask Param, run it, then verify:**
`/api/read-models/pipeline-health` returns 200 JSON. If Param defers, the frontend
still ships — §5's degradation contract keeps every new panel functional-empty with
its SIMULATION badge until the API catches up.

**0.4 CORS + env alignment.** `CONSOLE_ORIGIN` on the API project must include
`https://finnorai.com` and `https://www.finnorai.com` (it did as of 2026-07-12 —
verify, don't assume). `NEXT_PUBLIC_OS_API_URL` on the finnor-agency project
(prj_dttKVOUzFBGnSg6zNdRualYjQ3oe) must point at the live API domain. Local dev:
`.env.local` gets `NEXT_PUBLIC_OS_API_URL=http://localhost:3100`.

**0.5 Known posture, do not change this phase:** the page authenticates with
dev-bypass headers (`x-tenant-id` + `x-user-role: owner`, JarvisCommandCenter.tsx:47)
and the deployed API honors them. That means the prod API trusts forged tenant
headers — a real hardening item, but fixing it is a backend/auth change (forbidden
here). Flag it in the phase report as the top follow-up; do not silently "improve" it.

---

## §3 What already exists on /jarvis — REUSE, don't rebuild from scratch

`src/components/jarvis/` already contains the hard-won pieces (all deterministic,
hydration-safe, no Math.random):
- `atmosphere.tsx` (88 lines): aurora blobs, SVG-turbulence film grain, rising bubble
  field, caustic shimmer band, `Glass` gradient-border card component.
- `sound.ts` (71): WebAudio synth cues (approve/reject/tick/voiceOn/voiceOff/send),
  master gain 0.12, mute toggle.
- `CustomCursor.tsx` (86): mix-blend-difference dot+ring, pointer:fine only.
- `views.tsx` (500): 7 working sidebar views (Voice Console, Leads & CRM, Workflows,
  Inventory, Invoices, Water Compliance, Web Research) polling real
  `/api/resources/[kind]` endpoints every 8s with per-panel LIVE/sample badges.
- `JarvisCommandCenter.tsx` (808): shell, sidebar, live ops ticker, command bar with
  animated gradient border, approve/reject wired to `/api/actions/:id/confirm|reject`,
  Vapi browser voice, SSR-safe mounted-flag hydration, LIVE/SIMULATION auto-badge.

The marketing repo has **tailwind + framer-motion already installed** (the Hero and
the whole site use them) — unlike the console's zero-dep constraint, the mockup's
cinematic look is native here. Design language stays the site's own: slate-950 base,
teal-200 status-pulse accents, `rounded-[2rem]`, `font-black` display type,
`tracking-[0.18em]` labels — the mockup's neon-blue-on-black is a tint shift within
this system (add cyan/blue glow accents), not a new identity.

---

## §4 The endpoint map — every panel's real data source (nothing else exists; use only these)

All on the finnor-os API, all already deployed-or-deployable (Phase ≤10 code), all
GET unless noted:

| Endpoint | Returns (verified shapes) | Feeds |
|---|---|---|
| `/api/stats` | `{pending, blocked, recentActions[]}` | header counts, ticker (already wired) |
| `/api/actions/pending?filter=pending\|blocked` | full pending rows incl. `groundedPayload` | approval queue cards |
| `/api/actions/:id/confirm` / `/reject` (POST) | execution result | approve/reject (already wired) |
| `/api/workflows/runs?status=running` | `{runs:[{id,workflowType,status,createdAt,updatedAt,steps:[{stepType,sequence,status,attempts,terminalReason}]}]}` | **the live workflow node-graph centerpiece** |
| `/api/events?before=&entityType=&entityId=` | `{events:[{entityType,entityId,eventType,payload,occurredAt,source}]}` | System Activity rail + client-side hourly sparkline buckets |
| `/api/read-models/pipeline-health` | leads/quotes/proposals by status | pipeline bars |
| `/api/read-models/cash-collections` | `{invoicesByStatus[{status,count,totalUsd}], totalCollected, paymentLinksAwaitingPayment}` | the money KPI (real totals, no invented deltas) |
| `/api/read-models/sla-breaches` | `{stuckWorkflowRuns, openReconciliationCases}` | health chips |
| `/api/read-models/stock-risk`, `follow-up-debt`, `technician-load`, `service-due`, `data-quality` | as named | ops strip |
| `/api/resources/households\|inventory\|invoices\|workflows\|visits\|technicians` | row lists | existing sidebar views (keep) |
| `/api/comms` | sandbox outbox | conversation/message feed |
| `/api/insights` | learning digest incl. concerns | "what Finnor noticed" panel |
| `/api/health`, `/api/setup/status` | liveness + per-action config readiness | status chip, System Status popover |

Sparklines: bucket `/api/events` timestamps per hour client-side — real activity
shape, zero backend work. KPI deltas ("vs yesterday") are allowed ONLY where two real
windows can be computed from events client-side; otherwise show the number without a
delta. Never a hardcoded percentage.

**The mockup's Live Calls Map: cut it.** No geocoding exists anywhere in the backend
and a dotted US map implying live geographic calls would be fabricated data on a
sales-facing page. Its grid slot goes to the Event Timeline (real). If Param wants a
map later it's a labeled decorative graphic, never presented as live data.

---

## §5 The rebuild — target information architecture (the mockup, mapped to reality)

Everything below is a rework of `JarvisCommandCenter.tsx`'s Command Center home view
plus new components under `src/components/jarvis/` (`panels/` subfolder). Keep the
sidebar + 7 views + command bar + voice exactly as functional today; the home view is
what transforms.

**5.1 Header band.** Greeting ("Good evening, Param." from local time), live counts
sentence from `/api/stats` (real numbers or nothing — no placeholder "18
conversations"), System Status chip (`/api/health` ok + `setup/status` readiness →
Optimal / Degraded with popover listing what's unconfigured), clock, and the ambient
waveform strip (decorative, already have the pattern).

**5.2 KPI strip** — five `Glass` cards with count-up animation (port the count-up
from the Phase 10 console work — it exists in `apps/console`; reimplement locally,
~20 lines) + hourly sparkline (SVG polyline from event buckets):
pending approvals, blocked/needs review, collected $ (`cashCollections.totalCollected`),
overdue $ (from `invoicesByStatus`), open leads (pipeline-health). Each card deep-links
its sidebar view or queue.

**5.3 LIVE WORKFLOW panel (the centerpiece).** `/api/workflows/runs?status=running`,
4s poll:
- Each running run renders as a horizontal node-graph: nodes = steps ordered by
  `sequence` (icon by stepType: document, signature, stock, payment-link, message,
  appointment; label = stepType humanized; sublabel = attempts/terminalReason).
- Node states: `pending` dim glass; `leased` cyan glow + pulse (this is "AI working
  now"); `completed` teal check; `failed` red; `compensating/compensated` amber.
- Edges: SVG paths with animated `stroke-dashoffset` flow ONLY on the edge into the
  currently-leased step; completed edges solid teal; future edges faint.
- Framer-motion layout animations when a step completes (node scale-pop, edge fill).
- Sound: `tick` cue on step completion, `approve` cue on run completion (respect the
  existing mute toggle).
- Empty state (no running runs — common in a demo): render the four vertical-workflow
  BLUEPRINTS (lead→water test, water test→signed proposal, proposal→installation,
  invoice→cash) as static labeled diagrams with a "blueprint" badge — clearly not
  live, one keypress from the command bar to start a real one. Never fake a running
  animation on a blueprint.
- Click a run → detail drawer: every step's evidence timestamps, attempts, terminal
  reason (all real fields from the response).

**5.4 LIVE CALL panel.** Drives from the existing `@vapi-ai/web` session on the page:
idle = "Speak Now" state; active = ON CALL header, elapsed timer, real waveform from
the SDK's `volume-level` events (bar heights from actual volume values), "AI is
speaking…" from `speech-start`/`speech-end` events, live transcript lines (already
captured in the talk pattern), Mute (SDK `setMuted`) and End Call controls. Phone-line
calls from customers do NOT stream to the browser (no backend event feed exists for
that — no fabricated "incoming call" cards; the panel is for the browser session
only, labeled as such).

**5.5 Approval queue (mockup's "Lead Captured" slot, but real).** The gated-actions
queue as glowing cards: summary, actionType chip, `groundedPayload` verification
badges (verified teal / not_found red / unverifiable dim), Approve/Reject with the
existing optimistic behavior + sound cues. This IS the product's core gate — it earns
the hero position the mockup gives "Lead Captured".

**5.6 SYSTEM ACTIVITY rail.** `/api/events` newest 20, 6s poll: colored dot by
eventType family, humanized label, relative time, entity chip that filters the
timeline (`?entityType&entityId`). "View All Activity" expands to a full-height
timeline view (new 8th sidebar view, trivial — same component, longer list).

**5.7 Bottom command bar** (exists — keep) + add `⌘K` palette: navigation across the
8 views + "start water test workflow", "show overdue invoices" style quick commands
that just prefill the command bar's instruction input (the instruct pipeline already
handles the rest — no new execution paths).

**5.8 Motion/atmosphere pass.** Atmosphere layers stay; add: panel stagger-in on
first mount (framer-motion, 40ms stagger), number count-ups, the workflow edge flow,
status-pulse dots on every LIVE badge, hover-lift on Glass cards (already partly
there). ALL gated behind `prefers-reduced-motion` (atmosphere already is — keep that
discipline for every new animation).

**5.9 Degradation contract (ships regardless of §2 progress).** Every new panel
wraps its fetch: 200 → LIVE badge; non-200/network → the panel's SIMULATION state
(existing page pattern): blueprints for workflows, empty-elegant for events, dashes
for KPIs. The page must look intentional against the stale API on day one and light
up panel-by-panel as 0.2/0.3 land.

---

## §6 File manifest (marketing repo, all additive except the shell)

| File | Action |
|---|---|
| `src/components/jarvis/JarvisCommandCenter.tsx` | rework home view + wire new panels (largest change) |
| `src/components/jarvis/panels/KpiStrip.tsx`, `WorkflowGraph.tsx`, `LiveCallPanel.tsx`, `ApprovalQueue.tsx`, `ActivityRail.tsx`, `CommandPalette.tsx` | **new** |
| `src/components/jarvis/lib/useOsApi.ts` | **new** — one fetch hook: headers, polling, LIVE/degraded state, per-endpoint types from §4 |
| `src/components/jarvis/lib/sparkline.ts` | **new** — event→hourly-bucket→polyline points (pure, unit-testable) |
| `src/components/jarvis/views.tsx` | add Activity view; otherwise untouched |
| `src/components/jarvis/atmosphere.tsx`, `sound.ts`, `CustomCursor.tsx` | untouched (reused) |

Nothing under `finnor-os/` changes except git commits + Vercel env/deploy operations.

## §7 Verification

1. Local: finnor-os API :3100 + embedded Postgres (seeded, with a started workflow so
   the graph has a real running run: fire `start_water_test_workflow` via the command
   bar and approve it), marketing `next dev` :3000 with
   `NEXT_PUBLIC_OS_API_URL=http://localhost:3100`. Drive EVERY panel in the browser:
   watch the workflow graph advance live as the worker processes steps, approve/reject
   with sound, voice session waveform, palette, 375px pass. Screenshots.
2. Kill the local API → confirm every panel degrades to its labeled simulation state,
   no crashes, badge flips.
3. Deploy finnor-agency → verify live at finnorai.com/jarvis against whichever API
   state exists (per §2 progress). Marketing repo build gotchas: root tsconfig
   excludes `finnor-os`, `.vercelignore` excludes it — verify both still true before
   deploying.
4. Report honestly which panels are LIVE in production vs. awaiting §2.3's migration
   approval.

## EXECUTION PROMPT (paste into a fresh session — marketing repo work + deploy ops)

```
/goal Implement finnor-os/docs/jarvis-live-command-center-plan.md end to end. Read
the ENTIRE plan first, then src/components/jarvis/ (all five files) and
src/app/jarvis/page.tsx before writing anything. Non-negotiables are in the plan's
header: zero finnor-os backend changes, never touch the production Vapi assistant,
never fabricate a number or a live-looking animation on non-live data (SIMULATION
badges per §5.9), em-dash-free copy, never build while dev serves. Work in plan
order: §2 ship-state repair first (0.1 commit, 0.2 API redeploy with the exact
project-id env-var mechanics quoted, 0.3 STOP and ask Param for explicit approval
before any Supabase migration — hard gate, 0.4 env/CORS alignment), then the §5
rebuild reusing every §3 asset, consuming only §4's endpoints. The workflow
node-graph (§5.3) is the centerpiece — build it against a real running workflow
locally per §7.1, not against imagined data. Verify per §7 including the
kill-the-API degradation pass, deploy the marketing site, and report which panels
are genuinely LIVE in production versus which await the migration approval.
```
