# P1 production publish — 2026-08-02

## Authorization and scope

- The user explicitly authorized production publishing in the request to publish Phase 1 and all completed work.
- Deployment source was the current dirty authoritative worktree at `/Users/paramdave/FINNOR`.
- Scope remained the linked Vercel project `finnor-agency` and canonical route `/jarvis`; `/demo` was not edited or opened for this verification.

## Pre-deploy gates

- `npx tsc --noEmit --pretty false` — exit 0.
- Focused ESLint over the changed JARVIS/layout TSX owners — exit 0.
- `npm run test:unit -- --reporter=dot` — 32 test files passed; 358 tests passed.
- `git diff --check` — exit 0.
- `npx vercel pull --yes --environment=production` — completed; production environment file was created under ignored `.vercel/` state.
- `npx vercel build --prod` — completed; `.vercel/output` was generated and the Next.js production artifact completed successfully.

## Deployment

- Command: `npx vercel deploy --prebuilt --prod --yes`.
- Deployment ID: `dpl_Hfe5zcdLJGCN6LZhuPNpmiLmpskD`.
- Deployment URL: `https://finnor-agency-r39r7ge8z-bloodride2-3212s-projects.vercel.app`.
- Target/state from `vercel inspect`: `production` / `READY`.
- Aliases: `https://finnorai.com`, `finnor-agency.vercel.app`, and the project aliases returned by inspect.
- Framework: Next.js; Vercel build metadata reports Node.js `24.x`.
- Inspect output includes `/jarvis` and `/api/jarvis/[...path]` outputs in the ready deployment.
- The deployment metadata reports `gitDirty=1`; no clean commit or fabricated commit association is claimed. The deployed artifact is the tested dirty worktree.

## Post-deploy verification

- `vercel curl /jarvis --deployment dpl_Hfe5zcdLJGCN6LZhuPNpmiLmpskD -- --head` — HTTP/2 200; `x-matched-path: /jarvis`; HTML content length 17365 bytes.
- `curl https://finnorai.com/jarvis` — HTTP/2 200; `content-type: text/html; charset=utf-8`; `x-matched-path: /jarvis`.
- `npx vercel logs --level error --since 1h --no-follow --no-branch --json` — no error rows returned.
- The signed-in Chrome owner tab at `https://finnorai.com/jarvis` was reloaded read-only after deployment. The rendered body contains `Needs attention`, `Diagnostics`, `Finish setup to unlock every action.`, `6 connections need attention.`, `Review setup`, `View setup details`, `Tell JARVIS what you need.`, and `0 invoices overdue · $0 · 10 approvals waiting`.
- Signed-in owner DOM facts: `readyState=complete`, `data-jarvis-thread=1`, `data-jarvis-diagnostics=1`, `data-primary-status=1`, `/demo` links `=0`, `scrollWidth=clientWidth=1470`, and `scrollHeight=clientHeight=779` at the captured browser viewport.
- Browser console errors: 0. The browser emitted repeated non-fatal `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` warnings from the Orb bundle.
- The live signed-in production screenshot was captured in the browser verification result for this session; no page control, microphone, instruction submit, or external action was invoked.

## Warnings and boundaries

- The local Vercel build completed but emitted a non-fatal Sentry/ESM warning from `@sentry/server-utils` while building the unrelated `/api/demo-leads/update` import trace. This is recorded; the build did not fail.
- A plain direct request to the generated deployment hostname returned `DEPLOYMENT_NOT_FOUND`; Vercel's protected-deployment `vercel curl` using the deployment ID returned HTTP 200, and the canonical production alias returned HTTP 200. The protected-host response is not counted as a product route failure.
- This publish resolves the stale-production-version boundary for the revised shell. It does not create a reviewer score or a Plan-defined P1 subset formula; the P1 ≥75 score gate remains unproven.
