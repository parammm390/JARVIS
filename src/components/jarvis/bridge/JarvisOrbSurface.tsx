"use client"

import { useState } from "react"
import type { LiveFrameProjection } from "../kernel/liveframe"
import type { OrbVisualState } from "./orb-visual-state"
import { JarvisAmbientOrb } from "./JarvisAmbientOrb"
import { JarvisImmersiveOrb } from "./JarvisImmersiveOrb"
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
 * presentation depth. Ambient is the resting surface and its activation is
 * deliberately separate from the microphone control rendered by ThreadBridge.
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
  const expand = () => {
    setExpanded(true)
    onExpandedChange?.(true)
  }
  const collapse = () => {
    setExpanded(false)
    onExpandedChange?.(false)
  }

  return (
    <section
      className={`${styles.surface} jarvis-orb-surface ${expanded ? "jarvis-orb-surface--immersive" : "jarvis-orb-surface--ambient"}`}
      data-jarvis-orb-surface="true"
      data-jarvis-orb-state={visualState}
      data-jarvis-orb-expanded={expanded ? "true" : "false"}
      data-jarvis-orb-depth={expanded ? "immersive" : "ambient"}
      aria-label={`JARVIS ${visualState} visual surface`}
    >
      <div className={`${styles.stage} jarvis-orb-surface__stage`} data-jarvis-orb-stage={expanded ? "immersive" : "ambient"}>
        {expanded ? (
          <JarvisImmersiveOrb
            visualState={visualState}
            energy={liveFrame.energy}
            voiceEnergy={resolvedVoiceEnergy}
            activeRunCount={resolvedRunCount}
            expanded
            reducedMotion={reducedMotion}
            lowPower={forceLowPower}
            onRequestClose={collapse}
            className="jarvis-orb-surface__immersive"
          />
        ) : (
          <JarvisAmbientOrb
            visualState={visualState}
            energy={liveFrame.energy}
            voiceEnergy={resolvedVoiceEnergy}
            activeRunCount={resolvedRunCount}
            reducedMotion={reducedMotion}
            lowPower={forceLowPower}
            onActivate={expand}
            className="jarvis-orb-surface__ambient"
          />
        )}
      </div>
    </section>
  )
}
