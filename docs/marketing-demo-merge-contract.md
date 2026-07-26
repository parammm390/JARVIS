# Demo Merge Contract — three demos become one (`/demo` → `/demo/lifecycle`)

Binding spec for M4. Expands `JARVIS-MARKETING-MAESTRO-PLAN.md` §2.5 into implementable detail. Read this before touching `DemoExperience.tsx`, `LifecycleExperience.tsx`, or the two cut routes.

## The governing principle

Everything downstream of the live call is **presentation reusing real JARVIS UI components against locally-built demo data** — never a call into the real `finnor-os` backend, never a real `domain_actions` row. The visual honesty rule applies in full: every rendered card gets an explicit DEMO label. This is a client-side re-skin of real UI components, not a live JARVIS integration.

## Act 1 — `/demo` (`DemoExperience.tsx` + `/api/generate-demo` + `/api/demo/extract-intake`)

**Unchanged**: website scrape → Gemini company profile → live Vapi call configured as the visitor's own company → transcript → `POST /api/demo/extract-intake`. This route already returns a `DemoIntakeHandoff` (`src/lib/demo/types.ts`) with fields including `workflowType` (`"water_treatment" | "well_pump_emergency"`), `callerName`, `mainConcern`, `issueType`, `waterSource`, `systemInterest`, `timeline`, `dispatchAlertText`, `crmSummary`, plus a merged `household: HouseholdRecord` and `nextAction: NextRevenueAction` (both from `src/lib/memory/household.ts`) when a household record is threaded through. **None of this API mechanism changes.**

**What changes — the termination point.** Today the client presumably routes toward the fake `/demo/[slug]` ops dashboard after the call. Instead:

1. Map the returned `DemoIntakeHandoff` into an `{ actionType, payload }` pair shaped like a real JARVIS `DomainAction` — client-side, no network call to `finnor-os`. Concrete mapping to work out during implementation (read the real field specs in `src/components/jarvis/ui/renderers/{registry,fields}.ts` before finalizing):
   - `workflowType: "water_treatment"` → map toward `generate_quote` or `schedule_water_test` (`waterSource`/`systemInterest`/`timeline`/`callbackPreference` fields line up with those action types' real payload shapes).
   - `workflowType: "well_pump_emergency"` → map toward `assign_technician_to_visit` or a similarly dispatch-shaped action type (`issueType`/`immediateDanger`/`sinceWhen`/`peopleAffected` line up better there).
   - Any `DemoIntakeHandoff` field with no clean counterpart renders through `StandardRenderer`'s normal unknown-field handling (labeled row, never `JSON.stringify`) — do not invent a payload field that doesn't correspond to something the transcript actually captured.
2. Assign a `RiskTier` (`low|medium|high` per `RiskBadge`) using a simple, documented, non-random rule (e.g. `immediateDanger === "Yes"` → high; a normal quote/timeline request → low/medium) — write the exact rule in code comments when implemented, since this is a demo heuristic, not a real risk model, and must never be presented as one.
3. Render the result via `ActionRenderer({ actionType, payload, compact: false })` wrapped in a demo-local card shell that visually matches the real Approval Cockpit (materials, `RiskBadge`, receipt-style framing) but is explicitly headed **"Sample — here's what JARVIS would draft from that call"** or equivalent DEMO-labeled copy. No approve/reject buttons that imply a real action executes — this is a proof artifact, not a live control.
4. Persist the same `household`/`nextAction` data exactly as today (`updateHouseholdRecord`, unchanged) so the Act 2 handoff keeps working.

## Handoff into Act 2 — `/demo/lifecycle` (`LifecycleExperience.tsx`)

**Reuse the existing mechanism unchanged**: `writeLifecycleHandoff()`/`readLifecycleHandoff()` (`src/lib/memory/handoff.ts`) already carries `{ householdId, dealerName, zip, tier, services, onWell, customerName, concern }` via `sessionStorage` between the two experiences. Act 1's new termination step calls `writeLifecycleHandoff()` with these fields populated from the `DemoIntakeHandoff`/`HouseholdRecord` it already has, then the CTA on the new result card links to `/demo/lifecycle`, which already knows how to pick up a handoff and skip its own setup form when one exists (confirm this exact behavior in `LifecycleExperience.tsx`'s entry-state logic during implementation — don't assume, verify against the real component).

Visual re-skin of `LifecycleExperience`/`LifecycleSetup`/`TimelineScrubber`/`RecordPanel`/`StageScene` toward the living-water palette (M1's token bridge) happens in M4; the underlying EPA/USGS/geocoding data mechanism and the scrubbable timeline logic are untouched.

## What gets cut

- `src/app/dashboard-demo/page.jsx` and `src/app/demo/[slug]/page.jsx` — both render `PersonalizedDashboardPage`, which is the fake-data ops dashboard. Delete the fake-data-generation path (`generateDashboardData` and its region-based fabricated name/time/phone lists) once confirmed nothing else imports it.
- Replace both route files with a `redirect("/demo")` (Next.js `redirect()` from `next/navigation`, permanent where the framework allows it) rather than deleting the route files outright, so any existing inbound links (footer, external, bookmarked) land somewhere real instead of 404ing.
- The one real feature inside the cut dashboard — the embedded live Vapi call — needs no separate preservation: Act 1 (`/demo`) already is a live Vapi call, it's simply not duplicated.
- `PersonalizedDemoPanel.tsx`, `DemoSetupForm.tsx`'s fake-dashboard-facing code paths, and `/api/demo/[slug]` (which looks up a stored lead and returns a synthesized fake `DemoData` payload) become dead once the cut lands — remove them in the same pass, don't leave them orphaned the way the 5 section files were.

## Files to audit for reuse (M4.T1, decide before T2/T3)

- `PostCallHandoff.tsx` — likely renders a "what happens next" panel after a call; check whether its content survives the new termination point or gets replaced by the new Approval-Cockpit-styled card.
- `WorkflowModule.tsx` — check whether this already visualizes the `workflowType` (water_treatment/well_pump_emergency) distinction in a way worth keeping alongside the new card.
- `ProofArtifacts.tsx` — check what "proof artifacts" currently means in this codebase before deciding whether it duplicates or complements the new receipt-styled framing.

Read each file in full during M4.T1 and write the actual verdict (keep/merge/delete) into the STATE file's M4 block — this doc intentionally doesn't pre-decide those three, since guessing from filenames alone was explicitly the thing this planning pass avoided everywhere else.
