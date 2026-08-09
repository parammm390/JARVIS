"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronUp, MoreHorizontal, X } from "lucide-react"
import {
  MOBILE_SURFACES,
  SURFACES,
  withHouseholdContext,
  type HouseholdContext,
  type OperationalSurface,
} from "./surface-routes"

export type { HouseholdContext, OperationalSurface } from "./surface-routes"
export { MOBILE_SURFACES, SURFACES, withHouseholdContext } from "./surface-routes"

export function OperationalSurfaceNav({ active, context }: { active: OperationalSurface; context?: HouseholdContext }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreCloseRef = useRef<HTMLButtonElement>(null)
  const moreActive = active === "customers" || active === "agents"

  useEffect(() => {
    if (!moreOpen) return
    const focusFrame = window.requestAnimationFrame(() => moreCloseRef.current?.focus({ preventScroll: true }))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMoreOpen(false)
      window.requestAnimationFrame(() => moreButtonRef.current?.focus({ preventScroll: true }))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [moreOpen])

  return (
    <header className="jarvis-surface-nav" data-jarvis-surface-nav data-more-open={moreOpen ? "true" : "false"}>
      <Link className="jarvis-surface-nav__brand" href="/jarvis" prefetch={false} aria-label="FINNOR JARVIS home">
        FINNOR <span>JARVIS</span>
      </Link>
      <nav className="jarvis-surface-nav__links" aria-label="Operational surfaces">
        {SURFACES.map((surface) => (
          <Link
            key={surface.key}
            href={withHouseholdContext(surface.href, context)}
            prefetch={false}
            className="jarvis-surface-nav__link"
            data-active={active === surface.key ? "true" : "false"}
            aria-current={active === surface.key ? "page" : undefined}
          >
            {surface.label}
          </Link>
        ))}
      </nav>
      <nav className="jarvis-surface-nav__mobile-links" aria-label="Mobile operational surfaces">
        {MOBILE_SURFACES.map((surface) => (
          <Link
            key={surface.key}
            href={withHouseholdContext(surface.href, context)}
            prefetch={false}
            className="jarvis-surface-nav__mobile-link"
            data-active={active === surface.key ? "true" : "false"}
            aria-current={active === surface.key ? "page" : undefined}
          >
            {surface.label}
          </Link>
        ))}
        <button ref={moreButtonRef} type="button" className="jarvis-surface-nav__mobile-link jarvis-surface-nav__more-button" data-active={moreOpen || moreActive ? "true" : "false"} aria-expanded={moreOpen} aria-controls="jarvis-more-surfaces" onClick={() => setMoreOpen((open) => !open)}>
          <MoreHorizontal size={14} aria-hidden />
          More
          {moreOpen ? <ChevronUp size={12} aria-hidden /> : null}
        </button>
      </nav>
      {moreOpen ? (
        <div id="jarvis-more-surfaces" className="jarvis-surface-nav__more-sheet" role="dialog" aria-label="More JARVIS surfaces">
          <div className="jarvis-surface-nav__more-heading"><span>MORE</span><button ref={moreCloseRef} type="button" onClick={() => setMoreOpen(false)} aria-label="Close more surfaces"><X size={15} /></button></div>
          <Link href={withHouseholdContext("/jarvis/customers", context)} prefetch={false} onClick={() => setMoreOpen(false)}>Customers</Link>
          <Link href={withHouseholdContext("/jarvis/agents", context)} prefetch={false} onClick={() => setMoreOpen(false)}>Agents</Link>
          <Link href="/jarvis/bridge" prefetch={false} onClick={() => setMoreOpen(false)}>Diagnostics</Link>
        </div>
      ) : null}
      {context ? (
        <span className="jarvis-context-capsule" data-jarvis-context-capsule data-context-household-id={context.id}>
          <span className="jarvis-context-capsule__eyebrow">Context</span>
          <span className="jarvis-context-capsule__label">{context.label}</span>
          <span className="jarvis-context-capsule__id">{context.id.slice(0, 8)}…</span>
        </span>
      ) : null}
    </header>
  )
}
