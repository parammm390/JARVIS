"use client"

import { Home, LoaderCircle, MessageSquareText, PanelLeftOpen, X } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useKernel, type DurableThreadSummary } from "../kernel/store"

function activityLabel(value: string): string {
  const at = new Date(value)
  if (!Number.isFinite(at.getTime())) return "Saved thread"
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - at.getTime()) / 60_000))
  if (elapsedMinutes < 1) return "Just now"
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  if (elapsedMinutes < 1_440) return `${Math.floor(elapsedMinutes / 60)}h ago`
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function threadKind(thread: DurableThreadSummary): string {
  if (thread.activeObjectiveLoopId) return "Objective"
  if (thread.activeWorkId) return "Work"
  return "Thread"
}

/** Durable authenticated conversation navigation. The sidebar selects through
 * Kernel.openThread, which reconstructs messages + canonical Work; it never
 * promotes component-lifetime transcript history into business state. */
export function PersistentThreadSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const kernel = useKernel()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openingThreadId, setOpeningThreadId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const activeThreadId = kernel.thread?.conversationThreadId ?? null
  const threads = useMemo(() => {
    if (!activeThreadId || kernel.recentThreads.some((thread) => thread.id === activeThreadId) || !kernel.thread) return kernel.recentThreads
    const active: DurableThreadSummary = {
      id: activeThreadId,
      title: kernel.thread.instructionText || "Current conversation",
      summary: null,
      activeWorkId: kernel.thread.workId ?? null,
      activeObjectiveLoopId: kernel.thread.objectiveLoopId ?? null,
      lastActivityAt: new Date(kernel.thread.createdAtMs).toISOString(),
      createdAt: new Date(kernel.thread.createdAtMs).toISOString(),
    }
    return [active, ...kernel.recentThreads]
  }, [activeThreadId, kernel.recentThreads, kernel.thread])

  useEffect(() => setMobileOpen(false), [pathname])
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [mobileOpen])

  const selectThread = async (threadId: string) => {
    setSelectionError(null)
    setOpeningThreadId(threadId)
    try {
      if (threadId !== activeThreadId) await kernel.openThread(threadId)
      setMobileOpen(false)
      router.push("/jarvis")
    } catch {
      setSelectionError("This thread could not be reconstructed. Your current Work has not been replaced.")
    } finally {
      setOpeningThreadId(null)
    }
  }

  return (
    <>
      <button type="button" className="jarvis-thread-sidebar__toggle" onClick={() => setMobileOpen(true)} aria-label="Open conversations" aria-expanded={mobileOpen} aria-controls="jarvis-thread-sidebar">
        <PanelLeftOpen size={17} aria-hidden />
        <span>Threads</span>
      </button>
      {mobileOpen ? <button type="button" className="jarvis-thread-sidebar__backdrop" onClick={() => setMobileOpen(false)} aria-label="Close conversations" /> : null}
      <aside id="jarvis-thread-sidebar" className="jarvis-thread-sidebar" data-mobile-open={mobileOpen ? "true" : "false"} aria-label="JARVIS conversations">
        <div className="jarvis-thread-sidebar__header">
          <div><span>JARVIS</span><strong>Conversations</strong></div>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close conversations"><X size={15} /></button>
        </div>
        <button type="button" className="jarvis-thread-sidebar__home" onClick={() => { setMobileOpen(false); router.push("/jarvis") }}>
          <Home size={14} aria-hidden />
          <span>Current command center</span>
        </button>
        <div className="jarvis-thread-sidebar__section-heading">
          <span>Recent</span>
          <span data-thread-history-status={kernel.recentThreadsStatus}>{kernel.recentThreadsStatus === "loading" ? "Syncing" : kernel.recentThreadsStatus === "unavailable" ? "Offline" : "Durable"}</span>
        </div>
        <div className="jarvis-thread-sidebar__list">
          {kernel.recentThreadsStatus === "loading" && threads.length === 0 ? (
            <div className="jarvis-thread-sidebar__empty" role="status"><LoaderCircle className="animate-spin" size={14} /> Reading threads…</div>
          ) : threads.length === 0 ? (
            <div className="jarvis-thread-sidebar__empty"><MessageSquareText size={16} />Your first instruction will create a durable conversation.</div>
          ) : threads.map((thread) => {
            const active = thread.id === activeThreadId
            const opening = thread.id === openingThreadId
            return (
              <button key={thread.id} type="button" className="jarvis-thread-sidebar__row" data-active={active ? "true" : "false"} aria-current={active ? "true" : undefined} disabled={openingThreadId !== null} onClick={() => void selectThread(thread.id)}>
                <span className="jarvis-thread-sidebar__row-title">{thread.title ?? "Untitled conversation"}</span>
                <span className="jarvis-thread-sidebar__row-meta"><span>{active ? "Active" : threadKind(thread)}</span><time dateTime={thread.lastActivityAt}>{opening ? "Opening…" : activityLabel(thread.lastActivityAt)}</time></span>
              </button>
            )
          })}
        </div>
        {kernel.recentThreadsStatus === "unavailable" ? <p className="jarvis-thread-sidebar__notice" role="status">Showing the last verified list. Active Work remains available.</p> : null}
        {selectionError ? <p className="jarvis-thread-sidebar__notice" role="alert">{selectionError}</p> : null}
      </aside>
    </>
  )
}
