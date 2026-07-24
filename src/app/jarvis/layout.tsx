import type { ReactNode } from "react"
import { VapiSessionProvider } from "@/components/jarvis/lib/useVapiSession"

// Real structural fix: `useVapiSession()` used to be called independently in both
// JarvisCommandCenter.tsx (/jarvis) and Bridge.tsx (/jarvis/bridge) — two separate
// top-level components each creating their OWN Vapi/Daily call object, with zero
// coordination. Mounting the provider once here, at the shared /jarvis layout
// level, guarantees exactly one Vapi instance (and one microphone session) exists
// for the whole section, regardless of which page is showing or how navigation
// between them behaves.
export default function JarvisLayout({ children }: { children: ReactNode }) {
  return <VapiSessionProvider>{children}</VapiSessionProvider>
}
