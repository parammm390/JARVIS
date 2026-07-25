import type { Metadata } from "next"
import { Showtime } from "@/components/jarvis/Showtime"

export const metadata: Metadata = {
  title: "FINNOR JARVIS — Dealer Zero Showtime",
  description: "An explicitly synthetic, receipt-inspectable Dealer Zero demonstration.",
}

export default function JarvisShowtimePage() {
  return <Showtime />
}
