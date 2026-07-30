# JARVIS v3 certification — 2026-07-30

Status: **not certified**. This is the required certification record, not a claim
that every exit gate is green. Evidence below reflects repository state at commit
`497c805`.

## Implemented P7 work

| Task | Evidence | Status |
| --- | --- | --- |
| P7.T1 recovery taxonomy | `d85baee`; `npm run test:unit -- recovery.test.ts` → 2 passed; `npx tsc --noEmit`; `npm run lint` | implemented |
| P7.T2 run and step coverage | `5e27b39`; `workflow-presentation.test.ts` covers 8 `RunState` and 6 `StepState` values | implemented |
| P7.T3 compensation receipt | `1e25f62`; web tests/typecheck/lint clean; FINNOR OS typecheck clean | implemented; DB integration is skipped under B-6 |

## Certified-path ledger

| Path | Evidence | Result |
| --- | --- | --- |
| Golden desktop | No approved safe live action; B-5 | unchecked |
| Golden mobile | No approved safe live action; B-5 | unchecked |
| Golden by voice | No audio input device for a real browser call | unchecked |
| Clarification | P2 fixture evidence exists; not recertified in P7 | unchecked |
| Flagship B | B-7: live planner produced no actionable plan | unchecked |
| Flagship C | B-7: no safe actionable plan approved | unchecked |
| Failure and recovery | P7 pure frontend tests; DB test unavailable under B-6 | unchecked |
| Degraded API mid-run | P7.T4 blocked by B-12 (no authoritative setup deep link) | unchecked |
| Signed-out hygiene | P6 preview evidence exists; not recertified in P7 | unchecked |
| First run | Status-backed scene exists; not recertified in P7 | unchecked |

## Measurements

All Lighthouse runs used the production build (`next build` then `next start -p
3300`), a fresh Lighthouse browser/cache per run, Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, and
`--only-categories=performance,accessibility`. The five cold report files are
in `/tmp/jarvis-p7-{desktop,mobile}-N.json` on the measurement host.

| Target | Perf runs | A11y runs | Median / worst detail | Gate |
| --- | --- | --- | --- | --- |
| Desktop preset | 60, 95, 95, 94, 95 | 100, 100, 100, 100, 100 | perf median 95, worst 60; FCP median 313.729ms; LCP median 1565.257ms; TBT median 0ms, worst 1301.557ms; CLS 0 all runs | passes median perf/a11y, but first cold run is a material outlier |
| Mobile preset | 72, 72, 72, 72, 72 | 100, 100, 100, 100, 100 | perf median/worst 72; FCP median 1560.330ms; LCP median 6072.904ms; TBT median 27.601ms, worst 63.476ms; CLS 0 all runs | **fails** required mobile perf ≥85 |

Initial JavaScript was measured from `.next/app-build-manifest.json`'s complete
`/jarvis/page` client-file list after the same production build. Gzip sum:
**525,824 bytes** (513.5 KiB), which **fails** the ≤250 KiB gate. This is a
measurement, not an estimate.

Six-lane execution fps and event-to-pixel median/p95 remain unmeasured. A live
execution path would require explicit safe-action authorization and a planner
outcome that satisfies B-5; event timings additionally require a sanctioned
migrated database (B-6).

## Blocking conditions

- B-5: no approved safe live execution path.
- B-6: no sanctioned migrated database for integration timing/compensation evidence.
- B-7: flagship plans cannot be exercised safely/live.
- B-12: no authoritative integration setup deep link for P7.T4.
- A real microphone is unavailable for browser-voice certification.
- P6 role/mobile/cutover visual evidence remains incomplete and is not certified by P7.

## Shipped browser-voice capability table

| Capability | Source status | Shipped status |
| --- | --- | --- |
| V1 partial transcript | `useVapiSession.tsx` stores non-final user transcripts | wired to Command Rail; not exercised with a real mic this session |
| V2 final transcript | SDK message handler stores final transcript | wired; live voice evidence absent |
| V3 browser TTS | `say()` sends Vapi `say` with interruptions enabled | wired for plan/outcome; live voice evidence absent |
| V4 barge-in | local mic activity drives user-speaking state; Vapi interruptions enabled | code wired; no live latency measurement |
| V5 duck/unmute assistant | `duck()` / `unduck()` send Vapi control messages | available in hook; no current caller found |
| V6 inject context | SDK type permits `add-message` | not shipped: no send path in source |
| V7 local mic level | `local-volume-level` updates state | wired; not exercised with a real mic |
| V8 follow-up session | `submitInstruction` sends persisted `sessionId` | wired; live flagship evidence blocked by B-7 |
| V9 persistent voice thread | backend phone-path capability | not shipped for browser voice |
| D1 browser spoken approval | no resolved browser voice identity | not shipped |
| D2 word timing | unavailable from provider payload | not shipped |
| D3 guaranteed tools while speaking | no ordering guarantee | not shipped; existing narration is explicitly best effort |
| D4 client hold/resume | absent from SDK controls | not shipped |
| D5 speaker diarisation | absent from browser payload | not shipped |
