# JARVIS FRONTEND MAESTRO STATE — v3

**Plan:** `JARVIS-FRONTEND-MAESTRO-PLAN-v3.md` (authored 2026-07-29, Opus 5)
**Evidence appendix:** `JARVIS-FRONTEND-MAESTRO-PLAN.md` (v2 §1–§6 source audit — still valid, cited by the plan)
**Baseline commit:** `c205cb6`
**Golden workflow:** Invoice-to-Cash — *"Chase everyone more than thirty days overdue."*

---

## HOW TO USE THIS FILE

1. Read this file top to bottom.
2. Go to `## NEXT EXACT TASK`. That is your work. Nothing else.
3. `git rev-parse HEAD` must equal `Latest verified commit`.
4. Read the phase's `Source files` in the plan **in full** before writing anything.
5. Run `Discovery`, paste output into the phase's Discovery slot.
6. Execute tasks in order.
7. Check a box **only** with `Evidence:` filled — commit SHA, pasted command + output, screenshot path, or a measured number.
8. Record adaptations in that task's `Deviation:` slot.
9. Append one `## SESSION LOG` line. Update `Latest verified commit` and `## NEXT EXACT TASK`.
10. Commit `jarvis-v3 P<n>.T<m>: <what changed>`.

**You are executing, not designing.** Plan §0.1. If you are about to decide what something looks like, says, or is called — stop. It is already decided. If it genuinely is not, write it under the BLOCKERS section and build around it.

**Lost context?** Plan §0.5. Never restart a phase — checked boxes with evidence are trustworthy.

---

## STATUS

| | |
|---|---|
| **ACTIVE PHASE** | **P2 — The Golden Vertical Slice on the Bridge** |
| **Latest verified commit** | `e649548` |
| **Phases complete** | 1 / 7 |
| **Sessions logged** | 1 |
| **Product exists at** | end of P2 (session ~4) |

## NEXT EXACT TASK

> **P2 pre-flight, then P2.T1.**
>
> **Before writing any code, resolve the two P2 blockers below** — both gate P2's
> *evidence*, not its code:
> 1. `TEST_OWNER_EMAIL` / `TEST_OWNER_PASSWORD` still do not exist. Every P2 exit-gate
>    line ("golden journey completes typed", "…by voice") is an *authenticated* journey.
>    Without credentials P2 can be built but cannot be evidenced.
> 2. Verify the demo tenant has ≥ 3 real overdue invoices (P2 pre-flight box). If not,
>    seed via the repo's own seed script — never hand-write rows into the UI.
>
> Also decide **B-1** (below) before writing P2.T1's tests: there is currently no DOM test
> environment, so P2.T1 must either be written as pure-function tests or the two missing
> packages must be authorised.
>
> Then **P2.T1** — `kernel/{machine,presence,store,transport}.ts`, unit-testing every
> §4.4 transition including illegal pairs (no-op + dev warning, never a crash).
> `kernel/types.ts`, `kernel/selectors.ts` and `kernel/useSelectorInput.ts` already exist
> from P1 — **extend, do not recreate.**
>
> Before starting, read plan §4 (all), §6, §7 and §8's **PHASE 2** in full.

---

## COMPLETION LEDGER

| Phase | Name | Sessions | Status | Exit gate | User-visible result |
|---|---|---|---|---|---|
| P1 | Contract, Foundations & Regression Net | 1 | ✅ | ✅ | production stops lying — 5 KPI veils replace `$0`, no borrowed name, 84→0 req/30s |
| **P2** | **Golden Vertical Slice on the Bridge** | **3** | ⬜ | ⬜ | **the product exists — full golden journey at `/jarvis/next`, typed and by voice** |
| P3 | Instruction Lifecycle & Realtime | 2 | ⬜ | ⬜ | cognition becomes visible; event→pixel ≤ 1.2 s |
| P4 | Complete Consequence Graph | 2 | ⬜ | ⬜ | predicted↔actual; the receipt gets truer over time |
| P5 | Flagships B & C + Voice Continuity | 2–3 | ⬜ | ⬜ | two more workflows; follow-up references; barge-in |
| P6 | Roles, Mobile, Onboarding, Demo, Cutover | 2 | ⬜ | ⬜ | `/jarvis` **is** the product |
| P7 | Truth, Recovery, Performance, Certification | 2 | ⬜ | ⬜ | signed off |

Legend ⬜ not started · 🟡 in progress · ✅ complete · 🔴 blocked

---

## LOCKED DECISIONS — do not revisit

| # | Decision | Where |
|---|---|---|
| L1 | Golden workflow is **Invoice-to-Cash**. Not lead-to-water-test. Not proposal-to-installation. | §1.1 |
| L2 | Flagships are **Lead→Water Test→Dispatch** and **Bulk Notify**. No fourth workflow. | §1.3 |
| L3 | The layout is **The Instruction Thread** — one 720 px column, six blocks, three depths. Not a dashboard. | §2.2 |
| L4 | **Browser voice is transcription + TTS only.** Authorization goes over the authenticated HTTP path. | §3.2 |
| L5 | **Spoken approval does not ship at launch.** Approval is a deliberate physical act. | §3.3-D1 |
| L6 | **7 designed renderers**, not 44. Everything else uses the designed `SchemaCard`. | §7.2 |
| L7 | **18 promoted motions**, not ~100. The rest stay catalog-only in `/jarvis/stage`. | §5.3, §7.3 |
| L8 | The Bridge becomes the product in **P2**, behind `/jarvis/next` + flag. Cutover in P6. | §8 |
| L9 | The kernel **wraps** `data-core.ts`; it never replaces it. | §4.1 |
| L10 | No legacy parity requirement. §7.4 lists exactly what is preserved. | §7.4 |

**Established in P1, carry forward:**

| # | Decision | Where |
|---|---|---|
| L11 | `kernel/selectors.ts` is the only module producing a displayed fact. Selectors are **pure functions** over an explicit `SelectorInput`, never hooks — that is what makes them testable without a DOM. | P1.T6 |
| L12 | `kernel/useSelectorInput.ts` is the **single sanctioned bridge** from `useJarvis()`/`useJarvisAuth()` into the kernel. `useLanePresentation()` is its sibling for non-fact lane state (sparkline history, transport timings, config posture). No panel imports `useJarvis` directly. | P1.T7/T9 |
| L13 | The two ESLint rules are **ratchets**: `error` tree-wide with current violators enumerated in `excludedFiles`. The list may only ever shrink. Never add to it. | P1.T4 |
| L14 | Every rendered number carries `data-truth` and `data-source`. P7.T6's contradiction sweep reads these; the P1 e2e specs already assert on them. | P1.T5 |

---

## VOICE CAPABILITY LEDGER — verified 2026-07-29, re-verify before promising

| ID | Capability | Verified | Ships in |
|---|---|---|---|
| V1 | Partial transcripts | ✅ available, **currently discarded** at `useVapiSession.tsx:200` | P2.T3 |
| V2 | Final transcript | ✅ working | P2.T4 |
| V3 | JARVIS speaks arbitrary text (`say`) | ✅ in SDK, unused | P2.T3 |
| V4 | Barge-in / interruption | ✅ server VAD + `interruptionsEnabled` | P5.T6 |
| V5 | Mute/duck assistant (`control`) | ✅ in SDK, unused | P2.T3 |
| V6 | Inject context (`add-message`) | ✅ in SDK, unused | P5.T7 (pilot) |
| V7 | Real user-mic level | ✅ working (`local-volume-level`) | P2 |
| V8 | Follow-up references | ✅ backend ready; **frontend never sends `sessionId`** | P2.T4 + P5.T5 |
| V9 | Persistent voice thread | ✅ phone path only | P5 |
| **D1** | **Spoken approval (browser)** | ❌ **no resolvable identity on a web call** | not at launch |
| D2 | Word-level transcript timing | ❌ not provided by Vapi | never |
| D3 | Guaranteed tools-while-speaking | ❌ no ordering guarantee | P5.T7 best-effort pilot, may be cut |
| D4 | Client hold/resume | ❌ absent from SDK | never |

**P1 note:** nothing in P1 touched `useVapiSession.tsx`, the kernel machine, or any Vapi code — that is P2, as instructed. This ledger is unchanged from the audit.

---

## DEFECT LEDGER — carried from v2, tracked to closure

