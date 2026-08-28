"use client"

// Browser-side Supabase client for real JARVIS login (Phase 1.3). Uses the
// publishable/anon key — safe to ship to the browser, unlike the secret key
// proxy-auth.ts uses server-side for the shared service account. Session storage
// and token refresh are entirely library-managed (localStorage + a background
// refresh timer) — no hand-rolled token handling here or anywhere downstream.
import type { SupabaseClient } from "@supabase/supabase-js"

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()
/** Playwright's deterministic auth fixtures intercept the Supabase REST calls.
 * Keep the real preview fail-closed when credentials are absent, but give that
 * explicitly labelled test harness a valid client shape to exercise the same
 * browser auth/session lifecycle. The loopback port is deliberately unroutable
 * outside an intercepted test request and is never used in a production build. */
export const isSupabaseTestMode = process.env.NEXT_PUBLIC_JARVIS_TEST_MODE === "1"
// HTTPS keeps the placeholder inside the app's normal connect-src policy. The
// deterministic browser specs intercept `/auth/v1/**` before it can leave the
// page; an un-intercepted local login fails closed without ever resembling a
// production Supabase endpoint.
const clientUrl = url || (isSupabaseTestMode ? "https://jarvis-playwright.invalid" : "")
const clientAnonKey = anonKey || (isSupabaseTestMode ? "jarvis-playwright-fixture" : "")

/** Public preview remains usable when an environment has deliberately omitted
 * auth configuration (for example a static/local shell). Login still fails
 * closed through getSupabaseBrowser(), but the signed-out product surface must
 * not turn a missing optional dependency into an auth-error blank screen. */
export const isSupabaseConfigured = Boolean(url && anonKey)

let clientPromise: Promise<SupabaseClient> | null = null

/**
 * The real browser client is shared exactly as before, but the SDK is only
 * fetched when authentication is actually needed (session restoration or a
 * login/reset action). Public JARVIS preview therefore does not pay its cost
 * before rendering the non-authenticated Thread.
 */
export function getSupabaseBrowser(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(clientUrl, clientAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    )
  }
  return clientPromise
}
