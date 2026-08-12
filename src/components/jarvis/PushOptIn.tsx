"use client"

import { useState } from "react"
import { useJarvisAuth } from "./lib/jarvis-auth"
import { jarvisGet, jarvisPost, jarvisPut } from "./lib/api"

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
    // `registration.pushManager` is the authoritative capability. Some
    // Chromium contexts do not expose the global `PushManager` constructor
    // even though a registered service worker can subscribe successfully.
    if (!session || !key || !("serviceWorker" in navigator)) { setState("unavailable"); return }
    try {
      // The script is served below /jarvis, so its legal default scope is the
      // canonical product subtree. Asking for site-root scope without a
      // Service-Worker-Allowed header makes Chrome reject registration with the
      // opaque "Invalid scope" warning and leaves opt-in permanently broken.
      const registration = await navigator.serviceWorker.register("/jarvis-push-sw.js", { scope: "/jarvis/" });
      if (!registration.pushManager) { setState("unavailable"); return }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("unavailable"); return }
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyToBytes(key) as unknown as BufferSource });
      await jarvisPost("push-subscriptions", subscription);
      // D6.T5's opt-in is a real preference as well as a browser subscription. Read
      // first so enabling push never deletes another notification channel's setting.
      const prefs = await jarvisGet<{ prefs?: { notificationPreferences?: Record<string, boolean> } }>("user-prefs");
      const preferences = { ...(prefs?.prefs?.notificationPreferences ?? {}), push: true };
      await jarvisPut("user-prefs", { notificationPreferences: preferences });
      setState("enabled");
    } catch { setState("error"); }
  }
  if (!session) return null
  if (state === "enabled") return <span className="text-xs text-emerald-300">Push alerts enabled</span>
  return <button type="button" onClick={() => void enable()} className="rounded border border-cyan-400/40 px-2 py-1 text-xs text-cyan-100">{state === "unavailable" ? "Push unavailable" : state === "error" ? "Retry push alerts" : "Enable push alerts"}</button>
}
