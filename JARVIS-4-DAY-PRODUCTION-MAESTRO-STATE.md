# JARVIS 4-DAY PRODUCTION MAESTRO STATE — v1

**Plan:** `/Users/paramdave/FINNOR/JARVIS-4-DAY-PRODUCTION-MAESTRO-PLAN.md`
**Authored:** 2026-08-06
**Execution window:** 2026-08-06 → 2026-08-09
**Launch target:** Monday 2026-08-10
**Baseline commit:** `UNSET — P0.T1 MUST REPLACE BEFORE CODE CHANGES`
**Release candidate:** `not created`
**Release tag:** `not created`

---

## HOW TO USE THIS FILE

**Every execution session:**
1. Read this file top to bottom.
2. Read the plan top to bottom.
3. Go to `## NEXT EXACT PHASE`; execute the complete phase only.
4. Verify HEAD against `Latest verified commit`.
5. Run the phase discovery commands and save full output under `docs/release/evidence/P<n>/`.
6. Complete tasks in order. Do not skip or redesign.
7. Check a box only with concrete evidence.
8. Update the 44-action ledger and integration ledger as evidence is created.
9. Record deviations and blockers immediately.
10. Run the phase suite; fix failures until the exit gate is green.
11. Commit `jarvis-release P<n>: <phase result>`.
12. Update status, score, latest commit, session log, and next phase.

**Checkbox law.** A checked box requires a commit SHA, command + exit code, saved evidence path,
request/receipt/trace id, or measured number. “Looks right,” “should work,” and empty evidence are invalid.

**Executor law.** Do not create a new plan. Do not reduce 44 actions. Do not change approval floors. Do
not deploy production. When blocked, implement every independent task, write the exact blocker, and stop
only after the phase cannot progress further.

---

## STATUS

| | |
|---|---|
| **ACTIVE PHASE** | **P0 — Release Lock, Source Audit, and Clean CI** |
| **Latest verified commit** | `UNSET — P0.T1` |
| **Phases complete** | 0 / 5 |
| **Actions CORE-CERTIFIED** | 0 / 44 |
| **Actions LIVE-CERTIFIED** | 0 / 44 |
| **Open P0 defects** | 3 initial known-risk rows; reclassify from evidence |
| **Open P1 defects** | 11 initial known-risk rows; reclassify from evidence |
| **Readiness score** | 0.0 / 10.0 — measured after P0 baseline |
| **Sessions logged** | 0 |

## NEXT EXACT PHASE

> **PHASE 0 — Release Lock, Source Audit, and Clean CI**
>
> Read plan §0, §1, §3, §4, §5, and §6 PHASE 0 in full. Execute every P0 task in order. Do not
> begin P1. Continue until the P0 exit gate is green or every remaining item has a concrete blocker.
> Update this state file completely and commit `jarvis-release P0: establish certified baseline`.

---

## FOUR-DAY CLOCK

| Date | Required phase state by end of day | Actual | Status |
|---|---|---|---|
| Thu 2026-08-06 | P0 complete; P1 running | | ⬜ |
| Fri 2026-08-07 | P1 and P2 complete | | ⬜ |
| Sat 2026-08-08 | P3 complete | | ⬜ |
| Sun 2026-08-09 | P4 complete; RC tag created | | ⬜ |
| Mon 2026-08-10 | Owner-approved production runbook | | ⬜ |

---

## OVERALL COMPLETION LEDGER

| Phase | Name | Window | Status | Exit gate |
|---|---|---|---|---|
| P0 | Release Lock, Source Audit & Clean CI | Day 1 AM | ⬜ not started | ⬜ |
| P1 | Universal 44-Action Contract Hardening | Day 1 PM–Day 2 AM | ⬜ not started | ⬜ |
| P2 | Chaos, Voice, Model, Integration & Security | Day 2 | ⬜ not started | ⬜ |
| P3 | Full-Stack Staging & 15/25-User Load | Day 3 | ⬜ not started | ⬜ |
| P4 | Production Rehearsal, Certification & Launch Freeze | Day 4 | ⬜ not started | ⬜ |

