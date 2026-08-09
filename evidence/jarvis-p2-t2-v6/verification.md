# P2.T2 — Work queue + Causal Spine

## Source contract

- `src/app/jarvis/work/page.tsx` is the dedicated Work route.
- `src/components/jarvis/panels/WorkSurface.tsx` reads only `jarvisClient.workCases()` and renders queue rows plus the exact seven chapters: `WHY`, `PLAN`, `OWNER`, `APPROVAL`, `EXECUTION`, `EVIDENCE & OUTCOME`, `NEXT ACTION`.
- The inspector is closed by default. Action, receipt, and entity selection open scoped detail without creating a second workflow or receipt model.
- `src/app/api/jarvis/[...path]/route.ts` now allowlists `read-models/work-cases`; the proxy does not invent or merge records.
- Existing `ActionRenderer`, `ApprovalCockpit`, `WorkflowTheater`, and `ReceiptContent` are reused for their original source-backed responsibilities.

## Verification

```text
npx tsc -p tsconfig.json --noEmit --pretty false --incremental false  PASS
npx vitest run src/components/jarvis/panels/WorkSurface.test.ts src/components/jarvis/kernel/scene-director.test.ts src/components/jarvis/bridge/OperationalConsole.test.ts --reporter=verbose  16/16 PASS
git diff --check  PASS
```

## Browser proof

The real local `/jarvis/work` route was reloaded through the in-app browser. With no authenticated tenant session, it showed the truthful `Source unavailable` / `Sign in to inspect tenant Work` state, `Cases 0`, and the empty Causal Spine prompt. No fixture rows or synthetic business records were added for visual proof.

The responsive metrics and drawer interaction are recorded in `responsive-metrics.json`. Screenshots were inspected at 1440×900, 768×1024, and 390×844; all three had zero horizontal overflow. At tablet and mobile widths the queue became a closed fixed drawer, and the mobile `Cases 0` toggle opened and closed it successfully.

## Remaining evidence boundary

An authenticated populated Spine capture is intentionally not claimed here: the current browser has no tenant session, and the live upstream route correctly refuses private Work data. The source contract, unit coverage, unauthenticated truth state, and responsive structure are verified; populated causal continuity remains part of the later Phase 2 cross-surface proof.
