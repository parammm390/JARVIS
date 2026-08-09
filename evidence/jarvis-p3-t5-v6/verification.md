# P3.T5 verification — 12 Golden Frames pass

Date: 2026-08-08

## Scope

Certified every frame in v6 §18 as a single JARVIS product surface. The Home frames use the existing shared Thread/Orb component tree through the visibly labelled fixture harness. The operational frames use the real `/jarvis/work`, `/jarvis/customers`, `/jarvis/schedule`, `/jarvis/money`, and `/jarvis/agents` routes.

This environment has no authenticated Supabase tenant session, no owner/dispatcher/technician credentials, and no provider session. The private frames therefore show the real source-backed unavailable/sign-in boundaries. The mobile My Day frame is explicitly a technician-boundary capture; it is not represented as a populated technician day. No auth state, tenant row, route, invoice, household, call, agent health, or outcome was simulated.

## Evidence

- `after-metrics.json`: 12 frame records, exact routes/viewports, source labels, truth markers, private request traces, zero horizontal overflow, zero raw JSON, and zero unexpected console/page errors.
- `e2e/jarvis-p3-t5-golden-frames.spec.ts`: 1/1 Playwright certification; six labelled Home states, five real private-surface boundaries, and the real five-channel Fleet.
- Twelve PNG captures in this directory, manually reviewed at 1440 desktop and 390 mobile where required.
- Existing source-contract evidence remains authoritative for populated private continuity and role assignment: `evidence/jarvis-p2-t2-v6/verification.md`, `evidence/jarvis-p2-t3-v6/verification.md`, `evidence/jarvis-p2-t4-v6/verification.md`, `evidence/jarvis-p2-t5-v6/verification.md`, `evidence/jarvis-p3-t3-v6/verification.md`, and `evidence/jarvis-p3-t4-v6/verification.md`.

## Frame review

| # | Frame | Dominant object | Result | Truth boundary |
|---:|---|---|---|---|
| 1 | Home — Ready | Command Canvas / JARVIS presence | pass | labelled `rest` fixture; no private rows invented |
| 2 | Home — Listening | listening presence | pass | labelled `listening` fixture; state is source-labelled |
| 3 | Home — Building plan | causal plan document | pass | labelled `plan` fixture; action payloads remain fixture-only |
| 4 | Home — Needs approval | approval authority object | pass | labelled `approval` fixture; no approval was submitted |
| 5 | Home — Working | execution presentation | pass | labelled `execution` fixture; copy says the real workflow lane has not reported a run |
| 6 | Home — Outcome / receipt | outcome evidence | pass | labelled `receipt` fixture; copy says outcomes are not observed and no receipt exists |
| 7 | Work — active Causal Spine | queue + causal record stage | pass | real unauthenticated projection; exact Work root unavailable, not a fabricated zero |
| 8 | Customer — Household 360 | household index/detail record | pass | real unauthenticated household source; no household rows or CRM joins |
| 9 | Schedule — dispatcher map | Dispatch Field boundary | pass | real unauthenticated Schedule boundary; no map, route, stop, or appointment facts |
| 10 | My Day — mobile | technician Schedule boundary | pass | real mobile boundary; technician role and assigned day require authenticated `/api/me` and `/technician/my-day` |
| 11 | Money — Cash Pressure | Cash Pressure boundary | pass | real unauthenticated money boundary; no aging, invoice, collection, or payment facts |
| 12 | Agents — Agent Fleet | five-channel fleet rail + selected stage | pass | real Fleet route; agent status literal unavailable and provider fact separately scoped |

## Visual rejection checklist

Manual review found zero violations of the v6 rejection checklist in the certified captures:

- no generic SaaS card wall;
- no five-chatbot-card Agent layout;
- no provider/config language promoted to agent readiness;
- no fake zero, fake health, fake outcome, or inferred join;
- no raw JSON or key meaning below the readable boundary;
- Home states visibly recompose around distinct dominant objects;
- Work, Customer, Schedule, Money, and Agents retain distinct native objects;
- the mobile boundary is a real mobile composition with bottom navigation, not compressed desktop;
- all frames use the same navy/cyan/amber material and operational navigation language.

## Verification commands

- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/jarvis-p3-t5-golden-frames.spec.ts --project=desktop-chromium --workers=1` — 1 passed.
- P3 regression Playwright (`jarvis-p3-t2-agent-fleet`, `jarvis-p3-t3-agent-causality`, `jarvis-p3-t4-role-adaptive`, and this T5 spec) — 4 passed.
- `npx vitest run` — 50 files / 487 tests passed.
- `npx tsc --noEmit --pretty false` — passed.
- `npx tsc -p tsconfig.json --noEmit --types node --pretty false` in `finnor-os` — passed; the plain Finnor package script remains affected by stale implicit type directories and is not used as the certification command.
- `npm run lint` — passed with no ESLint warnings or errors.
- `git diff --check` — passed.
- Manual `view_image` review of all 12 captures — pass.

## Phase decision

P3.T5 is green for the v6 Golden Frame composition, truth, and responsive certification: 12/12 frame compositions pass, 0 Sev-1 visual/authority defects, and 0 Sev-2 visual/authority defects. The environment blocker remains explicitly non-fabricated: populated private Work/Customer/Dispatch/Money/technician My Day/Fleet activity frames and in-app Browser bootstrap require an authenticated tenant session; no 98/100 score or populated-data claim is made.
