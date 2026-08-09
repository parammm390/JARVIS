import type { Metadata } from "next"
import DispatchFieldSurface from "@/components/jarvis/panels/DispatchFieldSurface"
import { JarvisAuthProvider } from "@/components/jarvis/lib/jarvis-auth"

export const metadata: Metadata = {
  title: "JARVIS — Schedule",
  description: "Dispatch Field, stored routes, and technician My-Day in FINNOR JARVIS.",
}

export default function SchedulePage() {
  return (
    <JarvisAuthProvider>
      <DispatchFieldSurface />
    </JarvisAuthProvider>
  )
}
