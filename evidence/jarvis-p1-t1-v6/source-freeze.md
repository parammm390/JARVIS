# P1.T1 — Source freeze + screenshot geometry audit

Date: 2026-08-08

## Freeze

- `git rev-parse HEAD`: `1ea6d4de7d5bc877b54c3bf85eb432d81dc55f98`
- Branch: `main`
- The pre-task worktree already contained four modified `finnor-os/tests/integration/*` files, the untracked v6 plan/state files, and `docs/release/evidence/P4/`. Those files were preserved.
- No product source was edited for P1.T1.
- The in-app Browser runtime was attempted twice, including after a kernel reset. Its required `setupAtlasRuntime({ backend: "iab" })` failed before exposing a tab with `Cannot redefine property: process`. Read-only captures were therefore made with the repo's existing Playwright dependency.

## Route truth and captures

The canonical route is `src/app/jarvis/page.tsx` → `PersonalizedHome`. In the available local session there was no Supabase session. The truthful route rendered the public-preview branch of `InstructionThreadBridge`: real shell/LIVEFRAME/Orb/Thread surface, no private tenant data, and a real 401 on the user-preferences probe. The strongest owner-shaped geometry probe was the dev-only, visibly labelled `?fixture=rest` harness; its fixture values are used only to measure layout, never as business evidence.

Artifacts:

- Public preview: `current-{1440x1000,768x1024,390x844}.{png,dom.txt,metrics.json,console.json}`
- Owner-shaped labelled geometry: `fixture-rest-{1440x1000,768x1024,390x844}.{png,metrics.json,console.json}`

## Exact source bindings

