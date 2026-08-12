import type { Metadata } from "next"
import DispatchFieldSurface from "@/components/jarvis/panels/DispatchFieldSurface"

export const metadata: Metadata = {
  title: "JARVIS — Schedule",
  description: "Dispatch Field, stored routes, and technician My-Day in FINNOR JARVIS.",
}

export default function SchedulePage() {
  return <DispatchFieldSurface />
}