Legend: ⬜ not started · 🟡 in progress · ✅ complete · 🔴 blocked

---

## READINESS SCORECARD

| Category | Weight | Current score | Evidence |
|---|---:|---:|---|
| 44-action contract coverage | 2.0 | 0.0 | |
| Security + approval + idempotency | 2.0 | 0.0 | |
| Failure/recovery/durability | 1.5 | 0.0 | |
| Integration + full-stack staging | 1.5 | 0.0 | |
| 15-user + 25-user load | 1.0 | 0.0 | |
| Observability + cost controls | 1.0 | 0.0 | |
| Release/backup/migration/rollback | 1.0 | 0.0 | |
| **TOTAL** | **10.0** | **0.0** | Launch requires ≥ 9.5 and zero P0/P1 |

---

## DEFECT LEDGER — LIVE TRACKING

Do not close a defect without exact evidence. Add every new failure discovered by the matrices.

| ID | Sev | Defect / unknown | Fix phase | Status | Evidence |
|---|---|---|---|---|---|
| R-01 | P1 | Clean monorepo CI/typecheck/test termination not freshly proven | P0 | 🔴 open | |
| R-02 | P1 | Package test harness previously stalled before collection | P0 | 🔴 open | |
| R-03 | P1 | Authorization-matrix failure previously reported | P0 | 🔴 open | |
| R-04 | P0 | 44 actions are not yet governed by one machine-enforced release spec/matrix | P0/P1 | 🔴 open | |
| R-05 | P0 | Cross-tenant, approval, and duplicate-effect proof is incomplete across all 44 | P1/P2 | 🔴 open | |
| R-06 | P1 | Current frontend 44/44 renderer and state coverage not freshly verified | P1 | 🔴 open | |
| R-07 | P1 | Migration head/staging application of evidence corpus not freshly proven | P0/P3 | 🔴 open | |
| R-08 | P1 | Configured live integration credentials and write guards are unknown | P0/P3 | 🔴 open | |
| R-09 | P1 | Voice cancellation/approval may remain deferred or incomplete | P2 | 🔴 open | |
| R-10 | P1 | Watch targets/cadence/alert destination may remain unconfigured | P2/P3 | 🔴 open | |
| R-11 | P1 | Sentry release/environment/alert routing not certified end to end | P2/P3 | 🔴 open | |
| R-12 | P1 | 15-user and 25-user concurrency not certified | P3 | 🔴 open | |
| R-13 | P0 | Backup restore and migration rollback not rehearsed | P4 | 🔴 open | |
| R-14 | P1 | Clean-checkout release build not proven | P4 | 🔴 open | |

---

## BLOCKERS

<!-- Append: date · phase.task · exact blocker · evidence · what is needed · who/what can unblock -->

*(none recorded yet)*

**Standing conditions:**
- Missing credentials are not a reason to claim live readiness. Mark the binding/action `BLOCKED-CONFIG`.
- Production endpoints/accounts must never be used by P0–P4.
- If staging identity cannot be proven, P3 live tests stop; local/emulator work continues.
- If P0 discovers a registry count other than 44, stop release work until the deliberate code change is
  reconciled with the fixed action spec.

---

# PHASE 0 — Release Lock, Source Audit, and Clean CI

**Status:** ⬜ not started · **Window:** Day 1 morning · **Depends on:** none
**Plan section:** §6 → PHASE 0
**Starting SHA:**
**Ending SHA:**

### Discovery output

```text
<!-- Paste commands, exit codes, summaries, and evidence paths from plan P0. -->
```

### Tasks

- [ ] **P0.T1** Secret-safe baseline/checkpoint; write Baseline + Latest verified SHA.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T2** Create and commit `docs/release/FEATURE-FREEZE.md`.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T3** Implement fixed spec + discovery + manifest verification; exactly 44.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T4** Generate environment/binding contract without values.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T5** Generate complete CI command map.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T6** Fix all existing CI/typecheck/test hangs and failures; no skips.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T7** Record current migration head and deployment targets; no production changes.
      **Evidence:**
      **Deviation:**