| ID | Sev | Defect | Fix | Status | Evidence |
|---|---|---|---|---|---|
| C-01 | CRIT | 401s render as confident `$0` (`KpiStrip.tsx:34-41`) | P1.T7 | ✅ | `fe452be` + `9e42412` · signed-out `"$0"` **2→0**; **5×** "Sign in to see this."; `"Systems idle"` no longer asserted · `qa-screenshots/v3-P1/signed-out-{1440,390}-{before-c205cb6,after-P1}.png` |
| C-02 | CRIT | `"Param"` hardcoded (**actually `HeaderBand.tsx:61`, unquoted JSX**) | P1.T8 | ✅ | `fc95dea` · `grep -rn '"Param"' src/ --exclude='*.test.ts'` → 0; page reads "Good morning 👋" |
| C-03 | HIGH | `stats.pending` unbounded vs `.limit(100)` list | P1.T6 | ✅ | `0bde2b3` · `selectPendingApprovals` cap rule; `PENDING_LIST_CAP=100` verified at `actions/pending/route.ts:49`; 6 unit tests incl. both disagreement cases |
| C-15 | HIGH | Signed-out 401 storm ≈90 req/min (**measured 168/min**) | P1.T9 | ✅ | `f50eb4e` · identical 30 s windows: baseline `c205cb6` = **84 req**, HEAD = **0 req** |
| C-05 | MED | "LIVE OPS" over `sim ·` rows | P1.T10 | ✅ | `473bb9b` · header renders `SAMPLE OPS` in amber — verified on the rendered page at 1440 and 390 |
| C-13 | CRIT | Orb states semantically false (`Bridge.tsx:73-88`) | P2.T12 | 🔴 | |
| C-14 | CRIT | Instruction journey has no middle | P2 + P3 | 🔴 | |
| C-07 | CRIT | `clarification_request` unrendered → renders as an error to Approve/Reject | P2.T8 | 🔴 | |
| **NEW-1** | **CRIT** | **Browser voice always refused — web call has no `customer.number`** | P2.T2–T4 | 🔴 | |
| C-09/10/11 | MED | No stream; proxy buffers; `useLiveQuery` SSE dead | P3.T9–T11 | 🔴 | |
| C-08 | HIGH | `cancelled`/`escalated` unrendered | P7.T2 | 🔴 | |
| C-17 | CRIT | Immersive surface unreachable (`PersonalizedHome.tsx:61`) | P6.T7 | 🔴 | |
| C-21 | MED | Perf baseline unreproducible (56/95/98) | P1.T12 + P7.T7 | ✅ | 5 cold runs at final HEAD: **98/98/98/98/98**, TBT **0 ms** every run. Reproducible *because* P1.T9 removed the 401 storm from the load path. |

Deliberately **not** fixed in v3 (out of scope, recorded honestly): C-04 partial, C-12, C-16, C-18, C-19, C-20 — these concern legacy surfaces that §7.4 leaves at `/jarvis/classic`.

---

## BLOCKERS

<!-- date · phase.task · what is blocked · what is needed · who can unblock -->

### B-1 · 2026-07-29 · P1.T1 · **`@testing-library/react` is installed but cannot run.** OPEN
`@testing-library/react@16` needs **two** things this plan does not authorise:
`@testing-library/dom@^10` (a peer — v16 stopped bundling it, and npm did not auto-install
it), and a DOM environment for Vitest (`jsdom` or `happy-dom`). Verified, not assumed:
```
$ node -e "require.resolve('@testing-library/dom')"  → MODULE_NOT_FOUND
$ node -e "require.resolve('jsdom')"                 → MODULE_NOT_FOUND
@testing-library/react@16.3.2 peerDependencies = {"@testing-library/dom":"^10.0.0", …}
```
The session binding is explicit: *"P1.T1 adds Vitest and @testing-library/react and NOTHING
else. No other dependency is authorised anywhere in this plan."* So the two extra packages
were **not** installed and `vitest.config.ts` runs `environment: "node"`.

**Built around it, not blocked on it:** every P1 unit test targets pure logic — the truth
gate, the C-03 cap rule, the C-02 name derivation, the C-15 ladder and classification. That
is where the truth rules actually live, so P1's coverage is not weakened. **81 tests pass.**

**What is needed:** authorisation to add `@testing-library/dom` and one of `jsdom` /
`happy-dom` as devDependencies. **Who can unblock:** the plan owner.
**Cost of not fixing:** no component can ever be rendered in a unit test. P2.T1 (§4.4
transition tests), P2.T8 (clarification excluded from approval counts) and P7's exhaustive
`RunState`/`StepState` render matrix are all specified as unit tests and will otherwise have
to be written as pure-function tests or promoted to Playwright.

### B-2 · 2026-07-29 · P1.T5 · §5.5 has no row for `unavailable: "server"`. OPEN (minor)
`Truth<T>` (§4.2) admits `unavailable` with reason `"network" | "server" | "not-configured"`,
but the §5.5 truth-grammar table specifies copy for **`network`** and **`not-configured`**
only. `Metric.tsx` currently routes `server` through the `network` branch — literal
`"Can't reach JARVIS."` + Retry + last-known age — as the nearest specified neighbour, since
both mean "we asked and got no usable answer". **What is needed:** either the intended
literal copy for a 5xx, or confirmation that sharing the network copy is correct.

---

**Raised earlier, still open, and now due — these gate P2's *evidence*, not its code:**
- **No `TEST_OWNER_EMAIL` / `TEST_OWNER_PASSWORD`.** P2 onward needs authenticated journeys.
  **Confirmed still absent at the end of P1** — which is why every P1 evidence artefact is
  signed-out. Every line of P2's exit gate ("golden journey completes typed", "…by voice",
  "a real `clarification_request` renders as a question") is authenticated. If credentials
  still do not exist when P2 begins, use labelled debug-harness fixture runs as the
  substitute — and say so in every evidence slot that depends on it.
- **Demo-tenant data.** The golden journey needs ≥ 3 real overdue invoices in the tenant.
  Verify at P2.T1; if absent, seed via the repo's own seed script — **never hand-write rows
  into the UI.**
- **`AWS_BEDROCK_API_KEY` unset** → critic returns null. P2.T9 must render the literal
  `"Second-pass review didn't run (no model key configured)."` — never a fake pending.

---

# PHASE 1 — Contract, Foundations & Regression Net
**Status:** ✅ · **Sessions:** 1 · **Depends on:** none · **Plan:** §8 → PHASE 1

### Discovery output
```
$ grep -rn "?? 0" src/components/jarvis | wc -l
      44

$ grep -rn '"Param"' src/
(no matches — exit 1)

$ grep -c "Degraded" src/components/jarvis/panels/KpiStrip.tsx
0

$ ls e2e/jarvis-visual-snapshots.spec.ts-snapshots | wc -l
      26
```
**Two discovery commands disagree with the plan — the source wins (§0.2 rule 1):**

1. **`grep -rn '"Param"' src/` returns 0, and always did.** The literal is not a quoted
   string — it is bare JSX text at `HeaderBand.tsx:61` (plan says `:66`):
   `{timeOfDay}, Param <span…>👋</span>`. The exit-gate grep as written could never have
   detected C-02. The defect is real; the detector was not. Both the discovery command
   and the exit-gate line are recorded here as ineffective, and C-02 was closed against
   the real defect instead.
2. **`grep -c "Degraded" KpiStrip.tsx` returns 0.** KpiStrip never referenced the
   degraded flags at all — it read `useJarvis()` and coerced with `?? 0` unconditionally.
   That is *worse* than the plan assumed, and is precisely why C-01 rendered `$0`.
3. **`?? 0` in `KpiStrip.tsx` is 9 occurrences on 9 lines (35–41, 71, 73), not "six at
   lines 34-41".** All 9 removed.

- [x] **P1.T1** Vitest + @testing-library/react; `"test:unit": "vitest run"` — **the only deps in this plan**
      **Evidence:** `c660045`. `npm install -D vitest @testing-library/react` → `vitest@4.1.10`,
      `@testing-library/react@16.3.2`. `git diff c205cb6 -- package.json` shows **exactly** those two
      additions plus the one script — no other dependency anywhere in P1.
      ```
      $ npm run test:unit
      > vitest run
       RUN  v4.1.10 /Users/paramdave/Desktop/FINNOR
      No test files found, exiting with code 0
      EXIT=0
      ```
      **Deviation:** (a) The plan fixes the script string as exactly `vitest run`, but also
      requires exit 0 with zero tests; vitest exits 1 by default. Resolved with
      `passWithNoTests: true` in `vitest.config.ts` so the script string stays verbatim.
      (b) Vitest 4 uses **oxc**, not esbuild, and ignores `esbuild` options with a warning;
      JSX config moved to `oxc: { jsx: { runtime: "automatic" } }` because `tsconfig.json`
      sets `"jsx": "preserve"` for Next. (c) `test.env` supplies placeholder
      `NEXT_PUBLIC_SUPABASE_*` values because `jarvis-auth.tsx` constructs the Supabase
      client at module load and it validates its URL eagerly. **(d) See BLOCKER B-1:
      `@testing-library/react` is installed but currently unusable.**
