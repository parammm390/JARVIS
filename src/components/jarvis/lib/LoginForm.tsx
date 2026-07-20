"use client"

// Phase 1.3: real Supabase email+password sign-in. Session storage/refresh is fully
// library-managed (supabaseBrowser client, persistSession+autoRefreshToken) — this
// component only calls signInWithPassword and reacts to the result.

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Lock } from "lucide-react"
import { supabaseBrowser } from "@/lib/jarvis/supabase-browser"
import "../jarvis-theme.css"

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    router.push("/jarvis")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#04070f] px-4 text-[color:var(--j-text)]">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--j-border)] bg-slate-950 p-6">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-black">
          <Lock className="h-4 w-4 text-[color:var(--j-cyan)]" /> Sign in to JARVIS
        </div>
        <p className="mb-5 text-[12px] text-[color:var(--j-text-dim)]">Real account, real data. The public page stays readable without signing in.</p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="jarvis-login-email" className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-faint)]">
              Email
            </label>
            <input
              id="jarvis-login-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-xl border border-white/12 bg-slate-900 px-3 text-[13px] text-white focus:border-[color:var(--j-border-hot)] focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="jarvis-login-password" className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-faint)]">
              Password
            </label>
            <input
              id="jarvis-login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-xl border border-white/12 bg-slate-900 px-3 text-[13px] text-white focus:border-[color:var(--j-border-hot)] focus:outline-none"
              placeholder="••••••••"
            />
          </div>
          {error && <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="h-10 w-full rounded-xl bg-teal-300 text-[12px] font-black text-slate-950 transition hover:bg-teal-200 disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <Link href="/jarvis" className="mt-4 block text-center text-[11px] text-[color:var(--j-text-faint)] hover:text-white">
          Back to JARVIS
        </Link>
      </div>
    </div>
  )
}