- [ ] **P0.T8** Write and commit `docs/release/P0-baseline.md`.
      **Evidence:**
      **Deviation:**

### Exit gate

- [ ] Baseline SHA recorded; no secret/customer data committed — **Evidence:**
- [ ] Feature freeze committed — **Evidence:**
- [ ] Discovered registry exactly equals fixed 44-action spec — **Evidence:**
- [ ] Environment/binding contract generated safely — **Evidence:**
- [ ] All existing CI-equivalent commands terminate and pass — **Evidence:**
- [ ] Zero skips/quarantines added — **Evidence:**
- [ ] Migration/deployment inventory recorded — **Evidence:**
- [ ] P0 baseline report committed — **Evidence:**
- [ ] Zero open P0 defects — **Evidence:**

---

# PHASE 1 — Universal Contract Hardening for All 44 Actions

**Status:** ⬜ not started · **Window:** Day 1 afternoon–Day 2 morning · **Depends on:** P0
**Plan section:** §6 → PHASE 1
**Starting SHA:**
**Ending SHA:**

### Discovery output

```text
<!-- Paste manifest/idempotency/approval/receipt/renderer discovery evidence. -->
```

### Tasks

- [ ] **P1.T1** Implement guarded, idempotent Alpha/Bravo/Charlie certification seed.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T2** Implement parameterised 44-action contract runner and reports.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T3** Fix registry/schema/invalid-input/missing-entity/tenant-grounding failures.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T4** Enforce fixed approval floors and typed confirmation rules.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T5** Prove/fix sequential and concurrent idempotency for all mutations/effects.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T6** Make every terminal outcome produce truthful receipt/audit/provenance.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T7** Make prediction/simulation explicit and truthful for all 44.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T8** Frontend generated contract and renderer/state coverage 44/44.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T9** Fix remaining action-specific failures and record why they were unique.
      **Evidence:**
      **Deviation:**
- [ ] **P1.T10** Commit `docs/release/action-contract-results.md` and update ledger.
      **Evidence:**
      **Deviation:**

### Exit gate

- [ ] 44/44 action contract rows pass — **Evidence:**
- [ ] Cross-tenant tests pass — **Evidence:**
- [ ] Approval floors/typed confirmation pass — **Evidence:**
- [ ] Sequential/concurrent duplicates produce one effect — **Evidence:**
- [ ] Receipts/audit/provenance truthful — **Evidence:**
- [ ] Prediction/simulation truth explicit — **Evidence:**
- [ ] Frontend coverage 44/44; zero fallback in certified paths — **Evidence:**
- [ ] Zero open P0/P1 contract defects — **Evidence:**

---

# PHASE 2 — Chaos, Voice, Model, Integration, and Security Hardening

**Status:** ⬜ not started · **Window:** Day 2 · **Depends on:** P1
**Plan section:** §6 → PHASE 2
**Starting SHA:**
**Ending SHA:**

### Discovery output

```text
<!-- Paste provider/voice/queue/Sentry/security discovery evidence. -->
```

### Tasks

- [ ] **P2.T1** Implement deterministic guarded chaos runner.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T2** Prove approval/idempotency under before/during/after-effect failures.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T3** Prove queue/LangGraph/reconciliation/compensation durability.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T4** Certify actual GLM/Mistral/DeepSeek routing, deadlines, aborts, fallback, provenance, cost.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T5** Certify fast read-only cash-collections lane.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T6** Certify evidence corpus + Exa→Firecrawl verification/citations/watch hash.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T7** Certify all voice invariants and staging outbound guard.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T8** Certify RLS/RBAC/auth/webhooks/rate limits/secrets/PII.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T9** Correlated structured logs + sanitised Sentry event for each injected P0/P1 failure.
      **Evidence:**
      **Deviation:**
