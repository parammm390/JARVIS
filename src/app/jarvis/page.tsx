import type { Metadata } from "next"
import JarvisCommandCenter from "@/components/jarvis/JarvisCommandCenter"

export const metadata: Metadata = {
  title: "FINNOR JARVIS — Live AI Command Center for Water Treatment",
  description:
    "Speak to FINNOR. It plans real business actions — bookings, leads, inventory, invoices, research — reads them back for your approval, executes, and logs every step.",
}

export default function JarvisPage() {
  return <JarvisCommandCenter />
}
