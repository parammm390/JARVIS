# JARVIS MARKETING MAESTRO PLAN v1 — THE SITE BECOMES THE PRODUCT

**Planned by:** Sonnet 5 (high) · 2026-07-26 · source-verified against the real tree the same day
**Executed by:** Sonnet 5 sessions, one phase in focus per session; 2-session phases are normal.
**State file:** `/Users/paramdave/FINNOR/JARVIS-MARKETING-MAESTRO-STATE.md` — same checkbox+evidence convention as the other two maestro plans.
**Relationship to the other plans:** INDEPENDENT of `JARVIS-MAESTRO-PLAN.md` (backend) and `JARVIS-FRONTEND-MAESTRO-PLAN.md` (the authenticated `/jarvis` console, F-track). This plan owns exactly one surface: **the public marketing site** — `src/app/page.tsx`, `src/components/sections/*`, `src/app/demo/*`, `src/app/dashboard-demo/`, `src/app/resources/*`, `src/app/{trust-safety,privacy,terms}`, `src/config/site.ts`, `src/app/layout.tsx`'s metadata, and `src/app/globals.css`. It never touches `finnor-os/`, `src/components/jarvis/*`, or `src/app/jarvis/*` except to **read** presentational components for reuse (§6 draws the exact line).
**Mission:** finnorai.com currently markets a small, generic "AI phone agent answers after-hours calls" product with copy/visuals that have zero relationship to JARVIS — the real, mostly-built AI operations platform this company has spent ~20 days on. Rebuild the site — copy and visuals both — to be entirely about JARVIS, at a genuinely brilliant craft bar, reusing the real visual language and components JARVIS already has rather than inventing a new design system.

---

## §0 — EXECUTION PROTOCOL (mandatory, every session)

**Kickoff prompt Param pastes (the only thing he ever types):**

> Read /Users/paramdave/FINNOR/JARVIS-MARKETING-MAESTRO-PLAN.md §0–§2 fully, plus the target phase's §4 section, then /Users/paramdave/FINNOR/JARVIS-MARKETING-MAESTRO-STATE.md fully. Execute phase **<M-ID>**: work its unchecked tasks top-down per §0. Evidence for every checkbox. Close with the End Ritual.

### Start Ritual
1. Read this plan's §0–§2, the target phase's §4 section in full, and its block in the STATE file.
2. Read every file on the phase's `Read:` line before writing anything. Where it says `discover:`, run that discovery first.
3. Orient: `git log --oneline -8` + `git status` at repo root. Note anything dirty before touching it.
4. If the STATE file shows the phase complete, say so and stop — never redo green work. If a prereq phase isn't closed, stop and report.
5. **Never touch `finnor-os/`, `src/components/jarvis/*`, or `src/app/jarvis/*`** except to read a component listed in §2's reuse table. If a phase seems to need a change inside those trees, stop — that's scope creep into the other two plans, flag it, don't improvise it here.

### Work Loop
- Tasks strictly in order (T1, T2, …). Commit per task or coherent group, message style matching repo history.
- A checkbox is checked ONLY after its verification ran, with `(evidence: …)` — commit sha, screenshot reference, pasted command output. Mirror the other STATE files' evidence style exactly.
- `Deviation:` lines for small adaptations; STOP and write findings (not code) if reality differs in a way that changes the narrative/IA — don't silently improvise brand direction.
- **Reuse before build**: §2 names the exact JARVIS components/tokens available for reuse. Grep before creating a parallel version of anything (a second Orb, a second glass-card recipe, a second toast system).