- [ ] **P2.T10** Commit `docs/release/chaos-results.md` and update ledgers.
      **Evidence:**
      **Deviation:**

### Exit gate

- [ ] Zero tenant leaks/approval bypasses/duplicate effects under fault — **Evidence:**
- [ ] Bounded retry, truthful DLQ/reconciliation — **Evidence:**
- [ ] Queue/LangGraph restart recovery passes — **Evidence:**
- [ ] LLM router + fast lane + evidence/web research pass — **Evidence:**
- [ ] All voice invariants pass — **Evidence:**
- [ ] Security/secret/PII tests pass — **Evidence:**
- [ ] Sentry/structured observability proven — **Evidence:**
- [ ] Zero open P0/P1 chaos/security defects — **Evidence:**

---

# PHASE 3 — Full-Stack Staging, Live-Binding Smoke, and 15-User Load

**Status:** ⬜ not started · **Window:** Day 3 · **Depends on:** P2
**Plan section:** §6 → PHASE 3
**Starting SHA:**
**Ending SHA:**

### Discovery output

```text
<!-- Paste staging identity, service SHA, migration, health, integration evidence. -->
```

### Tasks

- [ ] **P3.T1** Prove staging identity and no-egress/allowlist guards.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T2** Back up staging; apply and verify pending migrations.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T3** Deploy one RC SHA to frontend/API/worker/orchestrator; Sentry release same SHA.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T4** Seed and verify Alpha/Bravo/Charlie.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T5** Run 44-action staging API E2E matrix.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T6** Run configured allowlisted live-provider smokes; mark missing as BLOCKED-CONFIG.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T7** Run frontend/voice/approval/recovery/receipt certified journeys.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T8** Run 15-user 20-min and 25-user 10-min load scenarios.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T9** Meet all latency/error/queue/cost/load gates.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T10** Complete Sentry alert/trace drill per service.
      **Evidence:**
      **Deviation:**
- [ ] **P3.T11** Commit integration and load reports; update ledgers.
      **Evidence:**
      **Deviation:**

### Exit gate

- [ ] Staging/no-egress identity proven — **Evidence:**
- [ ] Backup + migrations verified — **Evidence:**
- [ ] All services use one SHA — **Evidence:**
- [ ] Three tenants verified — **Evidence:**
- [ ] 44/44 staging API E2E passes — **Evidence:**
- [ ] Configured live bindings certified; missing ones truthfully blocked — **Evidence:**
- [ ] Frontend/voice/approval/recovery/receipt journeys pass — **Evidence:**
- [ ] 15-user and 25-user load gates pass — **Evidence:**
- [ ] Sentry releases/alerts/traces proven — **Evidence:**
- [ ] Zero open P0/P1 staging/load defects — **Evidence:**

---

# PHASE 4 — Production Rehearsal, Final Certification, and Launch Freeze

**Status:** ⬜ not started · **Window:** Day 4 · **Depends on:** P3
**Plan section:** §6 → PHASE 4
**Starting SHA:**
**Ending SHA:**

### Tasks

- [ ] **P4.T1** Fresh worktree install/build/all CI proof.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T2** Backup restore rehearsal into separate DB; integrity/RLS/audit proof.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T3** Migration forward/rollback rehearsal.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T4** Implement release certifier with hard failure on skip/timeout/missing evidence/P0/P1/<9.5.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T5** Run full certification from clean worktree until green.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T6** Commit deployment, rollback, and incident runbooks.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T7** Commit evidence-backed production readiness report.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T8** Commit fixed paid-pilot offer/sales/onboarding pack.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T9** Commit safe demo/launch/video runbook.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T10** Commit certified RC and create local `jarvis-2026-08-10-rc1` tag; no production deploy.
      **Evidence:**
      **Deviation:**
- [ ] **P4.T11** Close state and set next phase to OWNER GO-LIVE APPROVAL.
      **Evidence:**
      **Deviation:**

