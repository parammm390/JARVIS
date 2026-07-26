# A7 live-claim re-probe — 2026-07-26

This replaces neither historical evidence nor the certification document. It records
what was actually re-probed this cycle, and marks anything outside the available
non-destructive probes as unverified rather than carrying an old “confirmed live”
label forward.

| Historical claim | Re-probe | Result |
|---|---|---|
| Production worker is running | `railway status --json` | Reconfirmed: `finnor-worker` latest deployment `542ade84-9866-4a7d-b0b3-48e0993f4ef6`, instance `RUNNING`. |
| Production web is deployable/ready | `vercel ls --yes` | Reconfirmed: current production deployment listed `Ready`; this is deployment availability only, not an authenticated application-flow proof. |
| Daily scorecard and injection journal are real, tenant-scoped mechanisms | A7 focused integration suite | Reconfirmed locally against Postgres: 7/7, including scorecard upsert, RLS isolation, authenticated route, SLO payload, calendar outcome visibility. |
| Approval-expiry recovery is a real executable drill | `DATABASE_URL=postgres://finnor:finnor@localhost:5432/finnor npx tsx scripts/inject-failure.ts approval_expiry_pileup` | Reconfirmed locally: 3/3 deliberately overdue approvals escalated and a durable `failure_injections` row recorded `outcome: pass`. This was local only; no production action is claimed. |
| Historical production/staging data-plane claims in `jarvis-95-certification.md` | No new authorized tenant JWT or privileged production DB probe was used in A7 | **Unverified this cycle.** They remain dated historical evidence, not current-live claims. |

The command outputs are recorded in the A7 session log. No secret values, customer
records, production writes, or disruptive provider/worker drills were used.
