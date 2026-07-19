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

**Vapi voice — correction to this section (2026-07-19): a number already exists, more is working than this section previously said**

Checked directly against production this session, not assumed: `VAPI_PHONE_NUMBER_ID` is
already set to a real value (`2512a4df-6eae-49c0-8964-2e76b398d27e`, from earlier work,
2026-07-12) and `testVapiConnection()` returns `{configured: true, healthy: true}` — a
live, working self-test against the real Vapi API, not just an env var being present.
Two things ARE still real gaps, though:
1. `tenant_phone_numbers.phone_number` (the human-readable dialable number itself) is
   still the literal placeholder string — only `vapi_phone_number_id` is real. This
   matters for INBOUND call routing (`resolveTenantFromCall`), which may depend on the
   real number text, not just the Vapi id — untested whether inbound calls actually
   resolve correctly right now.
2. **`COMMUNICATIONS_BINDING` is not set, so outbound confirmation calls still go through
   the emulator today** — this was a deliberate choice this session, not an oversight:
   flipping it makes `send_confirmation_call` place REAL phone calls to REAL customers
   the moment a gated action is approved. That's a real-world action affecting real
   people, and I won't flip it without you explicitly saying so, even though the
   credentials already work.

**What I need from you:** just a yes/no, not a signup — do you want real outbound
confirmation calls turned on now (`COMMUNICATIONS_BINDING=vapi`)? If yes, tell me the
actual dialable phone number that Vapi ID belongs to (dashboard.vapi.ai → Phone Numbers)
so I can also fix the `tenant_phone_numbers` row, not just flip the binding. If you'd
rather buy a fresh number instead of using whatever this one currently is, that's the
original ask below — either way, tell me before any real call goes out.

Original ask, if you want a *different*/fresh number instead of using the existing one:
1. dashboard.vapi.ai → Phone Numbers → Buy a number (or "Get free number" if Vapi is
   currently offering one via its own Twilio-backed pool — pricing shown before you
   confirm). Real, recurring cost, roughly a few dollars a month — **I will not purchase
   this without you telling me to.**
2. Tell me the number (and its Vapi phone-number-id, shown right after purchase) and I'll
   update `tenant_phone_numbers`/`VAPI_PHONE_NUMBER_ID` and redeploy.
