# P3 authorized authenticated-live evidence — 2026-08-03

This artifact records the bounded production-browser run authorized by the user in this session. The session used the authenticated `/jarvis` tab at `https://finnorai.com/jarvis?p3audit=restore-metrics-3`. No credentials, cookies, local storage values, or tokens were read. No approval, clarification answer, microphone permission, or external-workflow control was activated.

## Scope and baseline

- The authenticated tab initially restored a real clarification thread for the water-test instruction (`Needs one detail`, `data-thread-restored="true"`, `decision`/clarification surface). The visible clarification was cancelled through the thread's `Cancel` control; the resulting receipt said `Cancelled — nothing was sent.`
- The authenticated surface then showed setup attention (`6 connections need attention`) and a degraded/attention posture. The observed approval count was `14`; this is an observation only, not a claim about the underlying queue.
- The browser had no horizontal overflow in the captured terminal state: `clientWidth=1462`, `scrollWidth=1462`.

## Controlled instruction A

Submitted the bounded stock-lookup instruction `Check the RO membrane stock` through the authenticated command textbox.

- Frontend instruction id: `1c732b33-975b-4600-b52e-3b67971a6b6f`.
- The live Thread visibly progressed through `Heard`, `Understood`, `Plan`, `Execution`, and `Receipt`.
- Settled projection observed: `resolved`, receipt focus, `restored=false`, seven trace-metric rows.
- The visible plan described one `check_stock_level` action and stated that stock is not changed. The terminal receipt nevertheless said `1 of 1 action sent. Check stock level · sent` and exposed `fieldChanges none`, output id `1fafe485-e9bf-4065-b50a-e301bb0f20c5`, SKU `MEMB-RO`, quantity `3`, reorder threshold `5`, and `status success`.
- The same receipt also displayed `Approval awaiting approval` and `expected.answered yes`, with the action marked finalized. This is an observed UI/backend result; it is not interpreted as proof that approval was clicked or that an external workflow was initiated.
- No `verifying` block or `verifying` trace-metric row appeared. The observed live edge ended at `executing → completed/receipt`.

The captured frontend event-received→next-paint values, in sequence, were:

```text
received/heard       0.0 ms
context_retrieved    11.3 ms
planning             11.3 ms
plan_ready           0.0 ms
action_created       0.0 ms
executing            27.9 ms
completed/receipt    25.1 ms
```

These are the existing frontend `data-jarvis-trace-metrics` values. They are not server event-creation timestamps and do not by themselves certify the Plan's separate SSE/poll transport gate.

## Refresh result after instruction A

After the terminal receipt, the authenticated tab was reloaded. The resulting surface was `Needs attention`/degraded with no active Thread blocks, no restored Thread marker, and no trace-metric payload. This was a terminal refresh result, not proof of mid-flight refresh/restore continuity. The prior restored clarification observation remains supporting evidence only.

## Controlled instruction B

Submitted the second bounded stock-lookup instruction `Check the RO membrane stock again` through the same authenticated command textbox.

- Frontend instruction id: `c1361a8b-c8c6-4b93-8ddb-38ba86bd5d0f`.
- The live Thread visibly settled with the same five blocks: `Heard`, `Understood`, `Plan`, `Execution`, and `Receipt`.
- The receipt again said `1 of 1 action sent. Check stock level · sent`; no approval/external-workflow control was clicked.
- No `verifying` block appeared.
- The final DOM exposed seven trace-metric rows:

```text
received/heard       0.0 ms
context_retrieved    26.4 ms
planning             26.4 ms
plan_ready           0.0 ms
action_created       0.0 ms
executing            31.6 ms
completed/receipt    48.1 ms
```

The final live DOM remained horizontally stable (`clientWidth=1462`, `scrollWidth=1462`). The only retry-labelled button in the Thread surface was absent because the instruction did not fail.

## Explicit retry invocation

