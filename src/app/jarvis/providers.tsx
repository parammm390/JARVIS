"use client"

import type { ReactNode } from "react"
import { VapiSessionProvider } from "@/components/jarvis/lib/useVapiSession"
import { JarvisAuthProvider } from "@/components/jarvis/lib/jarvis-auth"
import { BusinessProjectionProvider } from "@/components/jarvis/lib/business-projections"
import { JarvisDataProvider } from "@/components/jarvis/lib/data-core"
import { WorkspaceConfigProvider } from "@/components/jarvis/WorkspaceConfigProvider"

export function JarvisProviders({ children }: { children: ReactNode }) {
  return (
    <VapiSessionProvider>
      <JarvisAuthProvider>
        <WorkspaceConfigProvider>
          <BusinessProjectionProvider>
            <JarvisDataProvider>{children}</JarvisDataProvider>
          </BusinessProjectionProvider>
        </WorkspaceConfigProvider>
      </JarvisAuthProvider>
    </VapiSessionProvider>
  )
}
