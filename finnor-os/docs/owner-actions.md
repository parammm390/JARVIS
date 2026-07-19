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
