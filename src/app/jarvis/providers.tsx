"use client"

import type { ReactNode } from "react"
import { VapiSessionProvider } from "@/components/jarvis/lib/useVapiSession"
import { JarvisAuthProvider } from "@/components/jarvis/lib/jarvis-auth"
import { BusinessProjectionProvider } from "@/components/jarvis/lib/business-projections"
import { JarvisDataProvider } from "@/components/jarvis/lib/data-core"

export function JarvisProviders({ children }: { children: ReactNode }) {
  return (
    <VapiSessionProvider>
      <JarvisAuthProvider>
        <BusinessProjectionProvider>
          <JarvisDataProvider>{children}</JarvisDataProvider>
        </BusinessProjectionProvider>
      </JarvisAuthProvider>
    </VapiSessionProvider>
  )
}
