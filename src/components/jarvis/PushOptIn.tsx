"use client"

import { useState } from "react"
import { useJarvisAuth } from "./lib/jarvis-auth"
import { getCurrentAccessToken } from "./lib/jarvis-auth"

function publicKeyToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function PushOptIn() {
  const { session } = useJarvisAuth()
  const [state, setState] = useState<"idle" | "enabled" | "unavailable" | "error">("idle")
  async function enable() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!session || !key || !("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unavailable"); return }
    try {
      const registration = await navigator.serviceWorker.register("/jarvis-push-sw.js", { scope: "/" });
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("unavailable"); return }
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyToBytes(key) as unknown as BufferSource });
      const token = getCurrentAccessToken();
      const response = await fetch("/api/jarvis/push-subscriptions", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(subscription) });
      setState(response.ok ? "enabled" : "error");
    } catch { setState("error"); }
  }
  if (!session) return null
  if (state === "enabled") return <span className="text-xs text-emerald-300">Push alerts enabled</span>
  return <button type="button" onClick={() => void enable()} className="rounded border border-cyan-400/40 px-2 py-1 text-xs text-cyan-100">{state === "unavailable" ? "Push unavailable" : state === "error" ? "Retry push alerts" : "Enable push alerts"}</button>
}