| Semantic owner | Current source path | API/read model/state | Reuse / change | Evidence |
|---|---|---|---|---|
| `/jarvis` page | `src/app/jarvis/page.tsx`; `src/components/jarvis/PersonalizedHome.tsx` | `JarvisAuthProvider`, `JarvisDataProvider`; owner → `InstructionThreadBridge`; dispatcher → `DispatchMap`; technician → `MyDay` | Reuse canonical route; P1 promotes the existing owner composition | `src/app/jarvis/page.tsx`; `PersonalizedHome.tsx` `RoleLanding` |
| global shell/nav | `src/components/jarvis/bridge/ThreadBridge.tsx` `ThreadBody`; `src/components/jarvis/bridge/OperationalConsole.tsx` `OperationsHeader`, `OperationalCommandIndex`; `src/app/jarvis/layout.tsx`; `src/app/jarvis/template.tsx` | `LiveFrameProjection`, auth role, diagnostics; one shared `VapiSessionProvider` | Reuse shell and route handoff; reshape composition, not auth | `ThreadBody`; `OperationsHeader`; `JarvisLayout`; `JarvisTemplate` |
| LIVEFRAME/kernel | `src/components/jarvis/kernel/liveframe.ts`; `store.tsx`; `presence.ts`; `selectors.ts`; `types.ts`; `transport.ts`; `execution-presentation.ts`; `recovery.ts` | Pure `deriveLiveFrame`; `InstructionState`, `Presence`, `TransportHealth`; linked runs/steps by `domainActionId`; `Truth<T>` selectors | Reuse; no second business state machine | `deriveLiveFrame`; `projectKernelLiveFrame`; `KernelInner` |
| Orb/presence | `src/components/jarvis/bridge/JarvisOrbSurface.tsx`; `JarvisAmbientOrb.tsx`; `Orb3D.tsx`; `ThreadBridge.tsx` `PresenceCore` | `liveframe.mode/focus/energy`; real voice/local volume; transport/presence | Reuse existing Orb; reduce/restage by scene | `PresenceCore`; `JarvisOrbSurface`; `data-jarvis-ambient-orb` |
| Thread | `src/components/jarvis/bridge/Thread.tsx`; `ThreadStack.tsx`; `ThreadBlocks.tsx`; `src/components/jarvis/kernel/store.tsx` | `Thread.machine.instructionState`, `instructionId`, nodes, context chips, trace events, receipt refresh | Reuse causal document; make it the active canvas object | `Thread`; `ThreadBody`; `applyTraceEvents` |
| command/voice | `src/components/jarvis/bridge/CommandRail.tsx`; `src/components/jarvis/lib/useVapiSession.tsx`; `src/components/jarvis/kernel/instruction.ts`; `src/components/jarvis/kernel/store.tsx` | Typed submit via `/actions`; Vapi call/transcript/local level; command anchor/pulse bus | Reuse input and voice authority; dock scene-dependent | `CommandRail`; `useVapiSessionInternal`; `submitInstruction` |
| approval | `src/components/jarvis/bridge/ThreadBlocks.tsx` `ThreadApprovalCockpit`; `src/components/jarvis/bridge/ApprovalCockpit.tsx` | `pendingActions` / receipts; confirm/reject/escalate through existing API authority | Reuse authority boundary; make approval the sole dominant decision in H3 | `ThreadApprovalCockpit`; `ApprovalCockpit` |
| workflow | `src/components/jarvis/bridge/ThreadBlocks.tsx` `ThreadExecution`/`ThreadExecutionWeave`; `src/components/jarvis/panels/WorkflowTheater.tsx`; `src/components/jarvis/kernel/execution-presentation.ts`; `workflow-presentation.ts` | `runs`, `terminalRuns`, steps linked by `domainActionId`; execution statuses | Reuse action-scoped theater; no tenant-wide blueprint | `ThreadExecution`; `WorkflowTheater`; `runsForActionIds` |
| receipt/evidence | `src/components/jarvis/bridge/ThreadBlocks.tsx` `ThreadReceipt`; `src/components/jarvis/bridge/ThreadVerification.tsx`; `src/components/jarvis/lib/ReceiptDrawer.tsx` | `/receipts?domainActionId=`, `/receipts/:id`, `receiptRefreshTick`, actual/expected evidence | Reuse; keep prediction separate from authoritative outcome | `ThreadReceipt`; `useNodeReceiptIds`; `ReceiptContent` |
| review queue | `src/components/jarvis/bridge/OperationalConsole.tsx` `OperationalSignalRail` | `useSelectorInput()` → `pendingActions`; `selectPendingApprovals`; `/actions/pending` | Reuse source rows; P1 humanizes/limits projection | `data-jarvis-operational-signals`; `data-source="api:actions-pending"` |
| recent signals | `src/components/jarvis/bridge/OperationalConsole.tsx` `OperationalSignalRail` | `selector.events` / `selectEventsToday`; medium lane `/events`; grouped event type/entity type | Reuse exact event rows; hide absent sections | `data-jarvis-event-feed`; `data-source="api:activity"` |
| operations/KPI field | `src/components/jarvis/bridge/OperationalConsole.tsx` `OperationalFloor`; `src/components/jarvis/panels/KpiStrip.tsx`; `SystemConsole.tsx` | `Truth` selectors over cash/pipeline/SLA/stats/runs; integrations; request/trace telemetry | Existing owner-shaped field is five KPI cards + provider/telemetry; P1 reshapes to ≤4 Business Pulse facts | `data-jarvis-operation-floor`; `KpiStrip`; `SystemConsole` |
| diagnostics/setup | `src/components/jarvis/bridge/ThreadBridge.tsx` `DiagnosticsDisclosure`; `src/components/jarvis/bridge/FirstRunScene.tsx` `SetupRail`; `data-core.ts` | `/setup/status`, `/integrations/status`, transport/poll/source freshness/API latency | Reuse as disclosure/context; do not promote to primary status | `data-jarvis-diagnostics`; `data-jarvis-setup-rail` |
| role/default scene | `src/components/jarvis/PersonalizedHome.tsx`; `src/components/jarvis/lib/jarvis-auth.tsx` | `/me` → `owner`/`dispatcher`/`technician`; `DEFAULT_HOME`/`ALLOWED_HOME`; `/user-prefs` | Reuse role authority; owner remains canonical Command Canvas | `RoleLanding`; `JarvisAuthProvider` |
| customer/360 | `src/components/jarvis/views.tsx` `CustomersView`; `src/components/jarvis/panels/DispatchMap.tsx` household drawer | `/resources/households`; `/read-models/household-360` | Reuse read model; later promote in P2 | `CustomersView`; `DispatchMap` household fetch |
| dispatch/map | `src/components/jarvis/panels/DispatchMap.tsx` | `/dispatch/map`; stored coordinates, stops, route, household drawer; real assignment POST | Reuse; later promote in P2 | `DispatchMap` |
| My Day | `src/components/jarvis/panels/MyDay.tsx` | `/technician/my-day` GET/POST; role-gated work orders/visits | Reuse role surface; later promote in P2/P3 | `MyDay` |
| invoices/cash | `src/components/jarvis/views.tsx` `InvoicesView`; `data-core.ts` `cashCollections`; `KpiStrip.tsx` selectors | `/resources/invoices`; `/read-models/cash-collections`; receipt/payment events | Reuse truthful cash sources; no fixture values on product surface | `InvoicesView`; `selectOverdueInvoices`; `pollSlow` |
| calls/Vapi | `src/components/jarvis/lib/useVapiSession.tsx`; `src/components/jarvis/panels/LiveCallPanel.tsx`; `src/app/api/voice/webhook/route.ts` | real Vapi call/transcript/local volume; webhook; no provider secret in browser | Reuse live voice boundary; no fake waveform when level absent | `useVapiSession`; `LiveCallPanel` |
| activity | `src/components/jarvis/bridge/OperationalConsole.tsx`; `src/components/jarvis/lib/data-core.ts`; `src/lib/jarvis-client.ts` | `/events` medium lane and `/activity` typed client; `EventRow` / `ActivityPage` | Reuse exact source; preserve “unavailable” | `pollMedium`; `jarvisClient.activity` |
| SSE/live query | `src/components/jarvis/kernel/transport.ts`; `src/components/jarvis/kernel/instruction.ts`; `src/lib/jarvis/useLiveQuery.ts`; `src/app/api/jarvis/stream/route.ts` | instruction SSE when enabled with poll fallback; shared query/poll data | Reuse existing transport; no new live channel | `startInstructionTransport`; `useLiveQuery`; stream route |
| JARVIS typed client/proxy | `src/components/jarvis/lib/api.ts`; `src/lib/jarvis-client.ts`; `src/app/api/jarvis/[...path]/route.ts`; `proxy-config.ts` | bearer forwarding, allowlisted proxy, typed endpoint wrappers | Reuse backend authority/proxy; no new client facts | `jarvisGet`/`jarvisPost`; proxy route; `jarvisClient` |
| visual tokens | `src/components/jarvis/jarvis-theme.css`; `src/app/globals.css`; `src/components/jarvis/ui/motion/choreo.ts`; `ui/motion/tokens.ts`; `bridge/*.module.css` | CSS variables, responsive material rules, existing Framer/CSS/SVG/WebGL motion | Reuse tokens/grammar; no dependency | `jarvis-theme.css`; `choreo.ts`; `tokens.ts` |