### Hard rules
1. **Verify then claim** — no asserted-but-unprobed "done." A phase isn't closed on vibes; it's closed on a pasted build/lint/typecheck result and a real screenshot.
2. **Honesty rules bind here too** (inherited from the other two plans, non-negotiable on a marketing site especially): never "AI receptionist"; never fabricate a number, testimonial, or metric; any demo/sandbox/synthetic content gets an explicit DEMO/SAMPLE label; never claim a capability that isn't real in the actual product.
3. **No new runtime deps without a listed approval.** `framer-motion`, `three`, `lucide-react`, `@vapi-ai/web`, `lenis`, Tailwind, Playwright are all already in-tree and fair game. `gsap`/`split-type` are being REMOVED this track (§4 M0), not added to. Anything else — ask first.
4. **Perf discipline for reused JARVIS components.** `Orb3D` and the atmosphere/fx layer are real GPU/animation work — every reuse on a marketing page must keep the same IntersectionObserver-pause, `prefers-reduced-motion` fallback, and low-device-memory collapse `Orb3D` already ships with. Never strip those guards to "simplify" a marketing usage.
5. **One visual system, bridged, not duplicated.** `globals.css`'s light tokens get re-hued toward `--j-*`; `jarvis-theme.css` gets scope-imported for dark/proof sections under a marketing-local `.jarvis-root` wrapper. Never hand-copy JARVIS's CSS values into a third, parallel token set.
6. **Copy discipline.** Every headline/subhead/CTA gets checked against §2's brand-voice codex before it's considered done. "Technically accurate but flat" is not the bar — re-draft, don't ship the first pass.
7. **Charts** (if any land in the rebuilt site — e.g. the missed-call-cost calculator, forecast-style proof visuals): load the `dataviz` skill before writing chart code, same rule as the other two plans.

### Verification toolkit
- **Local preview**: `npm run dev` (root), navigate the touched route(s), screenshot key states. Use the Browser pane tools, not a description of what should render.
- **Always before a commit**: `tsc --noEmit`, `npm run lint`, `npm run build` clean.
- **Visual regression**: extend `e2e/jarvis-visual-snapshots.spec.ts`'s sibling convention for marketing routes if/when a dedicated marketing snapshot spec exists (M1 decides whether to start one); otherwise a dated screenshot in the STATE evidence line is the interim proof.
- **Reduced-motion probe**: for any reused JARVIS motion component, `page.emulateMedia({reducedMotion:'reduce'})` + assert zero console/pageerror, same method the other two plans established.
- **Lighthouse**: run once real JARVIS visual components (Orb, atmosphere) land on a public page (M7 formally, but spot-check earlier if a phase adds one).

### Context budget + End Ritual
Same as the other plans: at ~25–30% context left, stop starting new tasks, run the End Ritual. Multi-session phases are normal and planned for.

1. Run `tsc --noEmit` / `npm run lint` / `npm run build`; paste results.
2. Commit everything.
3. Update the STATE file: checkboxes + evidence, one Session Log line (`date · phase · tasks done · next task · blockers`).
4. Final report to Param: what shipped in plain language, evidence pasted, exact next kickoff line.

---

## §1 — Ground truth baseline (source-verified 2026-07-26)

