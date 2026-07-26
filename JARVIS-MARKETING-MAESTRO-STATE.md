# JARVIS MARKETING MAESTRO STATE

Convention: same as `JARVIS-MAESTRO-STATE.md`/`JARVIS-FRONTEND-MAESTRO-STATE.md` — a box is checked ONLY with `(evidence: commit sha / screenshot reference / pasted command output)`. `⏸` = blocked on PARAM (reason inline). `Deviation:` lines record where reality differed from the plan and how the task adapted. Sessions work the ACTIVE phase's unchecked tasks top-down and append one Session Log line before ending (§0 End Ritual in JARVIS-MARKETING-MAESTRO-PLAN.md).

**ACTIVE PHASE: M1 — Visual Token Bridge + Proof Components (M0 CLOSED).**

## Session Log

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
Status: NOT STARTED.
- [ ] M1.T1 — Re-hue globals.css light tokens toward --j-* family
- [ ] M1.T2 — Scope-import jarvis-theme.css under a marketing .jarvis-root wrapper
- [ ] M1.T3 — Build marketing Orb wrapper (scripted OrbState sequence)
- [ ] M1.T4 — Capture real Showtime screen recordings
- [ ] M1.T5 — Verification pass (reduced-motion, IntersectionObserver, low-power)
EXIT GATE: not yet closed.

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