### Exit gate

- [ ] Clean-checkout install/build/CI green — **Evidence:**
- [ ] Backup restore and integrity proof green — **Evidence:**
- [ ] Migration forward/rollback rehearsal green — **Evidence:**
- [ ] Release certifier exits 0; zero skips/timeouts — **Evidence:**
- [ ] 44/44 CORE-CERTIFIED; configured bindings LIVE-CERTIFIED — **Evidence:**
- [ ] Zero open P0/P1 defects — **Evidence:**
- [ ] 15/25-user + Sentry proof green — **Evidence:**
- [ ] Runbooks and readiness report committed — **Evidence:**
- [ ] Readiness score ≥ 9.5 — **Evidence:**
- [ ] Paid-pilot and demo/launch packs committed — **Evidence:**
- [ ] RC SHA/tag recorded — **Evidence:**
- [ ] Production not deployed — **Evidence:**

---

## 44-ACTION CERTIFICATION LEDGER

Update from generated reports only. `Core`, `Chaos`, `Staging`, and `UI/Receipt` require evidence paths.

| # | Action | Profile | Approval | Core | Chaos | Staging/live | UI/receipt | Final state |
|---:|---|---|---|---|---|---|---|---|
| 1 | `create_invoice` | `OPERATIONAL_CHANGE` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 2 | `send_payment_reminder` | `EXTERNAL_SIDE_EFFECT` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 3 | `record_payment` | `FINANCIAL_WRITE` | TYPED_REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 4 | `call_overdue_invoices` | `BATCH_EXTERNAL` | TYPED_REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 5 | `bulk_notify_existing_customers` | `BATCH_EXTERNAL` | TYPED_REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 6 | `clarification_request` | `META_NO_SIDE_EFFECT` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 7 | `generate_compliance_summary` | `INTERNAL_DRAFT` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 8 | `create_lead` | `INTERNAL_WRITE` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 9 | `update_lead_status` | `INTERNAL_WRITE` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 10 | `log_interaction` | `INTERNAL_WRITE` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 11 | `assign_lead_to_technician` | `OPERATIONAL_CHANGE` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 12 | `answer_customer_question` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 13 | `send_customer_message` | `EXTERNAL_SIDE_EFFECT` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 14 | `send_follow_up` | `EXTERNAL_SIDE_EFFECT` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 15 | `check_stock_level` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 16 | `flag_reorder_needed` | `INTERNAL_WRITE` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 17 | `log_stock_used_on_visit` | `OPERATIONAL_CHANGE` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 18 | `start_invoice_to_cash_workflow` | `DURABLE_WORKFLOW` | TYPED_REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 19 | `start_water_test_workflow` | `DURABLE_WORKFLOW` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 20 | `renew_maintenance_agreement` | `DURABLE_WORKFLOW` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 21 | `manual_step_suggestion` | `META_NO_SIDE_EFFECT` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 22 | `summarize_ad_performance` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 23 | `launch_ad_campaign` | `EXTERNAL_SPEND` | TYPED_REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 24 | `create_review_request` | `EXTERNAL_SIDE_EFFECT` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 25 | `get_business_overview` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 26 | `answer_business_question` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 27 | `send_proposal_to_recent_installs` | `BATCH_EXTERNAL` | TYPED_REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 28 | `request_proposal_signature` | `EXTERNAL_SIDE_EFFECT` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 29 | `start_installation_workflow` | `DURABLE_WORKFLOW` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 30 | `generate_quote` | `INTERNAL_DRAFT` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 31 | `size_equipment_for_household` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 32 | `send_proposal` | `EXTERNAL_SIDE_EFFECT` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 33 | `route_suggestion` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 34 | `assign_technician_to_visit` | `OPERATIONAL_CHANGE` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 35 | `check_technician_availability` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 36 | `reschedule_visit` | `OPERATIONAL_CHANGE` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 37 | `check_reminder_due` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 38 | `log_visit_report` | `INTERNAL_WRITE` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 39 | `flag_visit_issue` | `INTERNAL_WRITE` | POLICY | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 40 | `answer_water_question` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 41 | `schedule_water_test` | `OPERATIONAL_CHANGE` | REQUIRED | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 42 | `search_web` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 43 | `scan_competitors` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |
| 44 | `check_business_reviews` | `READ_ONLY` | NONE | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ UNCERTIFIED |

