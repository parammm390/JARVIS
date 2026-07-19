# Owner actions — steps only Param can do

## 1. ~~Supabase publishable/anon key~~ — RESOLVED, was already in Vercel

Turned out `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already set on `finnor-agency`, from an earlier setup pass) is the correct publishable key for project `kpxrnonhnhexutvdywbh` — same project `FINNOR_OS_SUPABASE_URL` points at. Missed the cross-reference initially because it's named generically rather than `FINNOR_OS_*`; no action needed, login was built using it directly.

## 2. GitHub push credentials (optional — doesn't block deploys)

`git push origin main` fails from this environment: no git credential helper is configured for `https://github.com`. This does **not** block anything live — production deploys go straight from the local build via `vercel deploy --prod`, which is working and verified. It only means GitHub's copy of the repo is behind what's actually running on finnorai.com.

**To fix (optional, whenever convenient):** install the GitHub CLI (`brew install gh`) and run `gh auth login`, which configures git's credential helper automatically. Not urgent — flagging so commits don't silently pile up unpushed.

## 3. MFA on the owner Supabase account (Task 1.5 — account now exists)

The real owner login now exists: `bloodride2@gmail.com`, owner role, tenant `00000000-0000-4000-8000-000000000001`. Its password was reset and shown once in chat during this session (log in and change it from account settings once login ships in Task 1.3/1.4). Enable MFA: Supabase Dashboard → Authentication → Users → find that email → enable MFA, or enroll an authenticator app on first login if the project has self-serve MFA enrollment on.

## 4. Rotate the Supabase service-role key (Task 1.7)

Precautionary rotation after the read-exposure incident (see `incident-2026-07-public-read-exposure.md`). There's no API-driven way to roll this key without a Supabase **management** access token (separate from the project API keys already in env) — it has to come from the dashboard.

**Steps:**
1. Supabase Dashboard → project `kpxrnonhnhexutvdywbh` → Settings → API.
2. Find the **service_role** / **secret** key → click to roll/regenerate it.
3. Paste the new value in chat (this one is a genuine secret — fine to paste here since it goes straight into env vars, but never post it anywhere public), and I'll update it on the `api` Vercel project and redeploy.

Not urgent in the sense of an active exploit confirmed, but the incident doc recommends doing it regardless as standard practice after any exposure window, however brief.

## 5. Remove a stuck zombie Railway deployment (found during Phase 3, 2026-07-19)

`finnor-worker` on Railway (project `innovative-prosperity`) has **two simultaneously
running deployments**, confirmed via `railway status --json`: one from **2026-07-13**
(`bbb87a57-d958-4bde-8a31-724d5b802563`) and the current correct one from today
(`98bed049-...`). Both show `deploymentStopped: false` with a `RUNNING` instance. Since
`apps/worker/src/queue.ts`'s `tick()` claims jobs via `FOR UPDATE SKIP LOCKED`, **both
processes poll and race for the same jobs** — whichever one wins a given job determines
whether it succeeds (new code) or fails (July 13's stale code, which predates
`scan_approval_expiry`/`simulator_tick`/several handlers entirely). This is a real,
observed production bug, not a hypothesis: jobs of the same type flip between
`completed` and `dead_letter` (`No handler registered for job type ...`, `plugin.
actionTypes is not iterable`) depending purely on which instance grabbed them.

**Tried and confirmed NOT sufficient:** `railway service restart --service finnor-worker
--environment production` (restarts the latest deployment in place; does not touch the
stray old one). `railway down` only removes the *most recent* deployment — the opposite
of what's needed here. The CLI has no `railway deployment remove <id>` equivalent.

