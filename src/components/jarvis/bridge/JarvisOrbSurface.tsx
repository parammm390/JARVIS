"use client"

import { useState } from "react"
import { Activity, Radio, Workflow, X } from "lucide-react"
import type { LiveFrameProjection } from "../kernel/liveframe"
import type { OrbVisualState } from "./orb-visual-state"
import { JarvisAmbientOrb } from "./JarvisAmbientOrb"
import styles from "./JarvisOrbSurface.module.css"

type Props = {
  visualState: OrbVisualState
  liveFrame: LiveFrameProjection
  forceLowPower?: boolean
  reducedMotion?: boolean
  voiceEnergy?: number
  activeRunCount?: number
  onExpandedChange?: (expanded: boolean) => void
}

/**
 * The bridge owns the one visual state; this component only chooses the
 * operational detail. The same live orb stays mounted when activated; opening
 * it reveals a compact activity lens instead of replacing the command surface
 * with a disconnected 3D scene.
 */
export function JarvisOrbSurface({
  visualState,
  liveFrame,
  forceLowPower = false,
  reducedMotion = false,
  voiceEnergy,
  activeRunCount,
  onExpandedChange,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const resolvedVoiceEnergy = voiceEnergy ?? liveFrame.voiceEnergy
  const resolvedRunCount = activeRunCount ?? liveFrame.activeRunIds.length
  const toggleActivity = () => {
    setExpanded((current) => {
      const next = !current
      onExpandedChange?.(next)
      return next
    })
  }
  const collapse = () => {
    setExpanded(false)
    onExpandedChange?.(false)
  }

  return (
    <section
      className={`${styles.surface} jarvis-orb-surface jarvis-orb-surface--ambient`}
      data-jarvis-orb-surface="true"
      data-jarvis-orb-state={visualState}
      data-jarvis-orb-expanded={expanded ? "true" : "false"}
      data-jarvis-orb-depth={expanded ? "activity" : "ambient"}
      aria-label={`JARVIS ${visualState} visual surface`}
    >
      <div className={`${styles.stage} jarvis-orb-surface__stage`} data-jarvis-orb-stage="ambient">
        <div className={styles.stageShell}>
          <JarvisAmbientOrb
            visualState={visualState}
            energy={liveFrame.energy}
            voiceEnergy={resolvedVoiceEnergy}
            activeRunCount={resolvedRunCount}
            reducedMotion={reducedMotion}
            lowPower={forceLowPower}
            onActivate={toggleActivity}
            className="jarvis-orb-surface__ambient"
          />
        </div>
        {expanded ? (
          <aside className={styles.activityPanel} aria-label="JARVIS live activity">
            <header className={styles.activityHeader}>
              <span><Activity size={14} aria-hidden />Live activity</span>
              <button type="button" onClick={collapse} aria-label="Close JARVIS activity"><X size={15} /></button>
            </header>
            <div className={styles.activityStatus} aria-live="polite">
              <span className={styles.activityPulse} data-state={visualState} aria-hidden />
              <span><small>Current state</small><strong>{visualState.replaceAll("-", " ")}</strong></span>
            </div>
            <dl className={styles.activityFacts}>
              <div><dt><Workflow size={13} aria-hidden />Workflow lanes</dt><dd>{resolvedRunCount}</dd></div>
              <div><dt><Radio size={13} aria-hidden />Connection</dt><dd>{liveFrame.transportPosture}</dd></div>
              <div><dt>Active actions</dt><dd>{liveFrame.activeActionIds.length}</dd></div>
              <div><dt>Active steps</dt><dd>{liveFrame.activeStepIds.length}</dd></div>
            </dl>
            <p>Click the orb again to close. Microphone control stays in the command dock.</p>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
