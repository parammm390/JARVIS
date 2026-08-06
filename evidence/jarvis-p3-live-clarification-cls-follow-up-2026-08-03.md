# P3 live clarification / CLS follow-up — 2026-08-03

## Scope and safety boundary

This was an authenticated production check of `/jarvis` using the repository's
dedicated owner test account. The prompt was:

```text
Book a water test for the Hendersons this week and give it to whoever's closest
```

The test submits once, waits for the real clarification state, changes the
viewport from 1440×900 to 390×844, reloads, and verifies the same instruction
restores. It does not answer, skip, cancel, approve, reject, retry, or invoke
an external workflow action.

## Defect and source fix

The first authenticated run exposed a real layout defect. The setup rail grew
from its unavailable response to its source-backed attention response while the
instruction was being processed; the desktop setup rail changed from 86 px to
118.390625 px and moved the live canvas by 32.390625 px. The resulting live CLS
was above the Plan §5.4 limit.

The fix keeps the closed setup-details disclosure in the existing setup row and
keeps the unavailable branch's details slot truthful (`Details unavailable`).
The rest/live canvas geometry was also normalized so both compositions use the
same grid and the mobile presence slot keeps its reserved 132 px row.

Changed source:

- `src/components/jarvis/bridge/FirstRunScene.tsx`
- `src/components/jarvis/jarvis-theme.css`
- `e2e/jarvis-p3-live-clarification-responsive.spec.ts` (rect/source capture)

## Before-fix live results

The strict test was run against the canonical host with the existing test
credentials loaded from `.env.local`:

| Instruction id | 1440 CLS | 390 CLS | Result |
|---|---:|---:|---|
| `1bf03b74-3ae1-4d84-b425-be6426bd06fb` | 0.0424748625781801 | 0.0026607223404174385 | failed desktop CLS gate |
| `81b2783c-9238-48d6-b7eb-6b3176d7d948` | 0.057007065988371894 | 0.002630881504053304 | failed desktop CLS gate |
| `51b53680-5a0e-4da2-8227-cfcd97334cea` | 0.03907948814861078 | 0.0028145423634031042 | user-directed stop after snapshot; no verdict |

The earlier pre-stabilization live run had measured 0.05518871211124218 at
1440 and 0.049237953449656785 at 390. Those values remain recorded as the
original defect baseline.

## Final live result after the fix

Production deployment `dpl_6N7cPFKRNTySdnWzNTdMvCcKy5eg` was inspected as
`READY` and aliased to `https://finnorai.com/jarvis`. The exact command was:

```text
PLAYWRIGHT_BASE_URL=https://finnorai.com npx playwright test e2e/jarvis-p3-live-clarification-responsive.spec.ts --project=desktop-chromium --reporter=line
```

The result was **1 passed (17.9s)**. The real instruction id was
`470ab20a-46f9-4742-9c28-33c5466a6fb2`.

| View | Restored | State / active block | Focus | Document width | CLS |
|---|---|---|---|---:|---:|
| 1440×900 before reload | `false` | `plan` / `plan` | `householdId` | 1440 | **0.02990387199909435** |
| 390×844 after reload | `true` | `plan` / `plan` | `householdId` | 390 | **0.004001170680839478** |

The strict assertion is `CLS ≤ 0.03`; both observed values satisfy it. The
test also confirmed the same instruction id after reload, no horizontal
overflow, visible clarification, and focused clarification input. The final
run captured real browser receipt→next-paint measurements; the values were
finite and non-negative. Transport-class separation and the complete
ready→terminal lifecycle/retry are not claimed by this test.

## Gate consequence

This closes the live CLS/layout-shift requirement for the tested 1440/390
clarification-and-restore journey. It does not by itself close the complete
lifecycle/retry gate, the separate SSE/poll §5.4 transport-class timing gate,
or the Plan's cumulative score gate. No Phase 3 completion or score movement is
claimed here.

## Addendum — closed-row geometry and repeat run

Adding the restore-settlement assertion to the evidence test exposed one
intermediate run in which the mobile attention branch still changed the setup
row height. That run was not counted as a pass:

- instruction `f62d199c-2d47-4bb7-839a-f40962c3a27a`;
- 1440 CLS `0.03591670917517854`;
- 390 CLS `0.0585412079458926`;
- restored Thread entries were settled, but the mobile setup rail changed
  height from the unavailable branch to the attention branch.

The follow-up source fix gives both closed branches the same minimum-width
control geometry and keeps the attention details body absolutely positioned
until the user opens it. Production deployment
`dpl_DcbEUsJTuiYqzYbZbFhDcWk8W1ju` reached `READY`. The strict test was rerun
against the canonical alias and passed **1/1 (16.7s)** for instruction
`e105256e-2279-454a-a270-27fae589ccd7`:

| View | Restored | Entries | CLS | Event→pixel observation |
|---|---|---|---:|---|
| 1440×900 before reload | `false` | `entering` (fresh) | **0.01930893778544231** | finite, non-negative rows |
| 390×844 after reload | `true` | `settled`, `settled`, `settled` | **0.004535921583271948** | finite, non-negative rows |

Both snapshots retained `plan` as the active block, focused `householdId`, and
document width equal to the viewport. The strict assertion remains `CLS ≤
0.03`. This repeat run is the current live CLS/restore evidence; it still does
not establish separate SSE/poll transport classes, the complete lifecycle plus
retry, or the score gate.