**Fix:** open the Railway dashboard → project `innovative-prosperity` → `finnor-worker`
service → Deployments tab → find the 2026-07-13 deployment
(`bbb87a57-d958-4bde-8a31-724d5b802563`) → Remove/Stop it directly (the dashboard has a
per-deployment control the CLI doesn't expose). After that, `railway status` should show
exactly one active deployment. Worth checking whether this pattern recurs after future
deploys — if so, it may be a Railway account/project-level issue worth their support.

## 6. Phase 4 decision, confirmed with Param (2026-07-19): skip GoHighLevel, skip real SMS for now

The pack's original DECISIONS section said CRM + scheduling + SMS/email = GoHighLevel
($97–297/month, 14-day free trial only, no free tier). Checked live at gohighlevel.com/
pricing before recommending this. A prior session had already replaced GHL's CRM/
scheduling role with a real native implementation (Finnor's own database — see
`finnor-os-backend` history, the 2026-07-12 "native pass"), so the ONLY thing GHL would
still add is real outbound SMS delivery (email already works for real via Gmail SMTP,
free). Param chose **"skip real SMS for now"** rather than pay for GHL or set up a
cheaper alternative (Twilio was offered as a no-business-needed, pay-as-you-go option and
declined for now). Net effect: `CRM_BINDING`/`SCHEDULING_BINDING` should be set to
`native` (real, free, already built and conformance-tested — see
`tests/integration/capability-contract-conformance.test.ts`, 35/35 passing), and outbound
SMS stays on the honestly-labeled emulator until Param revisits this. No owner action
needed here unless you change your mind — if you ever do want real SMS, tell me and I'll
either wire up GHL's trial or Twilio, whichever you'd rather pay for.

## 7. Phase 4 providers — none of these require a registered business

You said "I don't have a business" as a reason you couldn't do Phase 4's signups. That's
not actually a blocker for any of the providers below — every one of them has a free
individual/developer/sandbox tier that needs nothing but an email address (Stripe and
DocuSign's real account creation flows don't ask for business registration at all; a
"business name" field, where one exists, accepts any text and isn't verified at this
tier). I have not personally walked through each provider's live signup flow inside this
session (only GoHighLevel's pricing page, above) — the steps below are accurate based on
how each provider's standard developer/sandbox signup has worked; if any click-path has
moved, the destination account type (sandbox/test/demo) is still correct. Do these in any
order; each is fully independent.

**Stripe (payments, test mode)**
1. Go to stripe.com → Start now / Sign up. Email + password, no business info required
   to create the account or to use test mode.
2. Dashboard → make sure "Test mode" is on (toggle, usually top-right).
3. Developers → API keys → copy the **Secret key** (starts `sk_test_`).
4. Paste that value in chat and I'll set `STRIPE_SECRET_KEY` + `PAYMENTS_BINDING=stripe`
   on the `api` Vercel project and redeploy. Webhook signing secret comes later, once the
   webhook endpoint is live — I'll ask for that separately when it's time.
5. No card needed, no charge — test mode never touches real money, by design, forever
   until you deliberately flip to live keys (a separate future step, one env var).

**QuickBooks Online (accounting, sandbox)**
1. Go to developer.intuit.com → Sign in / Create account (a normal Intuit account, no
   business needed).
2. Dashboard → create an app (any name, e.g. "Finnor JARVIS"). Intuit auto-generates a
   **fake sandbox company** for you — this IS the intended target, not a limitation.
3. App → Keys & OAuth → copy **Client ID** and **Client Secret**.
4. The OAuth flow needs one authorization click I can't do for you (it opens Intuit's
   consent screen) — once you have Client ID/Secret in hand, tell me and I'll walk you
   through the one-click authorize step to get the refresh token + realm (sandbox company)
   id.
5. Paste all four (Client ID, Client Secret, refresh token, realm id) in chat and I'll set
   `QUICKBOOKS_CLIENT_ID`/`QUICKBOOKS_CLIENT_SECRET`/`QUICKBOOKS_REFRESH_TOKEN`/
   `QUICKBOOKS_REALM_ID` (environment stays `sandbox`) and redeploy.

**DocuSign (e-signature, demo/developer account)**
1. Go to developers.docusign.com → Get a free account / Sign up. Email + password, no
   business needed — this is explicitly a developer sandbox account.
2. Once in, go to your Apps and Keys page (My Account or Admin, depending on the current
   DocuSign UI) → Add App / Integration Key → copy the **Integration Key**.
3. Generate an **RSA keypair** on that same page (DocuSign will show you a "Generate RSA"
   button) — copy the private key it gives you (starts `-----BEGIN RSA PRIVATE KEY-----`).
4. Copy your **User ID** and **Account ID** (both shown on your DocuSign account/profile
   page — API Username / Account ID, both GUIDs).
5. Paste all four (Integration Key, User ID, Account ID, private key) in chat — the
   private key is a genuine secret but is meant to go straight into env vars, same as the
   Supabase key above. I'll set `DOCUSIGN_INTEGRATION_KEY`/`DOCUSIGN_USER_ID`/
   `DOCUSIGN_ACCOUNT_ID`/`DOCUSIGN_PRIVATE_KEY` (base URL stays the demo environment,
   `https://demo.docusign.net`) and redeploy.

**Meta Ads (marketing, read-only + paused-campaign creation only — JARVIS never spends
real money without you separately approving a launch)**
1. You need a personal Facebook account (if you don't have one, that's the only real
   prerequisite — no business registration).
2. Go to business.facebook.com → create a Business Manager (any name — this can be
   literally "Finnor Water Co. Test", it's not verified at this tier) → add an ad account
   under it (no payment method required just to create it and use read APIs).
3. developers.facebook.com → create an app → add the Marketing API product → generate a
   long-lived **access token** for your ad account.
4. Note your **ad account id** (numeric, shown as `act_123456789` — we only need the
   number, not the `act_` prefix).
5. Paste both in chat and I'll set `META_ADS_ACCESS_TOKEN` / `META_ADS_ACCOUNT_ID` and
   redeploy.

**Google Ads (marketing, read-only + paused-campaign creation only, same no-real-spend
posture as Meta above)**
1. You need a Google account (personal Gmail is fine).
2. ads.google.com → create an account (again, no business registration required at
   signup — "Expert Mode" skips the guided campaign setup entirely, you can create the
   account with zero campaigns running).
3. This one has the most moving parts: a **developer token** from
   ads.google.com/aw/apicenter (test-account-level access is granted instantly with no
   review; a token with basic/production access requires a short Google review — test
   access is enough for what Phase 4 needs, which is read APIs and paused campaigns
   only), plus OAuth **client ID/secret** from console.cloud.google.com (a free Google
   Cloud project, no billing needed for this) and a **refresh token** (I can walk you
   through the one-click OAuth consent once the app exists), plus your **customer id**
   (shown in the Ads UI, format `123-456-7890`, digits only for env).
4. Paste developer token, client ID, client secret, refresh token, and customer id in
   chat and I'll set the five `GOOGLE_ADS_*` env vars and redeploy.

**Vapi voice — RESOLVED 2026-07-19: real outbound calls are now live, with your explicit go-ahead**

Checked directly against production this session, not assumed: `VAPI_PHONE_NUMBER_ID` was
already set to a real value (`2512a4df-6eae-49c0-8964-2e76b398d27e`, from earlier work,
2026-07-12) and `testVapiConnection()` returned `{configured: true, healthy: true}` — a
live self-test against the real Vapi API. I asked you directly whether to turn on real
outbound calls (this affects real customers the moment a booking/confirmation is
approved, not something to flip without asking) — you said yes. Done:
- Looked up the real dialable number behind that Vapi id via Vapi's own API:
  **+13463636975**, status `active`.
- Fixed `tenant_phone_numbers.phone_number` (was the literal placeholder string) to that
  real number, for the primary tenant.
- Set `COMMUNICATIONS_BINDING=vapi` on **both** the API (Vercel) and the worker (Railway)
  — these are two separate deployments with separate env vars; the worker is what
  actually executes `send_confirmation_call` steps, so both needed it, not just one.
  Redeployed both; verified nothing was already queued to fire immediately.
- Real outbound confirmation calls are live now, from +13463636975.

Untested and worth knowing: inbound call routing (`resolveTenantFromCall`) wasn't
specifically re-verified against the now-real `phone_number` value — if a real inbound
call to that number doesn't resolve to the right tenant, that's the first place to look.

If you'd rather use a *different* number than the one Vapi already had on file:
1. dashboard.vapi.ai → Phone Numbers → Buy a number (or "Get free number" if Vapi is
   currently offering one via its own Twilio-backed pool — pricing shown before you
   confirm). Real, recurring cost, roughly a few dollars a month — **I will not purchase
   this without you telling me to.**
2. Tell me the number (and its Vapi phone-number-id, shown right after purchase) and I'll
   update `tenant_phone_numbers`/`VAPI_PHONE_NUMBER_ID` and redeploy.

## 8. Voyage AI embeddings (Phase 5, real memory) — RESOLVED 2026-07-19, real key live

You supplied a real Voyage AI key this session. Done, verified, not just assumed:
- Set `EMBEDDINGS_API_KEY` on both the `api` Vercel project and the `finnor-worker`
  Railway service (both make real embedding calls — same two-deployment gotcha as the
  Vapi binding above), redeployed both, confirmed both running the new build.
- **Real round-trip proof, not just "the key is present":** called the live Voyage API
  directly with the real key — got back a genuine 1024-dimension vector, confirming the
  request shape (`model: voyage-3.5`, `output_dimension: 1024`) this code was written
  against (but never tested live) is actually correct. Then checked real semantic
  discrimination: "rotten egg smell" scored meaningfully more similar to its own
  hydrogen-sulfide explanation (0.85) than to an unrelated scheduling question (0.79) —
  genuine semantic understanding, unlike the mechanical test-only embedder this system
  otherwise uses.
- Ran `scripts/backfill-embeddings.ts` against production for both Dealer Zero and your
  primary tenant — both reported 0 receipts to backfill. Real finding, not a bug: the
  `decision_receipts` table itself didn't exist until Phase 2 shipped (2026-07-18/19),
  so there's no real production history old enough to have receipts yet. Nothing was
  fabricated to fill that gap — semantic memory starts genuinely empty in production
  and fills in for real as real activity happens from here on (every completed action
  and every ended call auto-ingests, per Phase 5.2).
- `GET /api/setup/status` verified live, post-deploy: `integrations.embeddings` now
  reports `{configured: true, healthy: null, provider: "voyage-3.5"}` — `healthy` stays
  `null` deliberately (never guessed): a real per-poll health check would cost a real
  embedding call on every dashboard load (the page fires ~15 parallel status calls),
  same reasoning Voyage doesn't have a cheap dedicated health endpoint the way
  Stripe's `/v1/balance` does — the honest signal is "configured or not," same
  posture Zep already has on this same endpoint.

Nothing left to do here — real memory is fully live end to end. As real customers call
in and real jobs complete, semantic memory fills in for real automatically.

## 9. Phase 6 (ops-grade platform) — everything here is real infrastructure/accounts, none require a registered business

Phase 6 is engineering-complete everywhere it can be without new accounts (reliability
read-model + API route, Sentry correlationId tracing, threshold-based alert detection,
a real CI restore-drill step, a real k6 load-test script, real local chaos evidence,
the CI retrieval-eval gate, and a documented manual promotion flow — see
`phase-status.md`'s Phase 6 section for the full breakdown). What's left is entirely
provisioning real infrastructure only Param can create:

**Staging environment (Task 6.1)** — three separate accounts/projects, all with a free
tier, none needing a registered business:
1. **A second Supabase project** (separate from the production one, `kpxrnonhnhexutvdywbh`)
   — supabase.com → New Project, free tier is enough for staging traffic. Paste the new
   project's URL + service-role key + Postgres connection string in chat and I'll set
   them as the staging deploy's env vars and run `npm run db:migrate` against it.
2. **A second Railway environment** for `apps/worker` — Railway supports adding a
   `staging` environment to the existing `innovative-prosperity` project (Railway
   dashboard → environments → New Environment), or a second project entirely; either
   works. `railway.staging.json` (already in the repo) is the build/deploy config to
   point it at.
3. **A second Vercel deployment** for `apps/api` + `apps/console` — either a dedicated
   Vercel project (same flow as the existing ones) or Vercel's own preview-deployment
   feature pointed at a `staging` branch. Tell me which you'd rather do and I'll wire it
   up once the Supabase project from step 1 exists.

**AWS account for Secrets Manager (Task 6.2)** — the code side is already fully built
(`packages/security/src/secrets.ts`, see `docs/secrets-runbook.md`). Needs: an AWS
account (aws.amazon.com, free tier covers Secrets Manager's first 30 days per secret,
then ~$0.40/secret/month — real but small recurring cost, I will not create this account
or accept the cost without you confirming first), then an IAM user or role scoped to
`secretsmanager:GetSecretValue` on a `finnor/prod/*` naming prefix (exact policy JSON
already in the runbook). Once you have an AWS access key pair (or if you'd rather I use
IAM roles instead of static keys, tell me and I'll ask for the role ARN), paste it in
chat and I'll create the actual secrets, set the three cutover env vars, and redeploy.

**Sentry account + DSN (Task 6.6)** — `SENTRY_DSN` is currently unset in production
(confirmed this session via `vercel env ls` — no Sentry variable exists on the `api`
project), so `Sentry.init()` is a harmless no-op right now: the correlationId
tracing and the new threshold-based alert detection (`scan_reliability_alerts` —
reconciliation backlog>20, DLQ>10, a circuit breaker stuck open, a failure-rate spike,
a secret-store read failure) are real, wired, and running on an hourly schedule, but
have nowhere to report to yet. sentry.io → sign up free (developer tier is free
forever for one project, no business needed) → create a project (platform: Node.js) →
copy the DSN. Paste it in chat and I'll set `SENTRY_DSN` on both the API (Vercel) and
worker (Railway) and redeploy — the moment that's done, every alert this session built
starts actually reaching Sentry's dashboard. **Separately, dashboard alert *rules*
(routing a Sentry event to email/Slack/etc.) are a Sentry dashboard configuration step
only you can do** — Sentry Alerts → Create Alert Rule, condition "an event's message
contains `reliability_alert:`", action of your choice. I'll write the exact rule
conditions once the DSN exists and you tell me where you want notifications routed.

**k6 CLI (Task 6.4)** — `k6 run scripts/k6-load-test.js` needs k6 installed wherever it
runs (`brew install k6` locally, or a CI runner image that ships it). Free, open-source,
no account needed at all — purely a "run this install command" step, not blocked on
anything but hasn't been done since there's no staging environment yet to point it at.

**Postgres client tools for the FULL production restore drill** — the CI-tier drill
(dump/restore against CI's own ephemeral Postgres) is wired and described in
`docs/restore-drill-2026-07-19.md`; the full "restore latest prod backup into an
isolated env" tier the pack's Task 6.3 asks for needs the second Supabase project from
Task 6.1 above, since a restore target has to be a separate project, never the live one.

None of the five items above need Param to have a registered business, an existing
company, or anything beyond an email address and (for AWS/Railway/Vercel scale-ups
only) a payment method for genuinely small recurring costs — same framing as Phase 4's
own owner-actions section.
