# Phase 5 discovery — 2026-08-03

This discovery follows Plan v4 Phase 5 and records source-backed contracts only. No business amount, recipient, policy, receipt, approval, or failure fact was invented.

## Source map and observed contracts

- `src/components/jarvis/bridge/ApprovalCockpit.tsx` owns the visible approval actions. The decision request is sent through the existing `jarvisPost` path; `recordDecision` and the success notice occur only after that request resolves. Failed decisions keep the action visible and surface the returned error message with retry/escalate recovery where the source permits it.
- `src/components/jarvis/bridge/approval-consequence.ts` owns consequence copy. The Phase 5 addition exposes a summary that withholds recipient totals and money totals when the action payload does not contain those facts, and only reports known policy versions.
- `src/components/jarvis/bridge/ThreadBlocks.tsx` owns the approval overlay and renders only the known consequence facts. The gate-rise marker is attached to the approval surface, and focus is moved to the live approval heading on mount.
- `src/components/jarvis/kernel/choreography.ts` owns the pure LF-08 gate-rise variants. The normal rise is 280 ms; reduced motion and restored state are immediate and do not replay the rise.
- `src/components/jarvis/bridge/ThreadVerification.tsx` owns predicted-versus-actual verification. It accepts a receipt refresh key and exposes the LF-15 converge marker only when a real same-receipt refresh is recorded.
- `src/components/jarvis/lib/ReceiptDrawer.tsx` owns receipt evidence, outcome/timing sections, same-ID silent refresh, copy, corrections, and recovery callbacks. It preserves the existing receipt identity instead of opening a second proof surface.
- `src/components/jarvis/bridge/RecoveryPanel.tsx` and `src/components/jarvis/kernel/recovery.ts` own failure-kind labels and legal recovery operations. Unsupported mutation controls are omitted; generic integration/input copy is used when the source has no provider-specific fact.
- `src/components/jarvis/lib/receipt-nav.ts` owns receipt anchors and the copy payload. The copied text is a compact receipt summary with objective, outcome, receipt ID, and link; it is not raw JSON.

## Unresolved runtime proof

The public live `/jarvis/next` shell rendered successfully in the browser, but it did not expose an authenticated approval, decision response, receipt refresh, or failure/recovery thread. Therefore the formal Phase 5 review gates remain open even though the source implementation and automated checks are recorded below.

## Continuation — 2026-08-04 live receipt and labelled approval fixtures

The existing live receipt anchor was reopened read-only at `https://finnorai.com/jarvis/next#receipt-42038263-2d61-4ec4-bf15-98ab2699e18c`. After a browser refresh, the same objective (`single_action: check_stock_level`), risk (`medium`), policy (`f02f896e · v2`), receipt evidence, tool outcome, timing, and predicted-versus-actual surface remained visible. The live surface still says `Actual outcome not recorded yet.`; this is not a predicted→actual completion claim. The `Copy receipt` control had one enabled match and clicking it changed the visible control to `Receipt copied`. A direct clipboard readback was unavailable in the browser runtime (`navigator.clipboard` was undefined), so no clipboard payload is claimed.

The dev-only, source-labelled fixture `flagship-c-approval-known` was inspected through the real Thread/Kernel/component tree at 1440×1000, 768×1024, and 390×844. It rendered one `role=dialog` with the focused `Needs your approval` heading, one `data-liveframe-motion="LF-08"` marker, the known `12 customers will be texted via SMS` consequence, policy `v1`, and zero horizontal overflow at each width (the 390 viewport reported a 382 px client width because of the visible scrollbar). The `flagship-c-approval-unknown` fixture rendered `An unknown number of customers will be texted.` and did not render the known `12 customers` count; it retained policy `v1`, one dialog, one LF-08 marker, and zero horizontal overflow. These fixtures are explicitly labelled and perform no business event.

The pending approval fixture exposed `data-liveframe-mode="decision"` and only the LF-08 marker; LF-09 was absent and no success notice was rendered before a decision response. This supports the negative ordering check for the second P5 gate but is not an authoritative decision-response recording. The targeted authenticated P5 browser suites were also run: **34 tests were skipped** because `TEST_OWNER_EMAIL` and `TEST_OWNER_PASSWORD` are not set; skipped tests are not counted as passes.