---

## INTEGRATION / ENVIRONMENT LEDGER

`Status` values: `unknown · configured-emulator · configured-live · live-certified · blocked-config · failed`.
Never paste values.

| System / binding | Requirement | Status | Certification phase | Evidence |
|---|---|---|---|---|
| Postgres / RLS / migrations | required | ⬜ unknown | P0/P3/P4 | |
| Redis memory + rate limiting | required | ⬜ unknown | P2/P3 | |
| Railway API service | required | ⬜ unknown | P3 | |
| Railway worker service | required | ⬜ unknown | P3 | |
| Railway orchestrator service | required | ⬜ unknown | P3 | |
| Frontend deployment | required | ⬜ unknown | P3 | |
| Sentry | required | ⬜ unknown | P2/P3 | |
| Supabase auth/RBAC | required | ⬜ unknown | P2/P3 | |
| Vapi | pilot if voice enabled | ⬜ unknown | P2/P3 | |
| OpenAI Realtime | pilot if voice enabled | ⬜ unknown | P2/P3 | |
| GLM provider family | current router | ⬜ unknown | P2 | |
| Mistral provider family | current router | ⬜ unknown | P2 | |
| DeepSeek provider family | current router | ⬜ unknown | P2 | |
| Exa | web research | ⬜ unknown | P2/P3 | |
| Firecrawl | web verification | ⬜ unknown | P2/P3 | |
| Embeddings provider | semantic evidence if enabled | ⬜ unknown | P0/P2 | |
| Zep | optional additive memory | ⬜ unknown | P0/P2 | |
| Communications/SMS | external actions | ⬜ unknown | P3 | |
| Resend/email | external actions | ⬜ unknown | P3 | |
| Vapi outbound calling | external actions | ⬜ unknown | P3 | |
| DocuSign/e-sign | external actions | ⬜ unknown | P3 | |
| QuickBooks/accounting | external actions | ⬜ unknown | P3 | |
| Stripe/payments | external actions | ⬜ unknown | P3 | |
| GoHighLevel/CRM | external actions | ⬜ unknown | P3 | |
| Meta Ads | marketing | ⬜ unknown | P3 | |
| Google Ads | marketing | ⬜ unknown | P3 | |
| OSRM/routing | route suggestion | ⬜ unknown | P3 | |
| Secrets provider | production boot | ⬜ unknown | P0/P2 | |

---

## RELEASE ARTIFACT LEDGER

| Artifact | Phase | Status | Evidence |
|---|---|---|---|
| `docs/release/FEATURE-FREEZE.md` | P0 | ⬜ | |
| `docs/release/generated/action-manifest.json` | P0 | ⬜ | |
| `docs/release/generated/action-manifest.md` | P0 | ⬜ | |
| `docs/release/generated/environment-contract.md` | P0 | ⬜ | |
| `docs/release/generated/ci-command-map.md` | P0 | ⬜ | |
| `docs/release/P0-baseline.md` | P0 | ⬜ | |
| `docs/release/action-contract-results.md` | P1 | ⬜ | |
| `docs/release/chaos-results.md` | P2 | ⬜ | |
| `docs/release/integration-readiness.md` | P3 | ⬜ | |
| `docs/release/load-test-results.md` | P3 | ⬜ | |
| `docs/release/deployment-runbook.md` | P4 | ⬜ | |
| `docs/release/rollback-runbook.md` | P4 | ⬜ | |
| `docs/release/incident-runbook.md` | P4 | ⬜ | |
| `docs/release/production-readiness-report.md` | P4 | ⬜ | |
| `docs/release/paid-pilot-offer.md` | P4 | ⬜ | |
| `docs/release/demo-and-launch-runbook.md` | P4 | ⬜ | |

