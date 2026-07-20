"use client"

// Phase 1.3/1.4: real Supabase session state for the JARVIS frontend. Logged-out
// visitors keep seeing the labeled sample-data view (unchanged from before); a real
// session unlocks live data by having api.ts forward its access token to the proxy,
// which forwards it to the finnor-os backend's own requireContext/RBAC — no new
// authorization logic lives here or in the proxy, only session plumbing.

import { createContext, useContext, useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabaseBrowser } from "@/lib/jarvis/supabase-browser"
import { jarvisGet } from "./api"

// Phase 7 (§7.4, role-aware views): the backend already resolves a real role per
// signed-in user (owner/dispatcher/technician) via requireContext, and enforces it
// server-side on every RBAC-gated route regardless of what the frontend shows or
// hides. GET /api/me exposes that SAME role to the browser purely as defense-in-
// depth — hiding owner-only surfaces (DLQ, run controls) for a dispatcher is a
// courtesy, not a security boundary; the server 403s either way.
export type JarvisRole = "owner" | "dispatcher" | "technician"

// Mirrors the old getJarvisKey() shape: a synchronous getter usable outside React
// (api.ts isn't a component) that always reflects the latest session from the one
// Supabase client instance's in-memory state.
let currentSession: Session | null = null
export function getCurrentAccessToken(): string | null {
  return currentSession?.access_token ?? null
}
export function hasActiveSession(): boolean {
  return currentSession !== null
}

interface JarvisAuthState {
  session: Session | null
  loading: boolean
  role: JarvisRole | null
  signOut: () => Promise<void>
}
const JarvisAuthContext = createContext<JarvisAuthState>({ session: null, loading: true, role: null, signOut: async () => {} })

export function JarvisAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<JarvisRole | null>(null)

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => {
      currentSession = data.session
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, next) => {
      currentSession = next
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setRole(null)
      return
    }
    let cancelled = false
    jarvisGet<{ role: JarvisRole }>("me")
      .then((r) => {
        if (!cancelled) setRole(r.role)
      })
      .catch(() => {
        if (!cancelled) setRole(null)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function signOut(): Promise<void> {
    await supabaseBrowser.auth.signOut()
  }

  return <JarvisAuthContext.Provider value={{ session, loading, role, signOut }}>{children}</JarvisAuthContext.Provider>
}

export function useJarvisAuth(): JarvisAuthState {
  return useContext(JarvisAuthContext)
}