## Geometry audit

The first three columns are the measured, owner-shaped `?fixture=rest` geometry where available. Fixture values are visibly labelled and are not business evidence. Public-preview values are retained in the per-capture metrics files.

| Item | 1440 | 768 | 390 | Notes |
|---|---:|---:|---:|---|
| top chrome height | 73 px | 73 px | 63 px | `.jarvis-operations-header`; public preview and fixture |
| left nav width | 0 px | 0 px | 0 px | No permanent left primary nav exists in current canonical source; command index is a same-page link strip |
| center stage bbox | `(349,154) 670×479` | `(28,402) 712×509` | `(20,437) 350×421` | `[data-jarvis-composition-region="stage"]`; fixture rest; public preview is `(40,133) 1360×905`, `(0,133) 768×880`, `(0,180) 390×578` |
| Orb diameter | 410 px | 440 px | 363 px | `[data-jarvis-ambient-orb]`; fixture rest; current 1440 Orb is materially above v6 H0 target 220–260 px |
| right rail width | 362 px | 732 px | 366 px | `OperationalSignalRail`; it stacks below the stage below tablet width |
| command dock bbox | not rendered | not rendered | not rendered | Authenticated `showRail` path unavailable; public preview and fixture harness both intentionally omit the command rail |
| operations field height | 430 px | 609 px | 892 px | `OperationalFloor`; current five-card field dominates the lower scene |
| largest dead zone | 362×423 px | no horizontal void; stacked lower content | no horizontal void; stacked lower content | 1440 fixture: below the 95px Review Queue rail and above the 663px Operations Field |
| smallest meaningful text | 9 px | 9 px | 9 px | “Connection status is unavailable.”; below v6’s 11px meaningful-copy floor |
| permanent card/panel count | 12 | 12 | 12 | fixture `.j-panel`, `.jarvis-ops-panel`, and composition regions; public preview measures 5 |
| peer status pill count | 3 chips / 1 primary status | 3 chips / 1 primary status | 3 chips / 1 primary status | fixture includes labelled `FIXTURE · rest`, `Ready`, telemetry chip; public mobile hides header `[data-primary-status]` |
| ambient loop count | 6 named loops | 6 named loops | 6 named loops | Computed CSS inventory on fixture: five Orb loops + `jarvis-cursor`; current rest budget is not yet ≤2 |
| horizontal overflow | none | none | none | `scrollWidth === viewport width` in both public and fixture captures |

## Mascot and runtime limitation

- Mascot source: **not found in repository**. `rg` found no mascot/avatar/assistant asset or component in `src`/`public`; the current route has no image or mascot overlay. Existing mascot probe is also empty: `evidence/jarvis-p1-t1-mascot.json` (`images: []`, `mascotNamed: []`). No product code was changed for it.
- Screenshot/runtime limitation: no authenticated Supabase session was available in this workspace. Public preview is real but intentionally sparse; `?fixture=rest` is dev-only and visibly labelled. The capture logged the expected unauthenticated `/api/jarvis/user-prefs` 401 and no page errors. WebGL driver warnings were capture-environment warnings, not product exceptions.

## P1.T1 conclusion

Source is bound. The next implementation task is P1.T2: cut the existing owner-shaped dashboard composition into the fixed H0 Command Canvas / Now Rail / Business Pulse contract.
