import type { Metadata } from "next"
import Household360Surface from "@/components/jarvis/panels/Household360Surface"

export const metadata: Metadata = {
  title: "JARVIS — Customers",
  description: "Household 360 operational customer records in FINNOR JARVIS.",
}

export default function CustomersPage() {
  return <Household360Surface />
}
