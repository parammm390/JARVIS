import type { Metadata } from "next"
import { LoginForm } from "@/components/jarvis/lib/LoginForm"

export const metadata: Metadata = {
  title: "Sign in — FINNOR JARVIS",
  description: "Sign in to your JARVIS command center.",
}

export default function JarvisLoginPage() {
  return <LoginForm />
}
