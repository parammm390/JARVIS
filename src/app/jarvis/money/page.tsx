import type { Metadata } from "next"
import CashPressureSurface from "@/components/jarvis/panels/CashPressureSurface"
import { BusinessWorldScene } from "@/components/jarvis/BusinessWorldScene"

export const metadata: Metadata = {
  title: "JARVIS — Money",
  description: "Cash Pressure Field, invoice ledger, and collections Work in FINNOR JARVIS.",
}

export default function MoneyPage() {
  return <><BusinessWorldScene scene="money" /><CashPressureSurface /></>
}