- [x] **P1.T2** 6 type tokens + 7-value spacing + 6 colour semantics into `jarvis-theme.css` (no call-site sweep yet)
      **Evidence:** `c05d052`. Counts verified by command:
      ```
      $ grep -oE "^  --j-fs-[a-z]+:" jarvis-theme.css | sort
        --j-fs-base:  --j-fs-display:  --j-fs-lg:  --j-fs-micro:  --j-fs-sm:  --j-fs-xl:     (6)
      $ grep -oE "^  --j-space-[0-9]+: [0-9]+px;" jarvis-theme.css
        4px 8px 12px 16px 24px 32px 48px                                                     (7)
      $ grep -oE "^  --j-(cyan|green|amber|red|violet|blue): #[0-9a-f]+;" jarvis-theme.css
        cyan blue violet amber red green                                                     (6)
      ```
      No call site touched — that is P6.T5.
      **Deviation:** §5.1 names 6 tokens but each carries a 4-part spec (size / line-height /
      weight / tracking), which one custom property cannot hold. The 6 `--j-fs-*` names are
      the plan's verbatim and hold the size; `--j-lh-* / --j-fw-* / --j-ls-*` companions carry
      the other three parts, and a `.j-fs-*` class per token applies all four at once. No new
      product vocabulary was invented — the spacing tokens are named for their own values.
      §5.2's six colour tokens **already existed** (`jarvis-theme.css:11-17`); what was added
      is the binding semantics contract, since the plan specifies meanings, not new hexes.
- [x] **P1.T3** `kernel/types.ts` — `Truth<T>`, `TruthSource` per §4.2
      **Evidence:** `2516513`. Byte-for-byte verified against the plan text:
      ```
      $ diff <(sed -n '240,250p' PLAN-v3.md) <(sed -n '10,20p' kernel/types.ts)
      VERBATIM: plan L240-250 == types.ts L10-20 (0 diff)
      $ npx tsc --noEmit  → exit 0
      ```
      **Deviation:** none.
- [x] **P1.T4** ESLint bans: `?? 0` on `useJarvis()` fields; `useJarvis` outside `kernel/` + `data-core.ts`
      **Evidence:** `5f64390`. Both rules **proven to fire** against a temporary probe file
      (created, linted, deleted):
      ```
      ./src/components/jarvis/panels/__probe_delete_me.tsx
      1:10  Error: 'useJarvis' import … is restricted …   no-restricted-imports
      4:36  Error: No `?? 0` in the JARVIS cockpit …      no-restricted-syntax
      ```
      Full-repo `npm run lint` → `✔ No ESLint warnings or errors`.
      **Deviation:** implemented as **ratchets**, not big-bang bans. 21 files import
      `useJarvis` and 16 contain `?? 0`; erroring on all of them would leave `npm run lint`
      red, which the P1 exit gate forbids. The rule is `error` across the whole JARVIS tree
      with the current violators enumerated in `excludedFiles`, so any *new* violation fails
      immediately while the debt is a finite, visible list that only shrinks (KpiStrip already
      removed by T7; the rest by P6.T8). A type-aware "`?? 0` **on `useJarvis()` fields**"
      rule is not expressible in esquery, so the rule bans `?? 0` outright within the tree —
      strictly stronger, and it caught a `?? 0` in my own new `selectors.ts`, which was fixed
      rather than exempted.
