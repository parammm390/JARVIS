# Owner actions — steps only Param can do

## 1. Supabase publishable/anon key (unblocks Task 1.3 — real login)

The JARVIS login page needs a browser-safe Supabase key for project `kpxrnonhnhexutvdywbh` (the same project the finnor-os backend already uses for identity). The key already in env (`FINNOR_OS_SUPABASE_KEY`) was checked and is the **secret** key (`sb_secret_...`) — this must never be shipped to a browser, so it wasn't used, and login can't be built without the real public one.

**Steps (2 minutes):**
1. Go to https://supabase.com/dashboard and open the project `kpxrnonhnhexutvdywbh`.
2. Settings → API.
3. Copy the key labeled **"Publishable key"** (or **"anon public"** on older projects — same thing, different Supabase UI versions call it different names).
4. Paste that value in chat, or set it yourself as a Vercel env var named `NEXT_PUBLIC_FINNOR_OS_SUPABASE_ANON_KEY` on the `finnor-agency` project.

This key is *meant* to be public (it's what ships in every Supabase app's JS bundle) — safe to paste in chat, unlike the secret key.

## 2. GitHub push credentials (optional — doesn't block deploys)

`git push origin main` fails from this environment: no git credential helper is configured for `https://github.com`. This does **not** block anything live — production deploys go straight from the local build via `vercel deploy --prod`, which is working and verified. It only means GitHub's copy of the repo is behind what's actually running on finnorai.com.

**To fix (optional, whenever convenient):** install the GitHub CLI (`brew install gh`) and run `gh auth login`, which configures git's credential helper automatically. Not urgent — flagging so commits don't silently pile up unpushed.

## 3. MFA on the owner Supabase account (Task 1.5, not yet reached)

Once the real owner login is created, enable multi-factor authentication on that account: Supabase Dashboard → Authentication → Users → (the owner row) → enable MFA, or have Param enroll an authenticator app on first login if the project has MFA enrollment enabled for users. Will fill in the exact click-path once Task 1.5 creates the account.
