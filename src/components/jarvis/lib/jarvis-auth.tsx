"use client"

// Phase 1.3/1.4: real Supabase session state for the JARVIS frontend. Logged-out
// visitors keep seeing the labeled sample-data view (unchanged from before); a real
// session unlocks live data by having api.ts forward its access token to the proxy,
// which forwards it to the finnor-os backend's own requireContext/RBAC — no new
// authorization logic lives here or in the proxy, only session plumbing.

import { createContext, useContext, useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabaseBrowser } from "@/lib/jarvis/supabase-browser"

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
  signOut: () => Promise<void>
}
const JarvisAuthContext = createContext<JarvisAuthState>({ session: null, loading: true, signOut: async () => {} })

export function JarvisAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

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

  async function signOut(): Promise<void> {
    await supabaseBrowser.auth.signOut()
  }

  return <JarvisAuthContext.Provider value={{ session, loading, signOut }}>{children}</JarvisAuthContext.Provider>
}

export function useJarvisAuth(): JarvisAuthState {
  return useContext(JarvisAuthContext)
}