- [x] **P1.T5** `lib/Metric.tsx` → `value: Truth<number>`; render per §5.5; delete `source` prop
      **Evidence:** `e4b517b`. All 8 §5.5 rows implemented with the plan's literal copy,
      verified present by command:
      ```
      Nothing here yet. →1   Sign in to see this. →1   Your role doesn't include this. →1
      Can't reach JARVIS. →1  Not connected yet. →1    Last confirmed →2   " shown" →1
      $ grep -n 'source: "live"' src/components/jarvis/  → 0 hits (prop deleted)
      $ npx tsc --noEmit → exit 0 ; npm run lint → clean
      ```
      A number renders only for `known | stale | partial`; every rendered number carries
      `data-truth` + `data-source` (which P7.T6's sweep will read, and which the T11/T12
      specs already assert on).
      **Deviation:** two additive, backwards-compatible primitive changes were needed so the
      *mandated copy* could render through the *mandated component*: `StaleFog` gained an
      optional `caption` (its own default is "as of 2m ago"; §5.5 requires "Last confirmed
      2m ago"), and `EmptyState` gained `tone="amber"` + `actionHref` (§5.5 requires "EmptyState
      amber" with a setup **link**). Omitting either prop reproduces pre-P1 output exactly.
      `StatCard` + `PrimitivesCatalog` updated as the only consumers; the catalog demo is now
      truthfully `source: "fixture"`.
- [x] **P1.T6** `kernel/selectors.ts` — 4 selectors; `selectPendingApprovals` implements the `partial` cap
      **Evidence:** `0bde2b3`. `PENDING_LIST_CAP = 100` verified against source, not assumed:
      `finnor-os/apps/api/app/api/actions/pending/route.ts:49` → `.limit(100)`.
      All three §4.7 branches unit-tested:
      ```
      ✓ counts agree -> known
      ✓ list at the cap -> partial, rendered as '100 of 137'
      ✓ the cap is 100, matching actions/pending/route.ts:49
      ✓ disagreement BELOW the cap -> known from /api/stats, with a dev warning naming both
      ✓ agreement does NOT warn
      ```
      **Deviation:** (a) `selectOverdueInvoices` returns `Truth<{count, totalUsd}>`, not
      `Truth<number>` — both come from one row of one response, and splitting them into two
      Truths is exactly the contradiction §4.7 exists to prevent. A `mapTruth` helper projects
      one field without changing how it is known. (b) A `useSelectorInput()` hook in `kernel/`
      is the single sanctioned bridge from `useJarvis()`/`useJarvisAuth()` into the pure
      selectors — required by T4's own ban. (c) Selectors are pure functions over an explicit
      `SelectorInput` rather than hooks, so they are testable without a DOM (BLOCKER B-1).
- [x] **P1.T7** **C-01** `KpiStrip.tsx` onto selectors + `Metric`; remove all six `?? 0`
      **Evidence:** `fe452be`. **9** `?? 0` removed (not 6 — see Discovery), and the file no
      longer imports `useJarvis` at all:
      ```
      $ grep -c "?? 0" panels/KpiStrip.tsx            → 0
      $ grep -c "import.*useJarvis" panels/KpiStrip.tsx → 0
      ```
      Measured signed-out effect: `"$0"` occurrences on the page **2 → 0**; the five cards
      render `PermissionVeil` + "Sign in to see this."
      Before/after: `qa-screenshots/v3-P1/signed-out-{1440,390}-{before-c205cb6,after-P1}.png`.
      **Deviation:** the five cards' sub-lines carry numbers too (`"0 payment links open"`),
      so they are Truth-gated by the same rule — rendering "0 payment links open" off a 401 is
      the same lie in smaller type. That required 5 supporting read-model selectors
      (`selectPaymentLinksOpen`, `selectOpenLeads`, `selectQuotesSent`, `selectStuckRuns`,
      `selectOpenReconciliation`) beyond §4.7's four golden ones. **No new fact is displayed** —
      same five cards, same labels, same copy, same colours, same order. The flash-on-change
      effect now fires only on a real change between two *known* values, so moving into or out
      of a veil no longer reads as a value change.
- [x] **P1.T8** **C-02** delete literal `"Param"`; real first name; signed-out shows none + unit test
      **Evidence:** `fc95dea`.
      ```
      $ grep -rn '"Param"' src/ --exclude="*.test.ts"   → 0 hits
      $ grep -rn "Param" src/components/jarvis/panels/  → 0 hits (only an unrelated URLSearchParams)
      ```
      Signed-out screenshot reads **"Good morning 👋"** — no name at all.
      7 unit tests, including an explicit regression asserting the shipped literal is never
      returned for any of 6 empty/absent identity shapes.
      **Deviation:** (a) the defect is at `HeaderBand.tsx:61` as unquoted JSX, not `:66` as a
      string literal — see Discovery. (b) The plan says "use the signed-in first name" but does
      not specify the fallback when a Supabase user has no profile name; `selectFirstName`
      falls back to the email local part (the user's own real identifier, not an invention) and
      returns `null` when there is genuinely nothing, in which case the greeting renders no
      name. (c) One `"Param"` hit remains in `src/` — inside `selectors.test.ts`, as the
      negative assertion guarding the regression. Deleting a regression test to satisfy a grep
      would be gaming the gate, so it stays and is reported here rather than hidden.
      **(d) Follow-on in `9e42412`:** verifying exit-gate 1 revealed `HeaderBand` still had two
      network `?? 0`s feeding `statusSentence()`, which made a signed-out page assert
      "Systems idle." from four 401s. Truth-gated there too; `HeaderBand` is now off **both**
      ESLint debt lists and contains no `useJarvis` and no `?? 0` at all.
- [x] **P1.T9** **C-15** gate private lanes on session; 401 → `denied`; backoff 4→8→16→32→60 s
      **Evidence:** `f50eb4e`. **Measured before/after on identical 30 s steady-state windows,
      two live servers, same browser harness:**
      ```
      === BEFORE (baseline c205cb6) — signed-out /jarvis, 30s ===
      TOTAL /api/jarvis/* requests in 30s: 84      (extrapolated 168/min)
        16x /actions/pending   14x /workflows/runs   8x /stats   6x /events   6x /comms
        3x each x10 read-models/insights            2x /setup/status   2x /integrations/status

      === AFTER (P1.T9, HEAD) — signed-out /jarvis, 30s ===
      TOTAL /api/jarvis/* requests in 30s: 0       (extrapolated 0/min)
      ```
      All three rules implemented: no session → no request; 401/403 → lane stops and records
      the reason (`accessDenied`), which `kernel/selectors.ts` turns into `Truth.denied` so the
      veil states the real reason; 5xx/network → `BACKOFF_LADDER_MS` = `[4000, 8000, 16000,
      32000, 60000]`, reset on success. 14 unit tests on the two pure decisions
      (`nextBackoffMs`, `classifyLaneOutcome`) including saturation and the 401-outranks-
      transient case.
      **Deviation:** (a) fixed `setInterval` per lane replaced by self-rescheduling
      `setTimeout`, because the delay is now a function of the last outcome. (b) The
      visibility-change refetch is gated too — returning to the tab was another way the storm
      restarted. (c) `pollSanity` used `.catch(() => null)`, which discarded the status code
      needed to tell "refused" from "broke"; converted to `allSettled`. (d) A 1 s watcher
      clears the refusal and restarts every lane the moment a session appears, so signing in
      does not leave a dead patch.
- [x] **P1.T10** **C-05** `OpsTicker` header → `"SAMPLE OPS"` when any row is `sim ·`
      **Evidence:** `473bb9b`. Header renders the literal `SAMPLE OPS` — visible top-left in
      `qa-screenshots/v3-P1/signed-out-1440-after-P1.png`, over the row
      `sim · Water test booked · Tuesday 10:00 · Maple Ridge Rd` (the before screenshot shows
      `LIVE OPS` in the same position).
      **Deviation:** `sim` is now a tracked boolean property of each row rather than sniffed
      back out of its rendered text, so the header cannot drift from what the rows are. The
      pulsing teal "live" dot beside the label goes **static amber** when sampling — leaving a
      pulsing live dot next to "SAMPLE OPS" would restate the exact claim C-05 is about (§5.2
      binds amber to "degraded, partial").
- [x] **P1.T11** `e2e/jarvis-network-hygiene.spec.ts` — assert **< 5 requests / 30 s** signed out
      **Evidence:** `532826f`.
      ```
      $ npx playwright test e2e/jarvis-network-hygiene.spec.ts --project=desktop-chromium
      ✓ signed-out network hygiene (C-15) › fewer than 5 private API requests in 30s (35.9s)
      ✓ signed-out network hygiene (C-15) › renders no private metric as a confident zero (8.1s)
        2 passed
      ```
      **The green is not vacuous:** the same 30 s measurement against baseline `c205cb6`
      yields 84 requests, which fails this spec's `< 5` budget by 17×.
      **Deviation:** the budget counts requests to the authenticated proxy surface
      (`/api/jarvis/*`) — the traffic that actually stormed — not page assets, for which
      "< 5" would be meaningless. A second test in the same file asserts C-01 structurally:
      zero elements matching `[data-truth="known"][data-source^="api:"]` while signed out.
- [x] **P1.T12** `e2e/jarvis-golden-baseline.spec.ts` — signed-out `/jarvis` at 1440 + 390 as "before"
      **Evidence:** `17145c7`.
      ```
      $ npx playwright test e2e/jarvis-golden-baseline.spec.ts --project=desktop-chromium
      ✓ signed-out /jarvis at 390px (12.0s)
      ✓ signed-out /jarvis at 1440px (12.4s)
        2 passed          (clean re-run against committed snapshots, no --update)
      ```
      Committed snapshots: `e2e/jarvis-golden-baseline.spec.ts-snapshots/golden-baseline-signed-out-{1440,390}-desktop-chromium-darwin.png`
      Human-readable PNGs: `qa-screenshots/v3-P1/jarvis-signed-out-{1440,390}.png`
      **Deviation:** the spec sets its own viewport per case, so running it under both
      Playwright projects duplicated it under two snapshot names. Pinned to
      `desktop-chromium`; the widths come from the spec, not the project.
- [x] **P1.T13 (not in the plan — required to close the phase honestly)** Repair the
      **pre-existing** regression net, which the P1 fixes had invalidated.
      **Evidence:** `e649548`. Running the **full** suite rather than only the two new specs
      found three real problems:

      **(a) A pre-existing test was pinning defect C-05 in place.**
      `jarvis-public.spec.ts:102` asserted `getByText("LIVE OPS")` is visible on a
      **signed-out** page — where every ticker row is sample content. The suite was enforcing
      the exact false claim C-05 describes. Rewritten to assert the ticker exists **and** that
      signed-out shows the honest `SAMPLE OPS`.

      **(b) All 26 committed visual snapshots still depicted the defective pre-P1 surface —
      and passed anyway.** The `view-command-center` baseline dates from `5c40401`, long before
      this session, and still shows `$0` from 401s, the hardcoded name and `LIVE OPS`. Measured
      rather than assumed: the real diff is **32,413 pixels, ratio 0.04**, against the spec's
      `maxDiffPixelRatio: 0.05`. It passed by a **0.01 margin**. The net cannot see five KPI
      numbers becoming permission veils. All 26 regenerated with `--update-snapshots=all`
      (plain `--update-snapshots` rewrites only on failure, so it changed nothing).

      **(c)** The new golden-baseline spec ran under both projects, duplicating itself.

      **Finding to carry forward:** a 5 % full-page tolerance is too loose for this page to
      function as a regression net — a change this large hid inside it. **P6.T5 (type/spacing
      sweep) and P7.T7 rely on these snapshots.** Recommend tightening the per-view tolerance,
      or snapshotting the KPI strip and header as their own elements, before P6.
      **Deviation:** this task is not in the plan. The plan's §8 P1 task list and exit gate
      never mention the existing suite, but P1 changed four files it covers, and "`/jarvis`
      still works" is hard rule 9. Leaving it red — or worse, leaving baselines that are
      pictures of the bugs — would have made the phase's green misleading.

### Exit gate
- [x] `grep -rn "?? 0" src/components/jarvis/panels` → 0 for network values — **Evidence:**
      **`grep -rn "?? 0" src/components/jarvis/panels/ | wc -l` → 11, and every one was
      individually inspected. Zero of the 11 are network values.**
      `KpiStrip.tsx` → **0** · `HeaderBand.tsx` → **0**.

      Verifying this gate is what caught the last real instance. The first pass through
      `panels/` returned **14**, not 11: `HeaderBand` still coerced `data.stats?.pending ?? 0`
      and the overdue count. Those fed `statusSentence()`, so a signed-out visitor's four 401s
      became all-zeros and therefore the confident sentence **"Systems idle."** — C-01 again,
      in prose rather than in a number. Fixed in `9e42412` rather than caveated: the counts now
      come from selectors, a fact contributes a clause only when it is actually known, and when
      nothing is known the sentence is omitted entirely. The idle copy is unchanged and is now
      only reachable when every input genuinely resolved to zero. Confirmed on the rendered
      page: `"Systems idle" claimed: no` at both 1440 and 390.

      The 11 that remain are defaulted **local** computations, not "we don't know" coerced to
      zero: `WorkflowTheater` ×4 (`node.attempts`, a local `Map.get()` edge counter),
      `AnalyticsRow` ×3 (a local `Map.get()` tally; `s.decided`/`s.rejected` on an
      already-loaded object), `DispatchMap` ×2, `CertificationStatus` ×2 (`array?.length`).
      They stay in the ESLint ratchet's `excludedFiles` and are cleared by P6.T8.
- [x] `grep -rn '"Param"' src/` → 0 — **Evidence:** 0 in production code
      (`--exclude="*.test.ts"`). **1 hit total in `src/`**, at `selectors.test.ts:258`, which is
      the negative assertion `expect(selectFirstName(c)).not.toBe("Param")` guarding the
      regression. Reported rather than removed — see T8 deviation (c). Note this grep returned
      0 *before* any work was done and could never detect C-02; the real fix is verified by
      the screenshot and by `grep -rn "Param" src/components/jarvis/panels/` → 0.
- [x] Signed-out `/jarvis` renders no `$0`/`0` for private metrics — **Screenshot:**
      `qa-screenshots/v3-P1/signed-out-{1440,390}-after-P1.png` (vs `…-before-c205cb6.png`).
      Measured on the rendered page at final HEAD, **identical at 1440 and 390**:
      ```
      "$0" occurrences        : 0        (baseline: 2)
      known api metrics       : 0        [data-truth="known"][data-source^="api:"]
      "Sign in to see this."  : 5        one per KPI card, replacing 0 / $0 / $0 / 0 / 0
      "Systems idle" claimed  : no       (baseline asserted it from four 401s)
      greeting line           : Good morning 👋      (baseline: "Good morning, Param 👋")
      ops header              : SAMPLE OPS           (baseline: "LIVE OPS")
      ```
      All four P1 defects are visible as closed in a single frame. Asserted in CI too, so it
      cannot silently regress.
- [x] < 5 requests / 30 s signed out — **Network log:** **0 requests** to `/api/jarvis/*` in a
      30 s steady-state window (baseline `c205cb6`: **84**, breakdown pasted in T9 above).
      Enforced by `e2e/jarvis-network-hygiene.spec.ts`.
- [x] `npm run lint` + `npm run test:unit` green — **Evidence:**
      ```
      $ npm run lint
      ✔ No ESLint warnings or errors
      $ npm run test:unit
       Test Files  2 passed (2)
            Tests  81 passed (81)
      $ npx tsc --noEmit
      exit 0
      $ npx playwright test --workers=2        # FULL suite, both projects
        52 passed, 0 failed   (14 skipped — all credential-gated, see BLOCKERS)
      ```
      The full suite was run, not just the two new specs — see the P1.T13 row below for
      what that caught.
- [x] Cold Lighthouse baseline, 5 runs, median + worst — **Evidence:**
      **Headline cold number: performance 98.** Lighthouse 13.4.1, `--preset=desktop`,
      `--only-categories=performance,accessibility`, `next build` + `next start -p 3300`
      (production build, not dev). **Cache condition: cold — a fresh `--user-data-dir` per
      run, so every run is an empty browser profile and an empty HTTP cache; no warm pass
      is included in these numbers.** Signed out, so no authenticated payload is in scope.

      | run | perf | a11y | FCP ms | LCP ms | TBT ms | CLS | SI ms |
      |---|---|---|---|---|---|---|---|
      | 1 | 98 | 96 | 329 | 1146 | 0 | 0 | 587 |
      | 2 | 98 | 96 | 327 | 1122 | 0 | 0 | 579 |
      | 3 | 98 | 96 | 329 | 1147 | 0 | 0 | 572 |
      | 4 | 98 | 96 | 328 | 1129 | 0 | 0 | 583 |
      | 5 | 98 | 96 | 328 | 1127 | 0 | 0 | 581 |

      **MEDIAN** perf 98 · a11y 96 · FCP 328 ms · LCP 1129 ms · TBT 0 ms · CLS 0 · SI 581 ms
      **WORST** perf 98 · a11y 96 · FCP 329 ms · LCP 1147 ms · TBT 0 ms · CLS 0 · SI 587 ms
      *(These five runs are against final HEAD `9e42412`. An earlier identical set was
      taken at `17145c7`, before the HeaderBand gate fix, and scored the same 98 across
      all five — the fix did not move perf, and both sets are reproducible.)*

      **This also closes C-21.** v2's baseline was unreproducible — perf 56→98 and TBT
      1,460→30 ms across three runs of one page. Here the spread is **zero** on performance and
      TBT is 0 ms in all five runs. The cause is P1.T9: the old page fought 84 requests' worth
      of 401s for the main thread and network during load, which is what made the number a
      coin-flip. Note a11y is **96**, below P7's ≥ 95 bar — comfortably passing, and P6.T5's
      contrast sweep is the next thing to move it.

# PHASE 2 — The Golden Vertical Slice on the Bridge
**Status:** ⬜ · **Sessions:** 3 · **Depends on:** P1 · **Plan:** §8 → PHASE 2

> **This is the phase that creates the product.** At its end a real owner speaks one sentence
> and watches the whole journey. Do not start P3 until that is true and recorded.

### Discovery output
```
<!-- paste: clarif grep (expect 0) · VAPI_ASSISTANT_ID · transcriptType -->
```

### Pre-flight
- [ ] Demo tenant has ≥ 3 real overdue invoices — **Evidence:**
- [ ] Web Vapi assistant identified; shared-with-phone status determined — **Evidence:**

### Tasks
- [ ] **P2.T1** `kernel/{machine,presence,store,transport}.ts`; unit-test every §4.4 transition incl. illegal → no-op
      **Evidence:** · **Deviation:**
- [ ] **P2.T2** **NEW-1** verify/create a web-only Vapi assistant (transcription + TTS, **no `finnor_instruct`**); `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID`
      **Evidence:** · **Deviation:**
- [ ] **P2.T3** **V1/V3/V5** `useVapiSession.tsx` — emit partial transcripts; add `say()` + `duck()`. Do not touch the mic watchdog or Daily processor fix.
      **Evidence:** · **Deviation:**
- [ ] **P2.T4** **V8** `kernel/instruction.ts` — `submitInstruction(text,{source,sessionId})`; mint + persist `sessionId`; **send it in the POST body**
      **Evidence:** · **Deviation:**
- [ ] **P2.T5** `/jarvis/next` route + `bridge/Thread.tsx` — depths, column, block collapse/expand
      **Evidence:** · **Deviation:**
- [ ] **P2.T6** `bridge/CommandRail.tsx` — pinned, `/`, `⌘K`, hold-Space, partial transcript, connection dot
      **Evidence:** · **Deviation:**
- [ ] **P2.T7** Blocks ①②③ incl. the **policy-version-0 copy variant**
      **Evidence:** · **Deviation:**
- [ ] **P2.T8** **C-07** `ClarificationScene.tsx` — Answer/Skip/Cancel, **never Approve/Reject**; excluded from approval counts + unit test
      **Evidence:** · **Deviation:**
- [ ] **P2.T9** Block ⑤ — `ApprovalCockpit` at depth 2 + `CockpitRise`; critic-null literal copy
      **Evidence:** · **Deviation:**
- [ ] **P2.T10** Block ⑥ — execution lanes hosting `WorkflowTheater`; run controls
      **Evidence:** · **Deviation:**
- [ ] **P2.T11** Block ⑦ — receipt from `ReceiptContent`; `#receipt-{id}`; survives refresh
      **Evidence:** · **Deviation:**
- [ ] **P2.T12** **C-13** `Orb3D` takes 12-value `Presence`; **delete `useOrbLiveState()`**; lane-arc subdivision
      **Evidence:** · **Deviation:**
- [ ] **P2.T13** Motions M1 M2 M3 M5 M6 M7 M9 M10 M11 M12 M15 from `kernel/choreography.ts`
      **Evidence:** · **Deviation:**
- [ ] **P2.T14** Sounds `commit propose approve reject step seal` + 400 ms throttle
      **Evidence:** · **Deviation:**

### Exit gate
- [ ] Golden journey completes **typed** at `/jarvis/next` — **Recording/ordered screenshots:**
- [ ] Golden journey completes **by voice** — partial transcript visible, JARVIS speaks plan summary + outcome — **Recording:**
- [ ] A real `clarification_request` renders as a **question** with Answer/Skip/Cancel — **Screenshot:**
- [ ] Clarifications excluded from approval counts — **Unit test:**
- [ ] `grep -rn "useOrbLiveState" src/` → 0 — **Evidence:**
- [ ] All 7 states screenshotted at **1440 and 390** — **Paths:**
- [ ] Keyboard-only completion, both widths — **Transcript:**
- [ ] Zero console errors across the journey — **Evidence:**
- [ ] ≥ 55 fps during execution with 6 lanes — **Reading:**
- [ ] `/jarvis` unchanged — **Snapshot diff:**

---

# PHASE 3 — Instruction Lifecycle & Realtime
**Status:** ⬜ · **Sessions:** 2 · **Depends on:** P2 · **Plan:** §8 → PHASE 3

> Touches the database. Every addition is additive. `POST /api/actions` response stays `{planned}`.

- [ ] **P3.T1** Migration: `instruction_sessions` · `instruction_events` · `domain_actions.instruction_id`
      **Evidence (`\d`):** · **Deviation:**
- [ ] **P3.T2** `orchestration/src/instruction-trace.ts` — monotonic `seq`
      **Evidence:** · **Deviation:**
- [ ] **P3.T3** Instrument `handleInstruction`; `context_retrieved` = `[{label,count,source}]` **only**
      **Evidence:** · **Deviation:**
- [ ] **P3.T4** `POST /api/actions` accepts optional `instructionId`; response unchanged
      **Evidence:** · **Deviation:**
- [ ] **P3.T5** `GET /api/instructions/{id}` + `/events?after=`; proxy allowlist
      **Evidence:** · **Deviation:**
- [ ] **P3.T6** 400 ms trace poll, 120 s ceiling, stops on terminal
      **Evidence:** · **Deviation:**
- [ ] **P3.T7** M4 ContextGather + per-event M5 PlanDraw; chips carry real source labels
      **Evidence:** · **Deviation:**
- [ ] **P3.T8** Restore-after-refresh mid-flight
      **Evidence:** · **Deviation:**
- [ ] **P3.T9** Backend `GET /api/stream` (SSE, 25 s heartbeat, `Last-Event-ID`)
      **Evidence:** · **Deviation:**
- [ ] **P3.T10** **New** `src/app/api/jarvis/stream/route.ts`, edge, pipes `upstream.body`, **no `.text()`** + catch-all test
      **Evidence:** · **Deviation:**
- [ ] **P3.T11** `transport.ts` SSE + 2-failure fallback; one `applyServerFacts`; lane slow-down when `live`
      **Evidence:** · **Deviation:**
- [ ] **P3.T12** Rail connection dot renders `live|polling|reconnecting|offline`
      **Evidence:** · **Deviation:**

### Exit gate
- [ ] ≥ 5 ordered `instruction_events` from a real instruction — **Pasted rows:**
- [ ] First trace event **≤ 800 ms** — **Timing:**
- [ ] Event→pixel median **≤ 1200 ms** over ≥ 20 events — **Measurement:**
- [ ] `POST /api/actions` without `instructionId` unchanged — **Test:**
- [ ] Stream kill → polling ≤ 10 s; reconnect → no duplicates — **Test:**
- [ ] Mid-flight refresh resumes the thread — **E2E:**

---

# PHASE 4 — Complete Consequence Graph
**Status:** ⬜ · **Sessions:** 2 · **Depends on:** P3 · **Plan:** §8 → PHASE 4

### Consequence checklist — every one must be verified changed after approval
- [ ] `invoices.status` — **Evidence:**
- [ ] `communications_log` **or** `sandbox_outbox` row — **Evidence:**
- [ ] `workflow_runs` + `workflow_steps` ×3 — **Evidence:**
- [ ] `selectOverdueInvoices` recomputed — **Evidence:**
- [ ] `selectCollectedUsd` recomputed — **Evidence:**
- [ ] `selectRunsInFlight` recomputed — **Evidence:**
- [ ] `selectPendingApprovals` decremented — **Evidence:**
- [ ] Activity gained events — **Evidence:**
- [ ] Field cooled (M17) — **Screenshot:**
- [ ] `⌘K → Ops` counts changed — **Evidence:**
- [ ] `decision_receipts` row created — **Evidence:**

### Tasks
- [ ] **P4.T1** Expose `simulate()`'s `predicted` on `/api/actions/pending` and `/api/receipts/[id]`
      **Evidence:** · **Deviation:**
- [ ] **P4.T2** Approval card renders the predicted outcome
      **Evidence:** · **Deviation:**
- [ ] **P4.T3** `ThreadVerification.tsx` — two columns + M16; the "no prediction recorded" variant
      **Evidence:** · **Deviation:**
- [ ] **P4.T4** Payment webhook → **receipt updates in place** + M17 + `selectCollectedUsd`
      **Evidence:** · **Deviation:**
- [ ] **P4.T5** Cross-surface invalidation via one `applyServerFacts` fan-out
      **Evidence:** · **Deviation:**
- [ ] **P4.T6** Sandbox honesty literal string on step + receipt
      **Evidence:** · **Deviation:**
- [ ] **P4.T7** `⌘K → Ops` single destination with 4 real counts
      **Evidence:** · **Deviation:**
- [ ] **P4.T8** `e2e/golden-consequence.spec.ts` asserting the full checklist above
      **Evidence:** · **Deviation:**

### Exit gate
- [ ] Predicted↔actual from **real** `simulate()` + real outcome — **Screenshot + source:**
- [ ] Payment webhook updates the **same** receipt in place — **Before/after:**
- [ ] Full consequence checklist green — **Spec output:**
- [ ] Sandbox labelled with the literal string — **Screenshot:**
- [ ] No raw JSON in the receipt — **Grep + screenshot:**

---

# PHASE 5 — Flagships B & C + Voice Continuity
**Status:** ⬜ · **Sessions:** 2–3 · **Depends on:** P4 · **Plan:** §8 → PHASE 5

- [ ] **P5.T1** Flagship B end-to-end (`start_water_test_workflow` + `assign_technician_to_visit`)
      **Evidence:** · **Deviation:**
- [ ] **P5.T2** `RouteScene.tsx` wrapping `DispatchMap`; register `route_suggestion`
      **Evidence:** · **Deviation:**
- [ ] **P5.T3** Flagship C + M8 BlastRadius with a **real** recipient count (unknown → forced typed confirm)
      **Evidence:** · **Deviation:**
- [ ] **P5.T4** `SchemaCard.tsx` as the designed default tier; `FallbackRenderer` → owner-debug only
      **Evidence:** · **Deviation:**
- [ ] **P5.T5** **V8** follow-up reference resolves, **or** honestly falls through to a clarification
      **Evidence:** · **Deviation:**
- [ ] **P5.T6** **V4** barge-in cancels queued TTS ≤ 200 ms
      **Evidence:** · **Deviation:**
- [ ] **P5.T7** **D3 pilot** — narration during long actions, best-effort, **or cut with the reason recorded**
      **Evidence:** · **Deviation:**
- [ ] **P5.T8** Thread stacking; `⌘K → recent threads`
      **Evidence:** · **Deviation:**

### Exit gate
- [ ] Flagship B end-to-end, map updates — **Screenshots:**
- [ ] Flagship C shows a real recipient count + typed confirm — **Screenshot:**
- [ ] `SchemaCard` renders ≥ 5 unregistered types, no raw JSON — **Screenshots:**
- [ ] Follow-up reference resolves or clarifies — **Recording:**
- [ ] Barge-in ≤ 200 ms — **Measurement:**
- [ ] D3 shipped or cut with reason — **Evidence:**

---

# PHASE 6 — Roles, Mobile, Onboarding, Demo & Cutover
**Status:** ⬜ · **Sessions:** 2 · **Depends on:** P5 · **Plan:** §8 → PHASE 6

- [ ] **P6.T1** Role-scoped rail and scenes (owner / dispatcher / technician)
      **Evidence:** · **Deviation:**
- [ ] **P6.T2** Technician mobile journey, **≤ 2 taps per step**, one-thumb
      **Evidence:** · **Deviation:**
- [ ] **P6.T3** Dispatcher journey: map → assign → escalate
      **Evidence:** · **Deviation:**
- [ ] **P6.T4** `FirstRunScene.tsx` from real `setup/status` + `integrations/status`, names the exact next action
      **Evidence:** · **Deviation:**
- [ ] **P6.T5** Type/spacing sweep — every `text-[Npx]` → token; **nothing < 11 px**; contrast audit
      **Evidence (before/after grep + contrast table):** · **Deviation:**
- [ ] **P6.T6** Modes + non-dismissible chip; preview shows veils not zeros; `"SAMPLE OPS"`
      **Evidence:** · **Deviation:**
- [ ] **P6.T7** **C-17 CUTOVER** — `/jarvis` owners → Thread. **Own commit, one line.**
      **Evidence (commit SHA):** · **Deviation:**
- [ ] **P6.T8** Delete `CommandBar` `ApprovalDock` `ActivityRail` `CommandPalette` — each only after a passing replacement snapshot
      **Evidence (`git rm` list):** · **Deviation:**

### Exit gate
- [ ] Owner `/jarvis` renders the Thread — **Screenshot:**
- [ ] `grep -rhoE "text-\[[0-9.]+px\]" src/components/jarvis` → 0 — **Evidence:**
- [ ] Contrast table, all ≥ 4.5:1 — **Table:**
- [ ] Technician mobile ≤ 2 taps per step — **E2E + screenshots:**
- [ ] Preview mode: zero fabricated numbers — **Screenshot:**
- [ ] `/jarvis/classic` still works — **Screenshot:**

---

# PHASE 7 — Truth, Recovery, Performance & Certification
**Status:** ⬜ · **Sessions:** 2 · **Depends on:** P6 · **Plan:** §8 → PHASE 7

- [ ] **P7.T1** Failure taxonomy (§6.8) + `RecoveryPanel.tsx`; exhaustive switch, **no `default`**
      **Evidence:** · **Deviation:**
- [ ] **P7.T2** **C-08** `cancelled` + `escalated` render distinctly; all 8 `RunState` + 6 `StepState` exhaustive
      **Evidence:** · **Deviation:**
- [ ] **P7.T3** Compensation first-class: M13, `"Rolled back"`, compensation receipt
      **Evidence:** · **Deviation:**
- [ ] **P7.T4** Degraded integrations → `PermissionVeil` + setup link; never blank, never zero
      **Evidence:** · **Deviation:**
- [ ] **P7.T5** All 10 certified paths green
      **Evidence:** · **Deviation:**
- [ ] **P7.T6** Automated contradiction sweep — every visible number carries `data-source`
      **Evidence:** · **Deviation:**
- [ ] **P7.T7** Perf: 5 cold Lighthouse desktop + mobile; bundle ≤ 250 KB gz; ≥ 55 fps; event→pixel median + p95
      **Evidence:** · **Deviation:**
- [ ] **P7.T8** `docs/jarvis-v3-certification-<date>.md` + `docs/motion-promoted.md` + the shipped voice table
      **Evidence:** · **Deviation:**

### Certified paths
- [ ] golden · desktop — **Evidence:**
- [ ] golden · mobile 390 — **Evidence:**
- [ ] golden · **by voice** — **Evidence:**
- [ ] clarification — **Evidence:**
- [ ] flagship B — **Evidence:**
- [ ] flagship C — **Evidence:**
- [ ] failure + recovery — **Evidence:**
- [ ] degraded (API killed mid-run) — **Evidence:**
- [ ] signed-out hygiene (< 5 req/30 s, no fabricated numbers) — **Evidence:**
- [ ] first-run / unconfigured tenant — **Evidence:**

### Exit gate — DEFINITION OF DONE
- [ ] All 10 certified paths green — **Evidence:**
- [ ] Every visible number carries `data-source` — **Automated check:**
- [ ] All 8 `RunState` + 6 `StepState` render distinctly — **Screenshot grid:**
- [ ] Every failure kind offers a recovery affordance — **Screenshots:**
- [ ] API killed mid-run → truthful degraded → recover → relight — **E2E:**
- [ ] Refresh + reconnect restore truthful state — **E2E:**
- [ ] Cold Lighthouse ≥ 85 perf / ≥ 95 a11y, desktop + mobile, 5 runs — **Evidence:**
- [ ] axe zero violations, every scene, both widths — **Evidence:**
- [ ] Keyboard-only completes all three role journeys — **Transcript:**
- [ ] Zero console errors on all certified paths — **Evidence:**
- [ ] ≥ 55 fps in execution with 6 lanes; initial JS ≤ 250 KB gz — **Evidence:**
- [ ] Event→pixel median ≤ 1200 ms SSE / ≤ 5000 ms poll — **Evidence:**
- [ ] **Golden journey flawless: by voice and by keyboard, desktop and mobile** — **Evidence:**

---

## SESSION LOG

<!-- Newest first. YYYY-MM-DD · P<n> · tasks done · findings · next task · blockers -->

- **2026-07-29 · P1 COMPLETE (T1–T12, 12 commits, `c660045`…`17145c7`)** · Executed Phase 1
  end to end. **All five P1 defects closed with measured evidence, plus C-21.** C-01: KpiStrip
  rewritten onto Truth-returning kernel selectors + `Metric`; signed-out `"$0"` occurrences
  **2 → 0**, five `PermissionVeil`s where the zeros were. C-02: the hardcoded first name is
  gone; signed out now reads "Good morning 👋" with no name. C-03: `selectPendingApprovals`
  implements the §4.7 cap against a `PENDING_LIST_CAP = 100` **verified in source** at
  `actions/pending/route.ts:49`. C-05: `SAMPLE OPS` over `sim ·` rows. C-15: **84 → 0**
  requests to `/api/jarvis/*` in identical 30 s signed-out windows (baseline measured in a
  throwaway git worktree at `c205cb6`, same harness, so the before/after is real rather than
  asserted). C-21 closed as a side-effect: 5 cold Lighthouse runs scored **98/98/98/98/98**
  with **TBT 0 ms every run**, versus v2's unreproducible 56→98 / 1,460→30 ms — the spread was
  the 401 storm competing for the main thread during load, so fixing C-15 fixed the
  measurement. 77 unit tests, `npm run lint` clean, `tsc --noEmit` exit 0, 4 Playwright tests
  green. **Three findings worth carrying forward.** (1) The plan's own C-02 detector
  (`grep -rn '"Param"' src/`) returned 0 *before any work was done* — the literal was bare JSX
  text at `HeaderBand.tsx:61`, not a quoted string at `:66`. A green gate that never could have
  failed. (2) `KpiStrip` had **9** `?? 0`, not six, and referenced **no** degraded flag at all —
  worse than the plan assumed, and exactly why it rendered `$0`. (3) `@testing-library/react`
  installed but **cannot run**: v16 needs an `@testing-library/dom` peer *and* a DOM
  environment, neither authorised by this plan — so every P1 test is a pure-function test
  (**BLOCKER B-1**, needs a decision before P2.T1). The two ESLint bans shipped as **ratchets**
  (error tree-wide, current violators enumerated and only ever shrinking) so `npm run lint`
  is green at every commit — and the `?? 0` rule immediately caught one in my own new
  `selectors.ts`, which was fixed rather than exempted. 16 deviations recorded in full.
  **Verifying the exit gate found one more real defect and it was fixed, not caveated:**
  `grep "?? 0" panels/` returned 14 rather than the 11 I expected — `HeaderBand` still coerced
  two network counts into its status sentence, so a signed-out page asserted **"Systems idle."**
  off four 401s. That is C-01 in prose, and it would have shipped behind a gate I could have
  marked green with a footnote. Closed in `9e42412`; `HeaderBand` now has no `useJarvis` and no
  `?? 0` at all. All visual and perf evidence was then **regenerated against final HEAD** rather
  than left pointing at the pre-fix commit — 81 unit tests, 4 Playwright tests, and a fresh set
  of 5 cold Lighthouse runs (again 98 × 5, TBT 0 ms × 5).
  **Then I ran the FULL e2e suite rather than only my own two specs, and it was not clean.**
  Three real problems, all fixed in `e649548`. (1) `jarvis-public.spec.ts` asserted
  `"LIVE OPS"` is visible on a **signed-out** page — the suite was actively pinning defect
  C-05 in place. (2) **All 26 committed visual snapshots still depicted the pre-P1 defective
  surface and passed anyway**: the Command Center diff measured **32,413 px, ratio 0.04**
  against a `0.05` tolerance — it passed by a 0.01 margin, so the net could not see five KPI
  numbers becoming permission veils. Regenerated all 26 (plain `--update-snapshots` rewrites
  only on failure and changed nothing; `--update-snapshots=all` was needed). (3) My golden
  baseline spec ran under both projects. **Full suite now 52 passed / 0 failed, both
  projects.** Carry forward: a 5 % full-page tolerance is too loose to be a regression net,
  and **P6.T5 and P7.T7 depend on these snapshots** — tighten it, or snapshot the KPI strip
  and header as their own elements, before P6.
  **Next:** resolve B-1 and the `TEST_OWNER_*` credentials, then P2.T1 · **Blockers:** B-1
  (DOM test env), B-2 (§5.5 has no `unavailable:"server"` row), and `TEST_OWNER_*` still
  absent — every P2 exit-gate line is an authenticated journey.

- **2026-07-29 · v3 AUDIT + PLAN (Opus 5, no product code modified)** · Re-audited voice
  feasibility and workflow maturity, then authored plan v3 + this state file. **Three new
  findings not in v2.** (1) `useVapiSession.tsx:283` starts a Vapi **web** call, but
  `webhooks/vapi/route.ts:188` resolves identity from `callMeta?.customer?.number`, which a
  web call never has → `staffCtx` is always null → every browser voice instruction hits the
  refusal branch and creates a handoff. Browser voice cannot act today. (2) The **phone**
  voice path is mature and correct — `finnor_instruct` → `handleInstruction` with
  `sessionId: vapi:{callId}`, and `finnor_confirm` → spoken approval bound to *that
  session's* `pending_confirmations` rows with honest failure reporting; short-term turn
  memory is written per session with a 30-minute TTL, so follow-up references are a solved
  backend problem. (3) `domain-plugins/invoice-to-cash/index.ts:55-72`'s `simulate()`
  returns a structured `predicted` object (`amountUsd`, `fieldChanges`, `steps`,
  `expectedResult`) — the only plugin in the repo that hands the frontend a real prediction,
  which decided the golden workflow. Also verified from `@vapi-ai/web@2.6.1`'s own type
  declarations that partial transcripts, `say`, `add-message`, `control` mute/unmute and
  barge-in are all available (partials are currently discarded at `useVapiSession.tsx:200`),
  and that word-level timing, client hold/resume and any tools-while-speaking ordering
  guarantee are **not**. Golden workflow selected: **Invoice-to-Cash**, scored against all
  five criteria in §1.2. Secondaries: Lead→Water Test→Dispatch, Bulk Notify.
  **Next:** P1.T1 · **Blockers:** none yet — but read `## BLOCKERS` before starting P2.

---

## DEVIATION INDEX

<!-- P<n>.T<m> · what the plan said · what reality was · what was done instead -->

| # | Task | Plan said | Reality | Done instead |
|---|---|---|---|---|
| D-1 | Discovery | `grep -rn '"Param"' src/` finds C-02 at `HeaderBand.tsx:66` | Returns **0** — the literal is bare JSX text at **`:61`**, never a quoted string. The gate could never detect the defect. | Fixed the real defect; recorded the detector as ineffective in both the Discovery slot and the exit gate. |
| D-2 | Discovery / T7 | "remove all **six** `?? 0` (`KpiStrip.tsx:34-41`)" | **9** occurrences on 9 lines: 35–41, plus 71 and 73. | All 9 removed. |
| D-3 | Discovery | `grep -c "Degraded" KpiStrip.tsx` implies degraded handling exists | **0** — KpiStrip never consulted a degraded flag at all. Worse than assumed; it is why C-01 rendered `$0`. | Rewrote onto Truth-returning selectors, which subsume the degraded flags. |
| D-4 | T1 | Script is exactly `"vitest run"`, and must exit 0 with zero tests | Vitest exits **1** on no test files. | `passWithNoTests: true` in `vitest.config.ts`, so the script string stays verbatim. |
| D-5 | T1 | Vitest configured via esbuild | Vitest 4 uses **oxc**; esbuild options ignored with a warning. `tsconfig` has `"jsx": "preserve"` for Next, so `.tsx` in a module graph fails to parse. | `oxc: { jsx: { runtime: "automatic" } }`, plus placeholder `NEXT_PUBLIC_SUPABASE_*` in `test.env` (Supabase client validates its URL at module load). |
| D-6 | T1 | @testing-library/react is usable | Needs `@testing-library/dom` peer **and** a DOM env — neither authorised. | `environment: "node"`; all P1 tests written as pure-function tests. **See BLOCKER B-1.** |
| D-7 | T2 | "6 type tokens" | Each token is a 4-part spec (size/line-height/weight/tracking); one custom property cannot hold four values. | 6 `--j-fs-*` names verbatim (size) + mechanically-named `--j-lh-*/--j-fw-*/--j-ls-*` companions + one `.j-fs-*` class per token applying all four. |
| D-8 | T2 | "add the 6 colour semantics" | All six tokens **already existed** at `jarvis-theme.css:11-17`; §5.2 specifies meanings, not hexes. | Added the binding semantics contract as the enforceable record. No new colour names invented. |
| D-9 | T4 | Ban `?? 0` **on `useJarvis()` fields**; ban `useJarvis` outside the kernel | 21 files import `useJarvis`, 16 contain `?? 0`. A big-bang ban leaves `npm run lint` red, which the exit gate forbids. Type-aware data-flow is not expressible in esquery. | **Ratchets:** `error` tree-wide with current violators in `excludedFiles`; new violations fail immediately, the list only shrinks. `?? 0` banned outright within the tree — strictly stronger, and it caught one in my own new code. |
| D-10 | T5 | Render §5.5 through `SkeletonStat`/`EmptyState`/`PermissionVeil`/`ErrorState`/`StaleFog` | `StaleFog`'s own copy is "as of 2m ago", not §5.5's "Last confirmed 2m ago"; `EmptyState` had no amber tone and no link affordance for "Not connected yet." + setup link. | Two additive, backwards-compatible props (`StaleFog.caption`, `EmptyState.tone`/`actionHref`). Omitting them reproduces pre-P1 output exactly. |
| D-11 | T6 | Four selectors, each returning `Truth<T>` | `selectOverdueInvoices` must supply both a count and a dollar total; two Truths for one row is the contradiction §4.7 forbids. | Returns `Truth<{count, totalUsd}>` + a `mapTruth` projector. Selectors are pure functions over an explicit `SelectorInput`; a `useSelectorInput()` hook in `kernel/` is the single sanctioned bridge (required by T4's own ban). |
| D-12 | T7 | "KpiStrip onto selectors + Metric" | The cards' sub-lines carry numbers too ("0 payment links open"), and §4.7 names only four selectors. | 5 supporting read-model selectors added, all through the same gate. **No new fact displayed** — same 5 cards, labels, copy, colours, order. Flash-on-change now fires only between two *known* values. |
| D-13 | T8 | "use the signed-in first name" | Unspecified what to do when a Supabase user has no profile name. | `selectFirstName` → profile name, else email local part (the user's own real identifier), else `null` → greeting renders no name. |
| D-14 | T9 | "stop a lane on 401 → denied; backoff on 5xx/network" | Fixed `setInterval` cannot express a delay that depends on the last outcome; `pollSanity` used `.catch(() => null)`, discarding the status code needed to tell "refused" from "broke"; the visibility-change handler was a second way the storm restarted. | Self-rescheduling `setTimeout` per lane; `pollSanity` → `allSettled`; visibility refetch gated on session + not-denied; a 1 s watcher restarts lanes the moment a session appears. |
| D-15 | T10 | Header → `"SAMPLE OPS"` | A pulsing teal "live" dot sits beside the label and would restate the exact claim C-05 is about. | Label changed as specified; `sim` tracked as a row property rather than sniffed from text; dot goes static amber (§5.2 binds amber to "degraded, partial"). |
| D-18 | T13 (new) | The plan's P1 task list and exit gate never mention the **pre-existing** e2e suite | P1 changed four files it covers. Full-suite run: `jarvis-public.spec.ts` asserted `"LIVE OPS"` on a signed-out page (pinning C-05 in place), and all 26 visual baselines still depicted the defective surface yet passed — measured diff **32,413 px / ratio 0.04** vs a `0.05` tolerance. | Added an unplanned T13: rewrote the C-05 assertion, regenerated all 26 baselines with `--update-snapshots=all`, pinned the new spec to one project. Full suite 52/0. Hard rule 9 ("every phase leaves `/jarvis` working") made this non-optional. |
| D-17 | Exit gate | `grep "?? 0" panels/` → 0 for network values | First pass returned **14**, not 11 — `HeaderBand` still coerced two network counts into `statusSentence()`, so signed out it asserted **"Systems idle."** from four 401s: C-01 in prose. | Fixed rather than caveated (`9e42412`): counts come from selectors, a clause appears only when its fact is known, the sentence is omitted when nothing is known. Added `selectEventsToday` + 4 tests; `HeaderBand` off both debt lists. |
| D-16 | T11 | "assert < 5 requests" | Counting *all* requests including page assets makes "< 5" meaningless. | Budget counts `/api/jarvis/*` — the traffic that actually stormed. Non-vacuity proven: baseline makes 84 in the same window. |

---

## BACKEND ADDITIONS LEDGER

| # | Addition | Phase | Status | Evidence |
|---|---|---|---|---|
| B1 | Table `instruction_sessions` | P3 | ⬜ | |
| B2 | Table `instruction_events` (unique `(instruction_id, seq)`) | P3 | ⬜ | |
| B3 | Column `domain_actions.instruction_id` | P3 | ⬜ | |
| B4 | `POST /api/actions` optional `instructionId` + trace emission | P3 | ⬜ | |
| B5 | `GET /api/instructions/{id}` | P3 | ⬜ | |
| B6 | `GET /api/instructions/{id}/events?after={seq}` | P3 | ⬜ | |
| B7 | `GET /api/stream` (SSE) | P3 | ⬜ | |
| B8 | Non-buffering `src/app/api/jarvis/stream/route.ts` + allowlist | P3 | ⬜ | |
| B9 | `predicted` on `/api/actions/pending` and `/api/receipts/[id]` | P4 | ⬜ | |
| B10 | Web-only Vapi assistant (no `finnor_instruct`) | P2 | ⬜ | |

**Not touched by this plan:** `webhooks/vapi/route.ts` (the phone path stays exactly as it is).

---

*Current task is at `## NEXT EXACT TASK`.*
