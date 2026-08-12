"use client"

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useJarvisAuth } from "./jarvis-auth"
import { onBusinessInvalidation, publishBusinessInvalidation, type BusinessInvalidationSignal } from "./business-invalidation"
import {
  BusinessProjectionCache,
  serializeProjectionKey,
  type ProjectionDefinition,
  type ProjectionMetrics,
  type ProjectionSnapshot,
  type ProjectionTag,
} from "./business-projection-cache"

const BROADCAST_CHANNEL = "jarvis-business-projections-v1"

interface ProjectionClient {
  fetch<T>(definition: ProjectionDefinition<T>, force?: boolean): Promise<T | null>
  prime<T>(definition: ProjectionDefinition<T>, data: T, updatedAt?: number): void
  invalidate(tags: readonly ProjectionTag[], source?: BusinessInvalidationSignal["source"]): void
  metrics(): ProjectionMetrics
}

interface ProjectionContextValue {
  cache: BusinessProjectionCache
  client: ProjectionClient
  online: boolean
  visible: boolean
}

const ProjectionContext = createContext<ProjectionContextValue | null>(null)

function publishMetricsToBrowser(metrics: ProjectionMetrics): void {
  if (typeof window === "undefined") return
  ;(window as unknown as { __JARVIS_PROJECTION_METRICS__?: ProjectionMetrics }).__JARVIS_PROJECTION_METRICS__ = metrics
  window.dispatchEvent(new CustomEvent("jarvis:projection-metrics", { detail: metrics }))
}

export function BusinessProjectionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { session } = useJarvisAuth()
  const sessionBoundary = session ? `${session.user.id}:${session.access_token}` : "signed-out"
  const cache = useMemo(() => {
    void sessionBoundary
    return new BusinessProjectionCache(publishMetricsToBrowser)
  }, [sessionBoundary])
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine)
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden")
  useEffect(() => () => cache.reset(), [cache])

  useEffect(() => {
    const onVisibility = () => {
      const next = document.visibilityState !== "hidden"
      setVisible(next)
      cache.setVisible(next)
    }
    const onOnline = () => {
      setOnline(true)
      cache.setOnline(true)
    }
    const onOffline = () => {
      setOnline(false)
      cache.setOnline(false)
    }
    onVisibility()
    cache.setOnline(typeof navigator === "undefined" || navigator.onLine)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [cache])

  useEffect(() => {
    if (!session) return
    const scope = session.user.id
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(BROADCAST_CHANNEL)
    const unsubscribe = onBusinessInvalidation((signal) => {
      cache.invalidate(signal.tags)
      if (signal.source !== "broadcast") channel?.postMessage({ scope, tags: signal.tags, at: signal.at })
    })
    if (channel) {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data
        if (!value || typeof value !== "object" || Array.isArray(value)) return
        const message = value as { scope?: unknown; tags?: unknown }
        if (message.scope !== scope || !Array.isArray(message.tags)) return
        publishBusinessInvalidation({
          tags: message.tags.filter((tag): tag is ProjectionTag => typeof tag === "string") as ProjectionTag[],
          source: "broadcast",
        })
      }
    }
    return () => {
      unsubscribe()
      channel?.close()
    }
  }, [cache, session])

  const client = useMemo<ProjectionClient>(() => ({
    fetch: async <T,>(definition: ProjectionDefinition<T>, force = false) => {
      const id = cache.register(definition)
      return cache.ensure<T>(id, force)
    },
    prime: <T,>(definition: ProjectionDefinition<T>, data: T, updatedAt?: number) => cache.prime(definition, data, updatedAt),
    invalidate: (tags, source = "manual") => publishBusinessInvalidation({ tags, source }),
    metrics: () => cache.metricsSnapshot(),
  }), [cache])

  const value = useMemo(() => ({ cache, client, online, visible }), [cache, client, online, visible])
  return <ProjectionContext.Provider value={value}>{children}</ProjectionContext.Provider>
}

function useProjectionContext(): ProjectionContextValue {
  const context = useContext(ProjectionContext)
  if (!context) throw new Error("Business projections require <BusinessProjectionProvider>")
  return context
}

export interface UseBusinessProjectionOptions<T> {
  enabled?: boolean
  initialData?: T
  initialUpdatedAt?: number
}

export interface BusinessProjectionResult<T> extends ProjectionSnapshot<T> {
  online: boolean
  visible: boolean
  refresh: () => Promise<T | null>
}

export function useBusinessProjection<T>(definition: ProjectionDefinition<T>, options: UseBusinessProjectionOptions<T> = {}): BusinessProjectionResult<T> {
  const { cache, online, visible } = useProjectionContext()
  const enabled = options.enabled ?? true
  const id = cache.register(definition)
  const subscribe = useCallback((listener: () => void) => enabled ? cache.subscribe(id, listener) : () => undefined, [cache, enabled, id])
  const getSnapshot = useCallback(() => cache.snapshot<T>(id), [cache, id])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (!enabled) return
    if (options.initialData !== undefined) cache.prime(definition, options.initialData, options.initialUpdatedAt)
    void cache.ensure<T>(id).catch(() => undefined)
  }, [cache, definition, enabled, id, options.initialData, options.initialUpdatedAt])

  const refresh = useCallback(() => cache.ensure<T>(id, true), [cache, id])
  return useMemo(() => ({ ...snapshot, online, visible, refresh }), [online, refresh, snapshot, visible])
}

export function useBusinessProjectionClient(): ProjectionClient {
  return useProjectionContext().client
}

export function useBusinessProjectionMetrics(): ProjectionMetrics {
  const { cache } = useProjectionContext()
  return useSyncExternalStore(
    useCallback((listener: () => void) => cache.subscribeMetrics(listener), [cache]),
    useCallback(() => cache.metricsSnapshot(), [cache]),
    useCallback(() => cache.metricsSnapshot(), [cache]),
  )
}

export function projectionKeyId(definition: ProjectionDefinition<unknown>): string {
  return serializeProjectionKey(definition.key)
}
