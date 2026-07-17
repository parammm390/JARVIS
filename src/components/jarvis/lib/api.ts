"use client"

// Single fetch surface for every JARVIS panel. Reads go through the same-origin
// /api/jarvis/* proxy (public, read-only). Writes go through the same proxy but
// require the owner's admin key (entered once, kept in localStorage, never sent
// anywhere except this proxy) — see CommandPalette/ApprovalDock for the prompt.

const KEY_STORAGE = "jarvis_admin_key"

export function getJarvisKey(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(KEY_STORAGE)
}

export function setJarvisKey(key: string): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY_STORAGE, key)
}

export function clearJarvisKey(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(KEY_STORAGE)
}

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

export async function jarvisGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : ""
  const started = performance.now()
  let status = 0
  try {
    const res = await fetch(`/api/jarvis/${path}${qs}`, { cache: "no-store" })
    status = res.status
    if (!res.ok) throw new JarvisApiError(`GET ${path} failed (${res.status})`, res.status)
    return (await res.json()) as T
  } finally {
    publish({ method: "GET", path: `/${path}`, status, ms: Math.round(performance.now() - started), at: Date.now() })
  }
}

export async function jarvisPost<T>(path: string, body: unknown): Promise<T> {
  const key = getJarvisKey()
  if (!key) throw new JarvisApiError("Admin key required", 401)
  const started = performance.now()
  let status = 0
  try {
    const res = await fetch(`/api/jarvis/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-jarvis-key": key },
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
