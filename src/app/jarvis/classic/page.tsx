import type { Metadata } from "next"
import PersonalizedHome from "@/components/jarvis/PersonalizedHome"

export const metadata: Metadata = {
  title: "FINNOR JARVIS Classic",
  description: "The legacy FINNOR JARVIS command center.",
}

export default function JarvisClassicPage() {
  return <PersonalizedHome />
}
