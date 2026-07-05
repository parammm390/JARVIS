import type { ReactNode } from "react"
import { Footer } from "@/components/sections/Footer"
import { ResourceNav } from "./ResourceNav"

export function ResourceFrame({ children }: { children: ReactNode }) {
  return (
    <main className="healthcare-page flex min-h-screen w-full flex-col selection:bg-teal-200/40">
      <ResourceNav />
      {children}
      <Footer />
    </main>
  )
}