The rendered retry control was inspected by its literal DOM ownership. The Thread had no `Retry` or `Try again` control because both controlled instructions reached a successful terminal receipt. The only available retry control was the Diagnostics disclosure's `Retry data` button, wired in the current worktree to the data lane's `refetchSlowLaneNow` callback (`ThreadBridge.tsx:226`, `ThreadBridge.tsx:839`).

That exact control was invoked once after opening `Diagnostics`:

- Before: transport `Polling`; last poll about four seconds old; source freshness about thirteen seconds; API latency about `1020 ms`.
- After: transport remained `Polling`; the poll timestamp refreshed; the surface remained `Done` with the receipt intact.
- Final diagnostics capture: `Transport=Polling`, `Last poll=3s ago`, `Source freshness=2s ago`, `API latency=1192 ms`, `Low power=Off`.

This is a successful diagnostics-data retry, not an instruction retry. The implementation's instruction retry (`store.tsx:1229-1235`) is reachable only from a Thread in the `failed` state; neither authorized live instruction entered that state, so no instruction retry was invented or invoked.

## Gate reconciliation

This run adds real authenticated production evidence for terminal lifecycle edges, frontend event-received→paint observations on the polling path, and the literal diagnostics retry behavior. It does **not** prove:

1. the complete required lifecycle because `verifying` was not observed;
2. instruction-level retry plus refresh/restore of the same active lifecycle;
3. separate authenticated SSE timing and a Plan-compliant SSE/poll timing artifact; or
4. an authoritative reviewer/Plan-defined cumulative score of at least `87/100`.

Therefore P3 remains open at the previously supported `4/7` exit-gate checks, the accepted score remains `10/100`, and no Phase 3 completion claim is made.

## Follow-up: deterministic validation failure and actual instruction retry

The current source contract defines `SubmitInstructionSchema.instruction` as `z.string().min(1).max(10_000)` (`finnor-os/packages/policy-schema/src/index.ts:52`). The authenticated command input itself had no `maxlength` attribute, so a bounded over-limit validation probe could exercise the frontend failure/retry path without reaching the planner or creating a business action.

- Submitted a typed test string of **10,033 characters** beginning `Controlled retry validation test`.
- The authenticated Thread entered the real failed presentation: `Needs attention`, `Needs recovery`, `No runnable action was recorded for this instruction.`, and the alert `The instruction stopped before JARVIS could complete it. Try again`.
- The Thread exposed both literal recovery controls, `Retry` and `Try again`. No trace-metric payload or action node was present.
- Invoked the exact `Try again` control once. After the retry settled, the Thread remained in the same truthful failed/recovery presentation with the retry controls still available, no action node, and no trace-metric rows.
- Because the API validates the request before `handleInstruction`, this controlled failure did not reach planning or execution; no business action, approval, or external workflow was triggered.

This closes the evidence gap for the frontend's actual instruction-retry interaction in isolation, but it does not close the complete P3 lifecycle gate: the retry was a validation failure, not a successful retry that reached `verifying` and terminal receipt.

## Follow-up: source and focused verification checks

The read-only realtime preflight passed: `npm run jarvis:realtime:verify` reported `PASS`. The focused kernel suite passed **17/17 files, 294/294 tests**; `npm run lint` reported no ESLint warnings or errors. The six-test authenticated route integration file was **skipped 6/6** because its local PostgreSQL availability probe returned false; those tests are not counted as passed.

Source inspection of `finnor-os/packages/orchestration/src/index.ts:107-214` confirms the synchronous `handleInstruction` trace emits `executing` followed directly by `completed` or `failed`. The trace schema enumerates `verifying` and `verified`, but this path does not emit either phase. This explains the missing live `verifying` observation; it is not filled with a frontend timer or inferred from the receipt.

The Plan's score contract still has no reproducible P3-specific scoring procedure: §7.1 says each point must link to visual/runtime evidence and permits reviewer adjustment, while §2.3/§1.3 define the cumulative score/release bar. No authoritative reviewer artifact exists in the workspace.

**Follow-up result:** actual instruction retry is now directly recorded, but P3 remains conservatively **4/7**, score **10/100**, with `verifying`, successful retry-plus-restore, separate SSE timing, and authoritative score still open.