---

## FINAL RELEASE GATES

- [ ] Fixed/discovered manifest 44/44.
- [ ] Every action CORE-CERTIFIED.
- [ ] Configured bindings LIVE-CERTIFIED; unavailable bindings BLOCKED-CONFIG truthfully.
- [ ] Zero tenant leakage.
- [ ] Zero approval bypass.
- [ ] Zero duplicate effects under sequential/concurrent replay and crash recovery.
- [ ] Read-only/meta actions create no consequential effect.
- [ ] Bounded retries; truthful DLQ/reconciliation/compensation.
- [ ] LLM router/fast lane/evidence/web research pass.
- [ ] Voice invariants pass.
- [ ] Auth/RBAC/RLS/webhook/rate-limit/secrets/PII pass.
- [ ] Frontend 44/44; zero fallback in certified paths.
- [ ] Receipts/audit/prediction/provenance truthful.
- [ ] Sentry/structured traces and alerts proven without PII.
- [ ] 44/44 staging E2E.
- [ ] 15-user and 25-user load gates.
- [ ] One SHA across staging services.
- [ ] Fresh-checkout install/build/CI.
- [ ] Backup restore proof.
- [ ] Migration forward/rollback proof.
- [ ] Zero skips, quarantines, hangs, P0, or P1 defects.
- [ ] Runbooks executable.
- [ ] Pilot/demo claims match evidence.
- [ ] Score ≥ 9.5.
- [ ] RC tag points to certified SHA.
- [ ] Production deployment remains owner-approved separate step.

---

## OWNER-ONLY ACTIONS

These are not executor blockers until their phase requires them:

| Action | Needed by | Status | Notes |
|---|---|---|---|
| Provide/verify allowlisted staging email/phone | P3 | ⬜ | Never paste values into state |
| Confirm staging provider accounts are not production | P3 | ⬜ | Evidence can be redacted screenshot/path |
| Confirm Sentry alert destination | P3 | ⬜ | No personal secret values |
| Review paid-pilot terms and usage allowance | P4 | ⬜ | Defaults fixed in plan |
| Review final readiness report and RC tag | Monday | ⬜ | Required before go-live `/goal` |
| Explicitly authorise production deployment | Monday | ⬜ | Separate instruction only |

---

## SESSION LOG

<!-- Append one entry per phase/session, newest first:
YYYY-MM-DD HH:MM · model · phase · starting SHA → ending SHA · tasks completed · test summary ·
action count certified · defects opened/closed · score · next phase · blockers -->

- **2026-08-06 · ARCHITECTURE SESSION (GPT-5.6 Thinking; no code modified)** · Created the four-day
  production hardening plan and state. Fixed scope: all 44 actions, one generated spec/manifest, one
  universal contract runner, chaos/security/voice/model/evidence hardening, full-stack staging, 15-user
  plus 25-user load, clean release certification, backup/rollback, launch and paid-pilot packs. **Next:**
  P0. **Blockers:** none known until fresh repository audit.

---

## DEVIATION INDEX

<!-- Format: P<n>.T<m> · plan expected · repository reality · smallest preserving change · evidence -->

*(none yet)*

---

## MANUAL PRODUCTION GO-LIVE RECORD

Fill only after P4 is complete and the owner gives the separate go-live instruction.

| Field | Value |
|---|---|
| Owner approval timestamp | |
| Certified RC tag / SHA | |
| Production backup id | |
| Migration from → to | |
| Frontend deployment id | |
| API deployment id | |
| Worker deployment id | |
| Orchestrator deployment id | |
| Sentry release | |
| Smoke-test result | |
| Rollback required? | |
| Final launch status | |

---

*End of state file. Execute only the phase named in `## NEXT EXACT PHASE`.*
