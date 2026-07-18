"use client"

// Single fetch surface for every JARVIS panel. Both reads and writes go through the
// same-origin /api/jarvis/* proxy and forward the caller's real Supabase session
// token — the finnor-os backend's own requireContext/RBAC decides what a signed-in
// user can see and do. Logged-out visitors still get the 3 public-aggregate paths
// (stats, setup/status, integrations/status); everything else 401s and the panels
// already degrade gracefully to their sample-data view.

import { getCurrentAccessToken } from "./jarvis-auth"

export class JarvisApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Request telemetry — every REAL fetch this page makes is published here, so the
// SystemConsole can stream genuine backend traffic (method, status, measured ms).
// ---------------------------------------------------------------------------
export interface JarvisRequestLog {
  method: "GET" | "POST"
  path: string
  status: number
  ms: number
  at: number
}
const requestListeners = new Set<(r: JarvisRequestLog) => void>()
export function onJarvisRequest(cb: (r: JarvisRequestLog) => void): () => void {
  requestListeners.add(cb)
  return () => requestListeners.delete(cb)
}
function publish(r: JarvisRequestLog): void {
  requestListeners.forEach((cb) => cb(r))
}

function authHeaders(): Record<string, string> | undefined {
  const token = getCurrentAccessToken()
  return token ? { authorization: `Bearer ${token}` } : undefined
}

export async function jarvisGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : ""
  const started = performance.now()
  let status = 0
  try {
    const res = await fetch(`/api/jarvis/${path}${qs}`, {
      cache: "no-store",
      headers: authHeaders(),
    })
    status = res.status
    if (!res.ok) throw new JarvisApiError(`GET ${path} failed (${res.status})`, res.status)
    return (await res.json()) as T
  } finally {
    publish({ method: "GET", path: `/${path}`, status, ms: Math.round(performance.now() - started), at: Date.now() })
  }
}

export async function jarvisPost<T>(path: string, body: unknown): Promise<T> {
  const auth = authHeaders()
  if (!auth) throw new JarvisApiError("Sign in required", 401)
  const started = performance.now()
  let status = 0
  try {
    const res = await fetch(`/api/jarvis/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify(body ?? {}),
    })
    status = res.status
    const json = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new JarvisApiError(json?.error ?? `POST ${path} failed (${res.status})`, res.status)
    return json
  } finally {
    publish({ method: "POST", path: `/${path}`, status, ms: Math.round(performance.now() - started), at: Date.now() })
  }
}
