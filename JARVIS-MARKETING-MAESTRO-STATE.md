# JARVIS MARKETING MAESTRO STATE

Convention: same as `JARVIS-MAESTRO-STATE.md`/`JARVIS-FRONTEND-MAESTRO-STATE.md` — a box is checked ONLY with `(evidence: commit sha / screenshot reference / pasted command output)`. `⏸` = blocked on PARAM (reason inline). `Deviation:` lines record where reality differed from the plan and how the task adapted. Sessions work the ACTIVE phase's unchecked tasks top-down and append one Session Log line before ending (§0 End Ritual in JARVIS-MARKETING-MAESTRO-PLAN.md).

**ACTIVE PHASE: M2 — Homepage Act 1: Hero + Stakes + Loop (M0, M1 CLOSED except one ⏸ PARAM bullet).**

## Session Log

- 2026-07-26 · phase M1 · closed T1/T2/T3/T5 same session as M0; T4 (Showtime recordings) is honestly ⏸ PARAM-blocked — no `TEST_OWNER_*` credentials exist anywhere in this environment (checked `.env.local`, `finnor-os/.env*`, `JARVIS-CREDENTIALS-LEDGER.md`), same standing limitation every prior JARVIS D-phase has hit; no footage was faked. T1: re-hued every genuinely accent-purpose color declaration in `globals.css` toward the real `--jm-cyan`/`--jm-teal`/etc. tokens (exact hex copied from `jarvis-theme.css`), left neutral/structural tokens alone, confirmed zero old hardcoded values remain via grep, confirmed live via `getComputedStyle` and a homepage screenshot. T2: built `JarvisProofSurface.tsx` as the single canonical `jarvis-theme.css` import site, verified zero style leakage on a deleted throwaway debug route. T3: built `MarketingOrb.tsx`, a thin unmodified-`Orb3D` wrapper driving a scripted 5-step state loop, verified rendering + zero console errors on a deleted throwaway debug route. T5: reduced-motion probe (throwaway Playwright script, deleted after) confirmed `webgl`→`static` collapse with zero errors either mode; IntersectionObserver/low-power guards inherited unmodified from the already-verified D1 `Orb3D`, not re-proven. Evidence throughout: `tsc --noEmit`/`npm run lint`/`npm run build` all clean (36/36 pages) after every change, including after cleaning up two stale `.next/types` entries left behind by the deleted debug routes · next: M2 — Homepage Act 1 (rewrite Hero.tsx/RevenueLeak.tsx/LiveWorkflow.tsx copy, swap Hero's fake console mock for the new MarketingOrb) · blockers: M1.T4 remains open pending Param's go-ahead on a real owner session; everything else is unblocked.

- 2026-07-26 · phase M0 · closed all 5 tasks same session · did T1 (deleted Credibility/Founder/HowItWorks/Problem/UseCases.tsx after grep-confirming zero real imports — two apparent hits in Footer.tsx were false positives: an anchor label `"#problem"` and unrelated "Founder contact:" text, not references to the components), T2 (removed `gsap`+`split-type` from package.json, `npm install` — 2 packages removed), T3 (`docs/marketing-brand-voice.md`), T4 (`docs/marketing-demo-merge-contract.md`, grounded in the real `DemoIntakeHandoff`/`HouseholdRecord`/`LifecycleHandoff` shapes and `ActionRenderer`/`RiskBadge` prop signatures read directly from source, not guessed), T5 (IA in plan §2.4 confirmed as final, no changes needed). **Real deviation found and fixed, not in the original task list**: post-deletion grep found `gsap`/`ScrollTrigger` still live in `src/components/ui/smooth-scroll.tsx` — the site-wide Lenis wrapper mounted in `layout.tsx` was using `gsap.ticker` to drive Lenis's raf loop and syncing `ScrollTrigger.update()`/`.refresh()`, even though a repo-wide grep confirmed zero remaining `ScrollTrigger` consumers after the 5 files were deleted. Rewrote it to a plain `requestAnimationFrame` loop (dropping the now-pointless ScrollTrigger registration/sync entirely) rather than leaving a live, site-wide file importing an intentionally-removed dependency. Also found and deleted `src/components/ui/split-text.tsx` (self-referencing only, imports both removed deps, would have broken typecheck once the packages were gone). Evidence: `npx tsc --noEmit` clean; `npm run lint` clean (`✔ No ESLint warnings or errors`); `npm run build` clean, 36/36 pages generated (only the pre-existing, unrelated `@sentry/server-utils` ESM warning); repo-wide grep for `gsap`/`split-type` imports returns zero hits outside `node_modules`/lockfiles; live dev-server check via Browser pane confirmed the homepage renders with zero console errors and the rewritten Lenis raf loop actually still smooth-scrolls (`scrollY` moved from 0→800 after a scroll gesture, verified via `window.scrollY` read) · next: M1 — visual token bridge (re-hue `globals.css`, scope-import `jarvis-theme.css`, build the marketing Orb wrapper, capture Showtime recordings) · blockers: none.

## M0 — Foundations & Brand Spine
Status: **COMPLETE.**
- [x] M0.T1 — Delete 5 orphaned section files (evidence: `git rm` of Credibility/Founder/HowItWorks/Problem/UseCases.tsx; grep-confirmed zero real imports beforehand, two false-positive text matches in Footer.tsx documented above)
- [x] M0.T2 — Remove gsap + split-type from package.json (evidence: both lines removed from `package.json`; `npm install` → "removed 2 packages"; also found+fixed a real live consumer, `smooth-scroll.tsx`, and deleted the dead `split-text.tsx` — see Session Log deviation)
- [x] M0.T3 — Write docs/marketing-brand-voice.md (evidence: file committed, includes voice pillars, 6 hard rules, 4 worked before/after examples, self-audit checklist)
- [x] M0.T4 — Write docs/marketing-demo-merge-contract.md (evidence: file committed, grounded in real `DemoIntakeHandoff`/`HouseholdRecord`/`LifecycleHandoff`/`ActionRenderer`/`RiskBadge` shapes read from source)
- [x] M0.T5 — Lock final IA (evidence: plan §2.4 reviewed against this session's findings, no changes required, confirmed final as written)
EXIT GATE: CLOSED. `git status` shows the 5 files deleted (+ `split-text.tsx`, a deviation-documented 6th); zero grep hits for `gsap`/`split-type` outside `node_modules`/lockfiles (pasted above); `tsc --noEmit`/`npm run lint`/`npm run build` all clean (36/36 pages); both new docs committed; live dev-server check clean (zero console errors, smooth-scroll functioning); STATE file updated.

## M1 — Visual Token Bridge + Proof Components
Status: T1-T3 + T5 DONE same session as M0. T4 ⏸ PARAM-blocked (see below) — not fabricated around.
- [x] M1.T1 — Re-hue globals.css light tokens toward --j-* family (evidence: `--jm-cyan`/`--jm-teal`/`--jm-blue`/`--jm-violet`/`--jm-amber`/`--jm-red`/`--jm-green` added to `:root` in `globals.css`, hex values copied verbatim from `jarvis-theme.css`'s real `--j-*` tokens, not re-invented; every genuinely accent-purpose hardcoded rgba/hex in the file re-derived from them — `::selection`, `.healthcare-page` background gradient, `.ops-card-hover`, `.soft-edge`, `.section-kicker` (new `--jm-cyan-ink: #0e7490`, a darkened AA-contrast-safe version since the raw `#22d3ee` fails on white/cream), `.signal-thread`, `.cta-primary:hover`, `.command-surface`, `.signal-sweep`, `.edge-light`, `.status-pulse`. Neutral/structural tokens (body text ink, shadcn `--ring`/`--accent`/`--muted` grays, scrollbar) deliberately left untouched — not in scope for an accent re-hue. Post-edit grep for every old hardcoded value (`72, 145, 199` / `15, 118, 110` / `22, 101, 150` / `30, 91, 141` / `14, 165, 181` / `1e5b8d` / `103, 232, 249` / `20, 184, 166` / `14, 165, 233`) returns zero hits. Live dev-server check: `getComputedStyle(document.documentElement).getPropertyValue('--jm-cyan')` → `"34, 211, 238"` (exact match), homepage screenshot confirmed the dark console mock's "Ringing"/"LIVE"/"INCOMING CALL" chips now show the real cyan/teal hue, zero console errors.)
- [x] M1.T2 — Scope-import jarvis-theme.css under a marketing .jarvis-root wrapper (evidence: new `src/components/sections/jarvis-proof/JarvisProofSurface.tsx` — single canonical import site for `jarvis-theme.css`, confirmed via source read that the stylesheet only ever declares custom properties under `.jarvis-root`-scoped selectors and never paints a page-level background/color itself, so wrapping is genuinely sufficient. Verified zero leakage on a throwaway debug route (deleted before commit, same convention as C2/C3/D1): a light `.ops-card`/`.section-kicker` outside the wrapper stayed fully light/unaffected, while content inside rendered `--j-bg` dark with real `--j-cyan`/`--j-teal` accents — screenshotted both side by side.)
- [x] M1.T3 — Build marketing Orb wrapper (evidence: new `src/components/sections/jarvis-proof/MarketingOrb.tsx` — imports the real `Orb3D` completely unmodified, drives it with a 5-step scripted `OrbState` sequence (idle→planning→executing×3 activeRunCounts, ~9.8s loop) via a plain `setTimeout` chain. Verified live on a throwaway debug route: real GPU particle sphere rendered (screenshotted), zero console errors. Deleted the debug route before commit.)
- [ ] M1.T4 — Capture real Showtime screen recordings — **⏸ PARAM-BLOCKED, not attempted around.** `Showtime.tsx:86-92` hard-gates on a signed-in session AND `role==="owner"` AND the Dealer Zero tenant; grepped `.env.local`/`finnor-os/.env*`/`JARVIS-CREDENTIALS-LEDGER.md` for `TEST_OWNER_*` credentials — none exist, confirming this is the same standing, project-wide, repeatedly-documented limitation every prior D-phase (`JARVIS-MAESTRO-STATE.md` D1/D2/D5/D6) hit: no real Supabase owner account exists in this environment, and creating one without Param's explicit go-ahead is off-limits. No footage was faked or substituted.
- [x] M1.T5 — Verification pass (evidence: reduced-motion probe via a throwaway Playwright script (deleted before commit, same convention as C2/D1) against the MarketingOrb debug route — `emulateMedia({reducedMotion:'reduce'})` correctly flipped `data-orb-mode` from `webgl`→`static` with zero page/console errors in either mode. IntersectionObserver-pause and low-device-memory collapse are inherited byte-for-byte from `Orb3D` — zero lines of that logic were touched by `MarketingOrb`, so not re-proven from scratch; already real-verified in the D1 phase per `JARVIS-FRONTEND-MAESTRO-PLAN.md` §1.)
EXIT GATE: 2 of 3 bullets closed. Re-hued tokens + Orb wrapper working with real screenshots, reduced-motion clean (pasted above). Showtime recordings bullet stays honestly open pending Param's go-ahead on a real owner session — same category of gap as every prior D-phase, not something this session improvised around.

## M2 — Homepage Act 1: Hero + Stakes + Loop
Status: NOT STARTED.
- [ ] M2.T1 — Rewrite Hero.tsx (copy + Orb swap)
- [ ] M2.T2 — Rewrite RevenueLeak.tsx copy
- [ ] M2.T3 — Rewrite LiveWorkflow.tsx copy ("the loop")
EXIT GATE: not yet closed.

## M3 — Homepage Act 2: Command Bridge Proof + Memory
Status: NOT STARTED.
- [ ] M3.T1 — Build Command Bridge proof section
- [ ] M3.T2 — Reframe/consolidate Solution.tsx + Outcome.tsx
- [ ] M3.T3 — Reframe PersonalizedDemoBuilder.tsx into single CTA
EXIT GATE: not yet closed.

## M4 — The Merged Demo
Status: NOT STARTED.
- [ ] M4.T1 — Audit PostCallHandoff/WorkflowModule/ProofArtifacts for reuse vs deletion
- [ ] M4.T2 — Re-terminate DemoExperience into Approval-Cockpit-styled card
- [ ] M4.T3 — Chain Act 1 into LifecycleExperience as Act 2, re-skin
- [ ] M4.T4 — Cut /dashboard-demo + /demo/[slug] fake-dashboard path, add redirects
EXIT GATE: not yet closed.

## M5 — Pricing + FAQ
Status: NOT STARTED.
- [ ] M5.T1 — Rewrite Pricing.tsx
- [ ] M5.T2 — Rewrite FAQ.tsx
EXIT GATE: not yet closed.

## M6 — Onboarding, Resources, Trust, CTA/Footer, Concierge
Status: NOT STARTED.
- [ ] M6.T1 — Rewrite FirstSevenDays.tsx
- [ ] M6.T2 — Reframe resources/* pages
- [ ] M6.T3 — Update trust-safety/privacy/terms copy
- [ ] M6.T4 — Update Cta/Footer/ContactForm + FinnorAIConcierge copy pass
EXIT GATE: not yet closed.

## M7 — Polish, SEO, Performance, Cutover
Status: NOT STARTED.
- [ ] M7.T1 — Rewrite site-wide metadata/OG + site.ts
- [ ] M7.T2 — Lighthouse run on rebuilt homepage + /demo
- [ ] M7.T3 — Cross-browser/responsive spot-check
- [ ] M7.T4 — Final full-site walkthrough + link audit
EXIT GATE: not yet closed.