- The marketing site and the JARVIS console are **the same Next.js app** (one `package.json`, one `src/app` tree). `finnor-os/` is the separate backend monorepo. This means direct import of JARVIS presentational components into marketing pages is an intra-app import, not a cross-repo integration — cheap, not risky, as long as §0 hard rule 5 (bridge, don't duplicate) is followed.
- Homepage (`src/app/page.tsx`) renders, in order: `Hero`, `RevenueLeak`, `LiveWorkflow`, `PersonalizedDemoBuilder`, `Solution`, `Outcome`, `Pricing`, `FirstSevenDays`, `FAQ`, `Cta`, `Footer` — all under `src/components/sections/`. All current copy is "after-hours call answering" framed; metadata title site-wide is *"Finnor AI | Never Lose Another After-Hours Water Call."*
- **5 dead files, confirmed unimported anywhere**: `Credibility.tsx`, `Founder.tsx`, `HowItWorks.tsx`, `Problem.tsx`, `UseCases.tsx` (all under `src/components/sections/`) — remnants of an even earlier, darker design era. They are the **only** files in the whole marketing site that import `gsap`/`split-type`.
- **Three demo builders exist today, all real mechanisms** (not mockups):
  - `/demo` (`DemoExperience.tsx` + `/api/generate-demo`) — real website scrape of the visitor's own company → real Gemini LLM company profile → real live Vapi voice call configured as that company → transcript extracted into a structured lead record. The most sophisticated and most worth keeping.
  - `/demo/lifecycle` (`LifecycleExperience.tsx` + `/api/lifecycle/*`) — real live public water-quality data (EPA SDWIS, USGS Water Quality Portal, FCC/zippopotam geocoding) for a ZIP, played as a scrubbable ~2-year household narrative ("the call was minute one, this is the next two years").
  - `/dashboard-demo` (**identical component to** `/demo/[slug]`, confirmed literally the same file) — an intake form generates a fake "operations dashboard" where the call log/names/times are deterministically hash-faked; the one real piece is an embedded live Vapi call, already duplicated in `/demo`.
- `/jarvis/showtime` is real, DEMO-labeled, and already shipped (main-plan D8) — but it is owner-only and hard-gated to the internal Dealer Zero tenant (`Showtime.tsx:86-92`: *"Showtime is available only to the labeled Dealer Zero demo tenant"*). It cannot be exposed to a public visitor without real backend scope change — out of bounds for this plan (§6).
- Reusable JARVIS presentational components, confirmed clean to import:
  - `src/components/jarvis/bridge/Orb3D.tsx` — `Orb3D({ live: OrbLiveState, forceLowPower? })` (line 149), no data-fetching coupling, already driven by scripted state in `Showtime.tsx`. IntersectionObserver-pause, reduced-motion/low-device-memory fallback built in — never strip these when reusing.
  - `src/components/jarvis/atmosphere.tsx` — aurora/caustic/bubble field, `Glass`/`GRAIN`/`GLOW_SHADOW` exports.
  - `src/components/jarvis/ui/fx/*` — BorderBeam, ParticleBurst, Glow.
  - `src/components/jarvis/ui/renderers/{registry,ActionRenderer}.tsx` + `ui/primitives/RiskBadge.tsx` — for the merged-demo's Approval-Cockpit-styled result card (M4).
  - `src/components/jarvis/jarvis-theme.css` — the `--j-*` token set, scoped to `.jarvis-root`.
- Marketing site's own tech: `framer-motion` is the real, dominant, working animation library (28 live files). `gsap`+`split-type` are dead weight (only the 5 orphaned files). `lenis` (global smooth-scroll) stays, orthogonal to this.
- Marketing visual system (`src/app/globals.css`): a light `healthcare-page` cream/sky/teal theme, plus an embedded darker `command-surface` sub-theme used for existing fake console mockups (Hero, Pricing cards, the dashboard demo's call console). Zero shared tokens with `jarvis-theme.css` today.
- Resources (`src/app/resources/*`) — a real glossary, a real interactive missed-call-cost calculator, a real pilot-setup checklist. All water-treatment-vertical-appropriate, currently angled at call-answering ROI.
- Pricing (`Pricing.tsx`) — 3-tier ladder (no visible dollar figures, all CTAs say "book a demo"), plus a guarantee block (response/launch/route guarantees). Structurally sound pattern, entirely call-answering-scoped content today.
- `FinnorAIConcierge.tsx` — a separate, site-wide floating rule-based chat widget mounted in `layout.tsx`, describing FINNOR as an "AI booking and lead recovery system." Not one of the three demo builders; in scope for a copy pass (M6) since it's part of the site-wide chrome.

---

## §2 — THE CODEX: brand voice, narrative, and the visual bridge

### 2.1 — Thesis
JARVIS turns an instruction into an approved, executed, evidenced business action. The site's whole job is to make a visitor feel that — not read a feature list. Every section should answer "what does JARVIS actually do, right now, for real" better than the last. **Spectacle and honesty are the same feature here too**: if a visual can't be tied to something JARVIS genuinely does, cut it.

### 2.2 — Brand voice rules (binding on every line of copy written under this plan)
- **Never "AI receptionist."** Not as a synonym, not in a testimonial, not in alt text.
- **Ask, don't decide, when the product is ambiguous about a real limitation.** If a claim would need a hedge to stay honest, either substantiate it plainly or cut it — never bury the hedge in fine print while the headline overclaims.
- **Disqualification beat**: somewhere on the site (today it's the FAQ's "who this is NOT for" + `Outcome.tsx`'s boundaries section), state plainly who JARVIS is not a fit for. Keep this — it's a credibility move, not a hedge, and JARVIS's own honesty-first design (visible approval gates, receipts, labeled sandboxes) makes this an easy, authentic beat to keep making.
- **No invented numbers.** Every stat on the site must trace to something real (a computed value, a documented guarantee, a real capability) — never a plausible-sounding placeholder.
- **Technically accurate is the floor, not the bar.** A correct-but-flat sentence gets rewritten. Read every draft headline out loud before shipping it.
- **Voice-agent demotion, concretely**: the after-hours phone-answering capability is real and stays in the product, but it is never the headline, never a tier name, never the first thing a section leads with. It shows up as: one line in "the loop" section (equal weight to text/typed-command as an input channel), one FAQ question, one Pricing line-item. Nowhere else, and nowhere with outsized visual weight.

### 2.3 — Visual bridge (the concrete mechanism, not vibes)
- Light, copy-heavy sections (stakes, pricing, FAQ, resources) stay light for readability/conversion, but re-hued: swap generic sky/teal SaaS-blue for the real `--j-cyan`/`--j-teal`/`--j-violet` family so light and dark sections read as one material.
- Dark, proof-driven sections (Hero's Orb, the Command Bridge showcase, the merged demo's Act-1 result card) import `jarvis-theme.css` scoped under a marketing-local `.jarvis-root` wrapper (never merge into `globals.css` directly — keeps marketing layout decoupled from JARVIS's own theme evolution) and reuse the real components listed in §1.
- `framer-motion` only for new/rewritten motion. No new `gsap`/`split-type` call sites — ever, per hard rule 3.

### 2.4 — Site narrative arc (homepage, section by section)
1. **Hero** — the capability, not the channel: instruction → planned → approved → executed → receipt. Orb replaces the current fake console mock.
2. **Stakes** (reframed `RevenueLeak`) — decisions with no memory/receipt/consistency; a missed call is one small instance of this, not the whole story.
3. **The loop** (reframed `LiveWorkflow`) — instruction → plan → human approval gate → execute → receipt, told simply. Voice gets its one low-key mention here.
4. **Command Bridge proof** (new section) — the real console: Orb, Pipeline Theater, activity feed. "This is the actual product, not a mockup."
5. **Memory / household-360** (evolved `Solution`+`Outcome`) — promotes the Lifecycle demo's two-year-memory thesis to a first-class homepage beat.
6. **Try it on your business** (reframed `PersonalizedDemoBuilder`) — one CTA into the merged `/demo`.
7. **Pricing** (reframed `Pricing`) — same tier/guarantee structure, JARVIS-platform content.
8. **Onboarding** (reframed `FirstSevenDays`) — same weekly-reveal structure, JARVIS setup content (policies, approval rules, integrations).
9. **FAQ** — full rewrite, keeps the disqualification beat.
10. **CTA + Footer** — structure kept, one collapsed demo link.

### 2.5 — The demo merge (binding contract for M4)
- **Act 1 = `/demo`** (unchanged scrape+Gemini+live-Vapi-call mechanism). Only its *termination* changes: the transcript-extracted lead renders as a real JARVIS-styled Approval Cockpit card (reusing `RiskBadge`/`ActionRenderer`), explicitly labeled DEMO — never routed to the old fake ops dashboard again.
- **Act 2 = `/demo/lifecycle`** (unchanged EPA/USGS/geocoding mechanism), chained directly after Act 1, re-skinned toward the living-water palette, copy reframed.
- **Cut entirely**: `/dashboard-demo` and `/demo/[slug]`'s fake-dashboard rendering path — redirect both routes to `/demo`. Its one real feature (embedded Vapi call) already lives in Act 1.
- `/jarvis/showtime` stays gated and untouched; its value to this plan is screen-recorded footage only (captured in M1), never a live public embed.

---

## §3 — CUT / REFRAME / KEEP AUDIT

| File / route | Verdict | Landing phase |
|---|---|---|
| `Hero.tsx` | Reframe — shell kept, copy + console mock (→ real Orb) rewritten | M2 |
| `RevenueLeak.tsx` | Reframe — structure kept, content rewritten | M2 |
| `LiveWorkflow.tsx` | Reframe — becomes "the loop" | M2 |
| `PersonalizedDemoBuilder.tsx` | Reframe into one CTA | M3 |
| `Solution.tsx`, `Outcome.tsx` | Reframe/consolidate | M3 |
| `Pricing.tsx` | Keep structure, full content rewrite | M5 |
| `FirstSevenDays.tsx` | Keep structure, full content rewrite | M6 |
| `FAQ.tsx` | Full rewrite | M5 |
| `Cta.tsx`, `Footer.tsx`, `ContactForm.tsx` | Keep structure, update copy/links | M6 |
| `Credibility.tsx`, `Founder.tsx`, `HowItWorks.tsx`, `Problem.tsx`, `UseCases.tsx` | **Delete** | M0 |
| `DemoExperience.tsx` | Keep, re-terminate output | M4 |
| `LifecycleExperience.tsx` | Keep, re-skin + reframe | M4 |
| `/dashboard-demo`, `/demo/[slug]` fake-dashboard path | **Cut**, redirect to `/demo` | M4 |
| `PostCallHandoff.tsx`, `WorkflowModule.tsx`, `ProofArtifacts.tsx` | Audit for reuse vs. deletion | M4 |
| `resources/*` (glossary, calculator, checklist) | Keep, reframe angle | M6 |
| `trust-safety`, `privacy`, `terms` | Keep, light content update | M6 |
| `FinnorAIConcierge.tsx` | Keep, copy pass | M6 |
| `gsap`, `split-type` deps | Remove from `package.json` | M0 |
| `src/app/layout.tsx` metadata, `src/config/site.ts` | Full rewrite | M7 |

---

## §4 — THE PHASES

### M0 — Foundations & Brand Spine (1 session)
Read: this plan §1/§2/§3 in full · `src/components/sections/*` (all 16 files, to confirm the dead-file list before deleting) · `package.json`.
- T1 Delete the 5 confirmed-orphaned files (`Credibility.tsx`, `Founder.tsx`, `HowItWorks.tsx`, `Problem.tsx`, `UseCases.tsx`); grep-confirm zero remaining imports first.
- T2 Remove `gsap` and `split-type` from `package.json`; `npm install`; grep-confirm zero remaining imports anywhere in `src/`.
- T3 Write `docs/marketing-brand-voice.md` (or similar) — a standalone, concrete copy-voice standard: the §2.2 rules plus 4-6 worked example headline/subhead pairs at the actual bar this plan wants, so later phases have a written reference rather than re-deriving tone from this plan file each time.
- T4 Write `docs/marketing-demo-merge-contract.md` — the §2.5 contract expanded into an implementable spec: exact prop/data shape the Act-1 termination hands to the Approval Cockpit card, exact handoff shape into Act 2, exact redirect rules for the two cut routes.
- T5 Lock the IA (§2.4) as final — if anything from the exploration/planning phase needs to change, change it here in writing, not mid-phase later.
EXIT GATE: `git status` shows the 5 files deleted, zero grep hits for `gsap`/`split-type` outside `node_modules`/lockfiles; `tsc --noEmit`/`npm run lint`/`npm run build` clean; both new docs committed; STATE file updated.

### M1 — Visual Token Bridge + Proof Components (1–2 sessions)
Read: `src/app/globals.css` in full · `src/components/jarvis/jarvis-theme.css` · `src/components/jarvis/bridge/Orb3D.tsx` · `src/components/jarvis/atmosphere.tsx` · `src/components/jarvis/ui/fx/*` · discover: `grep -rn "jarvis-root" src/components/jarvis` to confirm the exact scoping contract before reusing it.
- T1 Re-hue `globals.css`'s light-mode tokens toward the real `--j-cyan`/`--j-teal`/`--j-violet` family (values pulled from `jarvis-theme.css`, not re-invented). Verify no regression on live pages via screenshot diff.
- T2 Scope-import `jarvis-theme.css` for marketing dark/proof sections under a `.jarvis-root`-wrapped marketing component (confirm this doesn't leak `.jarvis-root` styles onto unrelated marketing chrome — test both ways).
- T3 Build a thin marketing-side Orb wrapper component driving `Orb3D` with a scripted/autoplay `OrbState` sequence (idle→planning→executing loop) suitable for a public Hero — reuse `Orb3D` unmodified, don't fork it.
- T4 Capture real `/jarvis/showtime` screen recordings (owner session) for later use in Hero/Command-Bridge-proof sections — labeled footage, not live embeds.
- T5 Verification: reduced-motion probe on the new Orb wrapper and any reused atmosphere/fx pieces; confirm IntersectionObserver-pause and low-device-memory fallback survive marketing-page usage (not just their original Bridge context).
EXIT GATE: before/after screenshots of the re-hued light tokens · Orb wrapper working on a throwaway route with reduced-motion clean · Showtime recordings captured and stored · build/lint/typecheck clean.

### M2 — Homepage Act 1: Hero + Stakes + Loop (1–2 sessions)
Read: `Hero.tsx`, `RevenueLeak.tsx`, `LiveWorkflow.tsx` in full · `docs/marketing-brand-voice.md` (M0.T3) · M1's Orb wrapper.
- T1 Rewrite `Hero.tsx`: new headline/subhead per §2.4 beat 1, swap the fake console mock for M1's Orb wrapper, keep the existing CTA button shell (link targets updated in M6 once the merged demo route is final, or updated here if already known).
- T2 Rewrite `RevenueLeak.tsx` copy per §2.4 beat 2, same card-grid structure.
- T3 Rewrite `LiveWorkflow.tsx` copy per §2.4 beat 3 ("the loop"), same diagram/step-card structure; this is where voice gets its one low-key mention.
EXIT GATE: screenshots of all three rewritten sections · copy checked against the brand-voice doc line by line · build/lint/typecheck clean · reduced-motion clean on the new Hero Orb.

### M3 — Homepage Act 2: Command Bridge Proof + Memory (1–2 sessions)
Read: `Solution.tsx`, `Outcome.tsx`, `PersonalizedDemoBuilder.tsx` · M1's reusable components · `LifecycleExperience.tsx` (for the memory-thesis language to promote).
- T1 Build the new Command Bridge proof section (§2.4 beat 4) using M1's reusable atmosphere/fx pieces and Showtime footage.
- T2 Reframe/consolidate `Solution.tsx`+`Outcome.tsx` into the memory/household-360 beat (§2.4 beat 5); decide during this phase whether they merge into one section or stay two, based on how the copy actually reads.
- T3 Reframe `PersonalizedDemoBuilder.tsx` into the single "try it on your business" CTA (§2.4 beat 6) — link target is the merged `/demo` (M4 may not be done yet; if so, point at current `/demo` and revisit once M4 ships).
EXIT GATE: screenshots of all sections · copy checked against brand-voice doc · build/lint/typecheck clean.

### M4 — The Merged Demo (2 sessions, highest-risk phase)
Read: `docs/marketing-demo-merge-contract.md` (M0.T4) · `DemoExperience.tsx`, `/api/generate-demo/route.ts` in full · `LifecycleExperience.tsx`, `/api/lifecycle/*` in full · `src/app/dashboard-demo/`, `src/app/demo/[slug]/page.jsx` · `src/components/jarvis/ui/renderers/{registry,ActionRenderer}.tsx`, `ui/primitives/RiskBadge.tsx` · `PostCallHandoff.tsx`, `WorkflowModule.tsx`, `ProofArtifacts.tsx`.
- T1 Audit `PostCallHandoff.tsx`/`WorkflowModule.tsx`/`ProofArtifacts.tsx` — decide reuse vs. deletion per component, document the decision.
- T2 Re-terminate `DemoExperience`'s post-call flow: instead of routing to the fake ops dashboard, render the transcript-extracted lead as a JARVIS-styled Approval Cockpit card (`RiskBadge`/`ActionRenderer` reuse), labeled DEMO, per the merge contract's exact data shape.
- T3 Chain Act 1 into `LifecycleExperience` as Act 2 — wire the existing `readLifecycleHandoff()` path (already built for this) into the new termination point; re-skin `LifecycleExperience`'s visuals toward the living-water palette; reframe its copy.
- T4 Cut `/dashboard-demo` and `/demo/[slug]`'s fake-dashboard rendering; add redirects to `/demo`; delete the now-dead fake-data-generation code (`generateDashboardData` and its region-based name lists) once confirmed nothing else depends on it.
EXIT GATE: full live walkthrough recorded (or a labeled fixture walkthrough if a live Vapi call can't be triggered in this environment) showing Act 1 → Approval Cockpit card → Act 2 in one flow · both old routes redirect correctly · zero fabricated-data surfaces remain on the site · build/lint/typecheck clean.

### M5 — Pricing + FAQ (1 session)
Read: `Pricing.tsx`, `FAQ.tsx` in full · `docs/marketing-brand-voice.md`.
- T1 Rewrite `Pricing.tsx` tier/guarantee content around JARVIS platform capabilities, same 3-tier/no-visible-price/guarantee-block structure. Voice/after-hours handling becomes a line-item, not a tier name.
- T2 Rewrite `FAQ.tsx` fully — new question set built around approvals, receipts, memory, honesty, and exactly one low-key voice question; keep the disqualification beat ("who this is NOT for").
EXIT GATE: screenshots · copy checked against brand-voice doc · build/lint/typecheck clean.

### M6 — Onboarding, Resources, Trust, CTA/Footer, Concierge (1–2 sessions)
Read: `FirstSevenDays.tsx` · `resources/*` (all 4 sub-pages + components) · `trust-safety`/`privacy`/`terms` pages · `Cta.tsx`, `Footer.tsx`, `ContactForm.tsx` · `FinnorAIConcierge.tsx`.
- T1 Rewrite `FirstSevenDays.tsx` around JARVIS setup (policies, approval rules, integrations), same weekly-reveal structure.
- T2 Reframe the 4 resources pages' angle (call-answering ROI → JARVIS ROI); keep the real calculator/glossary/checklist mechanisms unchanged.
- T3 Update `trust-safety`/`privacy`/`terms` copy toward the real approval-gate/receipt/honesty machinery where currently generic.
- T4 Update `Cta.tsx`/`Footer.tsx` copy and collapse Footer's demo links to the one merged `/demo`; light copy pass on `FinnorAIConcierge.tsx`.
EXIT GATE: screenshots of all touched pages · build/lint/typecheck clean.

### M7 — Polish, SEO, Performance, Cutover (1–2 sessions)
Read: `src/app/layout.tsx` (metadata block) · `src/config/site.ts` · discover: current Lighthouse baseline on the live site before changes, for comparison.
- T1 Rewrite site-wide metadata/OG/Twitter card content in `layout.tsx` and `page.tsx` (title is "Never Lose Another After-Hours Water Call" site-wide today — full replacement) and `src/config/site.ts`'s tagline/description.
- T2 Lighthouse run on the rebuilt homepage + `/demo` now that Orb/atmosphere are real GPU/animation work on public pages — confirm perf discipline (hard rule 4) held under real marketing-page conditions, not just its original Bridge context.
- T3 Cross-browser/responsive spot-check (the JARVIS Bridge itself is documented as non-responsive below ~1100px in the F-track plan — confirm the marketing reuse of Orb/atmosphere does NOT inherit that limitation, since a marketing page must work on mobile).
- T4 Final full-site walkthrough, screenshot every route, confirm every internal link resolves, confirm both cut routes (`/dashboard-demo`, `/demo/[slug]`) redirect correctly.
EXIT GATE: Lighthouse numbers pasted · mobile screenshot set · full link-audit pasted · build/lint/typecheck clean · Param sign-off before any production deploy (per this session's standing rule: local changes only until explicitly told to ship).

---

## §5 — Phase order

M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7, strictly in order. M0 gates everything (no copy written against an unlocked IA/voice standard). M1 gates M2–M4 (nothing reuses a JARVIS visual component until the bridge exists). M4 is the riskiest/most novel phase and runs right after M1 rather than last, so problems surface with runway left to fix them.

---

## §6 — NON-COLLISION CONTRACTS (binding)

- **`finnor-os/` (backend)**: zero changes, ever, from this plan. Any marketing need for backend data (e.g. a real stat) must go through an existing public API/read-model — never a new backend route authored under this plan.
- **`src/components/jarvis/*`, `src/app/jarvis/*` (the authenticated console, F-track owned)**: read-only reuse of the specific components named in §1/§2.3. Never edited, never forked into a marketing-local copy that then drifts. If a marketing need requires a change to one of these files (e.g. a new prop), that change is proposed to whoever is executing `JARVIS-FRONTEND-MAESTRO-PLAN.md`, not made unilaterally here.
- **`/jarvis/showtime`**: never exposed publicly or embedded live from this plan. Recorded footage only (M1.T4). A future "public Showtime" is an explicit backlog item for the JARVIS-MAESTRO track, not this one.
- **Deployment**: this plan makes local changes only. Pushing to production (`vercel --prod` or equivalent) requires Param's explicit go-ahead each time, same standing rule as everywhere else in this project.
