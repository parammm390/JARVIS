"use client"

import { useEffect, useId, useRef, useState, type CSSProperties } from "react"
import type * as THREE from "three"
import styles from "./JarvisAmbientOrb.module.css"

type ThreeRuntime = typeof import("three")

/**
 * The ambient surface intentionally owns a structural copy of the visual-state
 * union.  Keeping this contract local means the surface can be mounted while the
 * kernel is being composed without introducing a second runtime state machine or a
 * dependency on an in-flight shared type.
 */
export type JarvisVisualState =
  | "idle"
  | "listening"
  | "acknowledged"
  | "thinking"
  | "answer-ready"
  | "proposal-ready"
  | "deferred"
  | "needs-human-review"
  | "executing"
  | "verifying"
  | "failed"
  | "cancelled-stale"

export interface JarvisAmbientOrbProps {
  visualState: JarvisVisualState
  energy?: number
  voiceEnergy?: number
  activeRunCount?: number
  reducedMotion?: boolean
  lowPower?: boolean
  onActivate?: () => void
  className?: string
}

type RGB = [number, number, number]

interface StateProfile {
  index: number
  color: RGB
  accent: RGB
  speed: number
  amplitude: number
  opacity: number
  ringOpacity: [number, number, number]
}

/* Values stay in the same cyan / teal / violet / amber / blue / green / red
 * vocabulary as the JARVIS theme.  The profile is presentation metadata for the
 * real state supplied by the caller; it does not advance state or synthesize data. */
const STATE_PROFILE: Record<JarvisVisualState, StateProfile> = {
  idle: {
    index: 0,
    color: [0.12, 0.76, 0.94],
    accent: [0.31, 0.5, 1],
    speed: 0.16,
    amplitude: 0.08,
    opacity: 0.92,
    ringOpacity: [0, 0, 0],
  },
  listening: {
    index: 1,
    color: [0.15, 0.72, 0.64],
    accent: [0.6, 0.94, 0.84],
    speed: 0.32,
    amplitude: 0.16,
    opacity: 0.98,
    ringOpacity: [0.25, 0.14, 0.08],
  },
  acknowledged: {
    index: 2,
    color: [0.4, 0.79, 0.86],
    accent: [0.75, 0.94, 1],
    speed: 0.58,
    amplitude: 0.1,
    opacity: 0.98,
    ringOpacity: [0.34, 0.19, 0.1],
  },
  thinking: {
    index: 3,
    color: [0.49, 0.3, 0.82],
    accent: [0.76, 0.68, 1],
    speed: 0.92,
    amplitude: 0.22,
    opacity: 0.96,
    ringOpacity: [0.16, 0.28, 0.16],
  },
  "answer-ready": {
    index: 4,
    color: [0.55, 0.86, 0.9],
    accent: [0.94, 1, 0.98],
    speed: 0.2,
    amplitude: 0.035,
    opacity: 1,
    ringOpacity: [0.27, 0.13, 0.08],
  },
  "proposal-ready": {
    index: 5,
    color: [0.86, 0.54, 0.16],
    accent: [1, 0.79, 0.42],
    speed: 0.26,
    amplitude: 0.08,
    opacity: 0.98,
    ringOpacity: [0.4, 0.28, 0.14],
  },
  deferred: {
    index: 6,
    color: [0.68, 0.42, 0.14],
    accent: [0.9, 0.62, 0.25],
    speed: 0.08,
    amplitude: 0.028,
    opacity: 0.8,
    ringOpacity: [0.2, 0.08, 0.03],
  },
  "needs-human-review": {
    index: 7,
    color: [0.85, 0.62, 0.2],
    accent: [0.82, 0.3, 0.28],
    speed: 0.14,
    amplitude: 0.045,
    opacity: 0.9,
    ringOpacity: [0.24, 0.24, 0.07],
  },
  executing: {
    index: 8,
    color: [0.14, 0.46, 0.76],
    accent: [0.12, 0.72, 0.66],
    speed: 0.68,
    amplitude: 0.18,
    opacity: 0.98,
    ringOpacity: [0.34, 0.28, 0.18],
  },
  verifying: {
    index: 9,
    color: [0.17, 0.68, 0.4],
    accent: [0.8, 1, 0.88],
    speed: 1.02,
    amplitude: 0.08,
    opacity: 0.98,
    ringOpacity: [0.28, 0.36, 0.22],
  },
  failed: {
    index: 10,
    color: [0.82, 0.16, 0.23],
    accent: [0.95, 0.46, 0.26],
    speed: 0.38,
    amplitude: 0.15,
    opacity: 0.94,
    ringOpacity: [0.36, 0.16, 0.1],
  },
  "cancelled-stale": {
    index: 11,
    color: [0.38, 0.43, 0.5],
    accent: [0.24, 0.28, 0.34],
    speed: 0.025,
    amplitude: 0.012,
    opacity: 0.52,
    ringOpacity: [0.09, 0.045, 0.02],
  },
}

const STATE_LABEL: Record<JarvisVisualState, string> = {
  idle: "idle",
  listening: "listening",
  acknowledged: "acknowledged",
  thinking: "thinking and planning",
  "answer-ready": "answer ready",
  "proposal-ready": "proposal ready, awaiting approval",
  deferred: "deferred",
  "needs-human-review": "needs human review",
  executing: "executing",
  verifying: "verifying",
  failed: "failed",
  "cancelled-stale": "cancelled or stale",
}

const COMMAND_STATE_LABEL: Record<JarvisVisualState, string> = {
  idle: "standing by",
  listening: "listening",
  acknowledged: "intent received",
  thinking: "reasoning",
  "answer-ready": "answer ready",
  "proposal-ready": "decision required",
  deferred: "deferred",
  "needs-human-review": "operator review",
  executing: "executing",
  verifying: "verifying",
  failed: "attention required",
  "cancelled-stale": "stale",
}

const PARTICLE_COUNT = 11000
const MAX_RUN_MARKS = 8

type CommandCoreDot = {
  x: number
  y: number
  radius: number
  opacity: number
  accent: boolean
  depth: "rear" | "front"
}

type CommandCoreNetworkNode = {
  x: number
  y: number
  depth: "rear" | "front"
  emphasis: boolean
}

type CommandCoreNetworkLink = {
  x1: number
  y1: number
  x2: number
  y2: number
  depth: "rear" | "front" | "cross"
}

function clampUnit(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

function finiteRunCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_RUN_MARKS, Math.floor(value)))
}

function roundGeometry(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/* Deterministic geometry jitter.  A fixed field gives every mounted orb the same
 * recognizable material and avoids presenting random motion as a live signal. */
function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * A fixed projected star field for the command core. It is deliberately
 * deterministic—the points are material, not a pretend event stream—and gives
 * both the WebGL and static paths the same high-density globe silhouette. The
 * projection preserves a front/rear hemisphere relationship so the surface has
 * depth even when a device falls back to SVG without WebGL.
 */
function buildCommandCoreDots(): CommandCoreDot[] {
  const count = 840
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, index) => {
    const latitude = Math.asin(1 - ((index + 0.5) / count) * 2)
    const longitude = index * golden
    const projectedRadius = Math.cos(latitude)
    const depth = Math.sin(longitude) * projectedRadius
    const shimmer = hash(index * 8.37 + 2.1)
    const frontness = (depth + 1) * 0.5
    return {
      x: roundGeometry(320 + Math.cos(longitude) * projectedRadius * 195),
      y: roundGeometry(320 + Math.sin(latitude) * 195),
      radius: roundGeometry(0.44 + shimmer * 1.04 + frontness * 1.02),
      opacity: roundGeometry(0.11 + frontness * 0.55 + shimmer * 0.24),
      accent: (index % 29 === 0 && depth > -0.12) || (depth > 0.72 && index % 11 === 0),
      depth: depth > 0.08 ? "front" : "rear",
    }
  })
}

const COMMAND_CORE_DOTS = buildCommandCoreDots()

/**
 * A second, deliberately sparse, layer of the globe is a stable spherical
 * network.  It gives the core a readable spatial topology at a glance without
 * pretending that every visible line is an event, a customer, or a workflow.
 * The semantic labels outside the globe remain the only representation of live
 * tenant facts.  Nearest-neighbour edges preserve a proper curved-surface
 * appearance instead of drawing a flat random wireframe.
 */
function buildCommandCoreNetwork(): { nodes: CommandCoreNetworkNode[]; links: CommandCoreNetworkLink[] } {
  const count = 92
  const golden = Math.PI * (3 - Math.sqrt(5))
  const vectors = Array.from({ length: count }, (_, index) => {
    const vertical = 1 - ((index + 0.5) / count) * 2
    const ring = Math.sqrt(Math.max(0, 1 - vertical * vertical))
    const longitude = index * golden
    const x = Math.cos(longitude) * ring
    const y = vertical
    const z = Math.sin(longitude) * ring
    return { x, y, z }
  })
  const nodes = vectors.map((vector, index) => ({
    x: roundGeometry(320 + vector.x * 191),
    y: roundGeometry(320 + vector.y * 191),
    depth: vector.z > 0.08 ? "front" as const : "rear" as const,
    emphasis: vector.z > 0.35 && index % 7 === 0,
  }))
  const seen = new Set<string>()
  const links: CommandCoreNetworkLink[] = []

  vectors.forEach((source, index) => {
    const closest = vectors
      .map((candidate, candidateIndex) => ({
        candidateIndex,
        distance: (source.x - candidate.x) ** 2 + (source.y - candidate.y) ** 2 + (source.z - candidate.z) ** 2,
      }))
      .filter(({ candidateIndex }) => candidateIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)

    closest.forEach(({ candidateIndex }) => {
      const first = Math.min(index, candidateIndex)
      const second = Math.max(index, candidateIndex)
      const key = `${first}:${second}`
      if (seen.has(key)) return
      seen.add(key)
      const target = vectors[candidateIndex]!
      const averageDepth = (source.z + target.z) * 0.5
      links.push({
        x1: nodes[index]!.x,
        y1: nodes[index]!.y,
        x2: nodes[candidateIndex]!.x,
        y2: nodes[candidateIndex]!.y,
        depth: averageDepth > 0.1 ? "front" : averageDepth < -0.16 ? "rear" : "cross",
      })
    })
  })

  return { nodes, links }
}

const COMMAND_CORE_NETWORK = buildCommandCoreNetwork()

// These are stable topology traces, not a synthetic activity feed. Their only
// purpose is to turn the resting core into a technical instrument rather than
// a decorative planet. Real action/connection/workflow counts remain in the
// neighboring semantic readouts.
const COMMAND_CORE_LINKS = [
  { d: "M148 285C202 255 230 252 274 278S370 320 468 279", layer: "rear" },
  { d: "M144 361C202 387 251 402 299 375S392 337 492 368", layer: "rear" },
  { d: "M208 188C243 228 274 256 319 241S390 221 433 270", layer: "rear" },
  { d: "M197 446C241 408 282 383 323 400S407 441 456 381", layer: "rear" },
  { d: "M159 323C216 292 242 298 291 328S378 367 483 327", layer: "front" },
  { d: "M176 383C221 345 263 334 305 359S393 392 469 350", layer: "front" },
  { d: "M225 236C258 275 296 284 335 261S396 246 437 301", layer: "front" },
  { d: "M228 427C270 393 312 386 349 411S399 435 441 390", layer: "front" },
] as const

function buildParticleGeometry(three: ThreeRuntime): THREE.BufferGeometry {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const seeds = new Float32Array(PARTICLE_COUNT)
  const bands = new Float32Array(PARTICLE_COUNT)
  const layers = new Float32Array(PARTICLE_COUNT)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = goldenAngle * i
    // Three deterministic depths keep the material volumetric instead of reading
    // as one flat billboard: a concentrated inner cloud, the main mid grain, and
    // a sparse outer falloff which catches cursor pressure and ice-white highlights.
    const layer = hash(i * 3.13 + 2.2)
    const layerJitter = hash(i * 5.17 + 8.3)
    const layerRadius = layer < 0.52
      ? 0.38 + layerJitter * 0.74
      : layer < 0.86
        ? 1.06 + layerJitter * 0.34
        : 1.46 + layerJitter * 0.24
    const shellRadius = layerRadius + (hash(i) - 0.5) * (layer < 0.52 ? 0.08 : 0.1)
    positions[i * 3] = Math.cos(theta) * radius * shellRadius
    positions[i * 3 + 1] = y * shellRadius
    positions[i * 3 + 2] = Math.sin(theta) * radius * shellRadius
    seeds[i] = hash(i * 7.31 + 4.1)
    bands[i] = i % 6
    layers[i] = layer
  }

  const geometry = new three.BufferGeometry()
  geometry.setAttribute("position", new three.BufferAttribute(positions, 3))
  geometry.setAttribute("aSeed", new three.BufferAttribute(seeds, 1))
  geometry.setAttribute("aBand", new three.BufferAttribute(bands, 1))
  geometry.setAttribute("aLayer", new three.BufferAttribute(layers, 1))
  return geometry
}

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uVoiceEnergy;
  uniform float uPointerActive;
  uniform float uState;
  uniform float uSpeed;
  uniform float uActiveRuns;
  uniform vec2 uPointer;
  attribute float aSeed;
  attribute float aBand;
  attribute float aLayer;
  varying float vSeed;
  varying float vLight;
  varying float vDepth;
  varying float vLayer;

  void main() {
    vec3 p = position;
    vec3 direction = normalize(position);
    float breathing = sin(uTime * (0.38 + aSeed * 0.66) + aSeed * 34.0);
    float radial = breathing * (0.012 + uEnergy * 0.052);

    vec4 baseView = modelViewMatrix * vec4(p, 1.0);
    vec4 baseClip = projectionMatrix * baseView;
    vec2 ndc = baseClip.xy / baseClip.w;
    float cursorDistance = length(ndc - uPointer);
    float cursor = smoothstep(0.68, 0.0, cursorDistance) * uPointerActive;

    /* Each branch is a visual reading of one real state.  None of these branches
     * chooses a state or advances a workflow; uState is supplied by the caller. */
    if (uState < 0.5) {
      // idle: slow living depth and pointer-parallax breathing
      radial += sin(uTime * 0.72 + aSeed * 21.0) * (0.015 + uEnergy * 0.025);
    } else if (uState < 1.5) {
      // listening: the only amplitude which can swell this resonance is mic energy
      float resonance = sin(uTime * (2.4 + aSeed * 1.6) + aSeed * 46.0);
      radial += resonance * (0.008 + uVoiceEnergy * 0.14);
      radial += uVoiceEnergy * 0.035;
    } else if (uState < 2.5) {
      // acknowledged: a crisp inward confirmation rather than an outward burst
      float inward = 0.5 + 0.5 * cos(uTime * 2.8 + aSeed * 5.0);
      radial -= inward * (0.018 + uEnergy * 0.05);
    } else if (uState < 3.5) {
      // thinking: bands assemble through an inward, violet vortex
      float twist = uTime * (0.24 + uSpeed * 0.38) + (1.0 - aBand / 6.0) * 1.25;
      vec2 spun = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p.xz;
      p.xz = spun;
      radial -= 0.025 + 0.025 * sin(uTime * 1.1 + aSeed * 22.0);
    } else if (uState < 4.5) {
      // answer-ready: resolved shell, restrained motion, high clarity
      radial += sin(uTime * 0.5 + aSeed * 18.0) * 0.012;
    } else if (uState < 5.5) {
      // proposal-ready: four approval facets hold an amber geometry in place
      float facet = abs(sin(atan(p.z, p.x) * 4.0));
      radial += smoothstep(0.72, 0.98, facet) * 0.052;
    } else if (uState < 6.5) {
      // deferred: suspended hold, with motion deliberately close to stillness
      radial += sin(uTime * 0.42 + aSeed * 8.0) * 0.008;
      p.y += sin(uTime * 0.32 + aSeed * 4.0) * 0.01;
    } else if (uState < 7.5) {
      // needs-human-review: the shell is visibly held on two sides of a seam
      float side = p.x < 0.0 ? -1.0 : 1.0;
      p.x += side * 0.038;
      radial += sin(uTime * 0.3 + aSeed * 7.0) * 0.012;
    } else if (uState < 8.5) {
      // executing: active lanes travel through the shell; run count is real input
      float lane = sin(uTime * (1.1 + uSpeed) + aBand * 2.6 + aSeed * 8.0);
      p += normalize(vec3(-p.z, 0.0, p.x)) * lane * (0.02 + uActiveRuns * 0.008);
      radial += lane * 0.018;
    } else if (uState < 9.5) {
      // verifying: tighten toward a green/white core
      radial -= 0.045 + 0.018 * sin(uTime * 2.0 + aSeed * 20.0);
    } else if (uState < 10.5) {
      // failed: deterministic red fracture vectors, with a restrained recovery wave
      float fracture = step(0.56, aSeed) * sin(uTime * 1.35 + aSeed * 43.0);
      p += vec3(sign(p.x) * fracture, sign(p.y) * fracture * 0.45, 0.0) * 0.055;
      radial += fracture * 0.02;
    } else {
      // cancelled/stale: interrupted, desaturated signal with almost no forward motion
      radial += sin(uTime * 0.18 + aSeed * 5.0) * 0.004;
      p.x += sign(p.x) * 0.012;
    }

    // Cursor proximity is a local surface response, while the host CSS layer carries
    // the slower whole-orb tilt.  Both remain active at idle.
    p += direction * (radial + cursor * (0.11 + uEnergy * 0.16));
    p += vec3(uPointer.x * cursor * 0.018, -uPointer.y * cursor * 0.018, 0.0);

    vec4 modelView = modelViewMatrix * vec4(p, 1.0);
    vSeed = aSeed;
    vDepth = clamp(0.5 + p.z * 0.28, 0.0, 1.0);
    float coreFocus = 1.0 - smoothstep(0.34, 1.16, length(p));
    vLight = clamp(cursor * 0.9 + vDepth * 0.3 + uEnergy * 0.12 + coreFocus * 0.2, 0.0, 1.0);
    vLayer = aLayer;
    float pointSize = (1.0 + aSeed * 1.65) * (8.0 / -modelView.z);
    pointSize *= 0.52 + uEnergy * 0.72;
    pointSize *= 0.9 + (1.0 - smoothstep(0.12, 0.78, aLayer)) * 0.34 + aLayer * 0.06;
    pointSize *= 1.0 + cursor * 2.3;
    gl_PointSize = min(pointSize, 13.0);
    gl_Position = projectionMatrix * modelView;
  }
`

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uOpacity;
  uniform float uState;
  varying float vSeed;
  varying float vLight;
  varying float vDepth;
  varying float vLayer;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float distanceFromCenter = length(point);
    if (distanceFromCenter > 0.5) discard;
    float disc = smoothstep(0.5, 0.0, distanceFromCenter);
    float accentMix = clamp(vDepth * 0.82 + vSeed * 0.18, 0.0, 1.0);
    vec3 color = mix(uColor, uAccent, accentMix * 0.66);
    color = mix(color, vec3(1.0), vLight * 0.62);
    float stateDim = uState > 10.5 ? 0.72 : 1.0;
    float innerPresence = 1.0 - smoothstep(0.28, 0.92, vLayer);
    float layerDensity = mix(0.34, 1.0, innerPresence);
    float alpha = disc * (0.13 + vSeed * 0.24 + vDepth * 0.16 + vLight * 0.34) * layerDensity * uOpacity * stateDim;
    gl_FragColor = vec4(color, alpha);
  }
`

function buildRingGeometry(three: ThreeRuntime, radiusX: number, radiusY: number, depth: number): THREE.BufferGeometry {
  const segments = 96
  const positions = new Float32Array(segments * 3)
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    positions[i * 3] = Math.cos(angle) * radiusX
    positions[i * 3 + 1] = Math.sin(angle) * radiusY
    positions[i * 3 + 2] = depth
  }
  const geometry = new three.BufferGeometry()
  geometry.setAttribute("position", new three.BufferAttribute(positions, 3))
  return geometry
}

function isLowPowerDevice(): boolean {
  // The CSS instrument is the deliberate mobile fallback: it preserves the
  // state silhouette and labels while avoiding a 11k-particle WebGL scene on a
  // constrained/touch viewport. This is presentation-only and never removes
  // operational controls or source-backed copy.
  if (window.matchMedia?.("(max-width: 600px), (pointer: coarse)").matches) return true
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return typeof memory === "number" && memory <= 2
}

function asRgb([r, g, b]: RGB): string {
  return `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`
}

/**
 * A structural overlay for the ambient renderer. The WebGL field supplies the
 * living material; this layer supplies the legible, technical silhouette that
 * keeps the resting core from reading as a generic glowing ball when a device
 * falls back to CSS-only rendering. Its geometry is presentation-only: state,
 * run count, and colour are all supplied by the caller above.
 */
function CommandCoreOverlay({
  visualState,
  activeRunCount,
}: {
  visualState: JarvisVisualState
  activeRunCount: number
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const clipId = `jarvis-command-core-clip-${id}`
  const runMarks = Math.min(MAX_RUN_MARKS, Math.max(0, activeRunCount))

  return (
    <div className={styles.commandOverlay} aria-hidden>
      <svg className={styles.commandMesh} viewBox="0 0 640 640" fill="none" focusable="false">
        <defs>
          <clipPath id={clipId}>
            <circle cx="320" cy="320" r="202" />
          </clipPath>
          <radialGradient id={`jarvis-command-core-fill-${id}`} cx="0" cy="0" r="1" gradientTransform="translate(278 238) rotate(50) scale(338)">
            <stop stopColor="#d8fbff" stopOpacity="0.84" />
            <stop offset="0.08" stopColor="#59ddff" stopOpacity="0.42" />
            <stop offset="0.3" stopColor="#0871cb" stopOpacity="0.22" />
            <stop offset="0.7" stopColor="#041d45" stopOpacity="0.48" />
            <stop offset="1" stopColor="#010611" stopOpacity="0.95" />
          </radialGradient>
          <radialGradient id={`jarvis-command-core-halo-${id}`} cx="0" cy="0" r="1" gradientTransform="translate(320 320) rotate(90) scale(276)">
            <stop offset="0.52" stopColor="#0aa9e6" stopOpacity="0.12" />
            <stop offset="0.78" stopColor="#064b98" stopOpacity="0.06" />
            <stop offset="1" stopColor="#051229" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`jarvis-command-core-glass-${id}`} x1="162" y1="130" x2="486" y2="524" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d9faff" stopOpacity="0.11" />
            <stop offset="0.3" stopColor="#3edcff" stopOpacity="0.025" />
            <stop offset="0.68" stopColor="#061d4d" stopOpacity="0" />
            <stop offset="1" stopColor="#020715" stopOpacity="0.36" />
          </linearGradient>
          <linearGradient id={`jarvis-command-core-sweep-${id}`} x1="112" y1="0" x2="528" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0ad4ff" stopOpacity="0" />
            <stop offset="0.48" stopColor="#d9fbff" stopOpacity="0.72" />
            <stop offset="0.62" stopColor="#30dbff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#0ad4ff" stopOpacity="0" />
          </linearGradient>
          <filter id={`jarvis-command-core-glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle className={styles.commandMeshHalo} cx="320" cy="320" r="274" fill={`url(#jarvis-command-core-halo-${id})`} />
        <circle className={styles.commandMeshAura} cx="320" cy="320" r="238" />
        <circle className={styles.commandMeshPlanet} cx="320" cy="320" r="204" fill={`url(#jarvis-command-core-fill-${id})`} />
        <circle className={styles.commandMeshLimb} cx="320" cy="320" r="202" />

        {/* These orbital frames are fixed visual geometry around the core—not
            invented task lanes. The nearby labelled satellites remain the
            truthful representation of workflows, actions and integrations. */}
        <g className={styles.commandMeshOrbitalFrames}>
          <ellipse cx="320" cy="320" rx="270" ry="86" transform="rotate(-19 320 320)" />
          <ellipse cx="320" cy="320" rx="258" ry="104" transform="rotate(28 320 320)" />
          <ellipse cx="320" cy="320" rx="118" ry="268" transform="rotate(12 320 320)" />
          <path d="M53 317C135 267 180 237 244 222" />
          <path d="M588 316C514 271 467 244 405 224" />
          <path d="M107 453C171 443 221 425 267 395" />
          <path d="M533 453C470 443 419 425 372 395" />
        </g>

        <g clipPath={`url(#${clipId})`}>
          <ellipse className={styles.commandMeshAtmosphere} cx="282" cy="258" rx="178" ry="152" transform="rotate(-30 282 258)" />
          <circle className={styles.commandMeshGlass} cx="320" cy="320" r="202" fill={`url(#jarvis-command-core-glass-${id})`} />
          <g className={styles.commandMeshDust}>
            {COMMAND_CORE_DOTS.map((dot, index) => (
              <circle
                key={index}
                cx={dot.x}
                cy={dot.y}
                r={dot.radius}
                opacity={dot.opacity}
                data-accent={dot.accent || undefined}
                data-depth={dot.depth}
              />
            ))}
          </g>
          <g className={styles.commandMeshNetwork}>
            {COMMAND_CORE_NETWORK.links.map((link, index) => (
              <line
                key={`link-${index}`}
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                data-depth={link.depth}
              />
            ))}
            {COMMAND_CORE_NETWORK.nodes.map((node, index) => (
              <circle
                key={`node-${index}`}
                cx={node.x}
                cy={node.y}
                r={node.emphasis ? 2.1 : 1.12}
                data-depth={node.depth}
                data-emphasis={node.emphasis || undefined}
              />
            ))}
          </g>
          <g className={styles.commandMeshTransit}>
            <ellipse cx="320" cy="320" rx="188" ry="64" transform="rotate(-18 320 320)" />
            <ellipse cx="320" cy="320" rx="170" ry="77" transform="rotate(31 320 320)" />
            <ellipse cx="320" cy="320" rx="104" ry="196" transform="rotate(16 320 320)" />
          </g>
          <g className={styles.commandMeshGlobe}>
            <path d="M117 293C189 250 438 247 523 292" />
            <path d="M112 350C202 393 435 394 528 347" />
            <path d="M142 250C229 286 415 281 498 240" />
            <path d="M145 397C235 357 408 363 496 403" />
            <path d="M320 118C239 192 240 450 320 522" />
            <path d="M320 118C400 192 401 450 320 522" />
            <path d="M188 167C246 230 246 423 190 473" />
            <path d="M451 165C391 231 393 424 452 473" />
          </g>
          <g className={styles.commandMeshTopology}>
            {COMMAND_CORE_LINKS.map((link, index) => <path key={index} d={link.d} data-layer={link.layer} />)}
          </g>
          <path className={styles.commandMeshSweep} d="M122 336C216 298 423 299 518 340" stroke={`url(#jarvis-command-core-sweep-${id})`} />
        </g>

        <g className={styles.commandMeshConstellation}>
          <path d="M74 161C137 165 164 205 209 232L266 260" />
          <path d="M566 153C500 165 474 208 424 270" />
          <path d="M62 381C122 370 158 379 236 409" />
          <path d="M579 370C522 362 489 367 458 377" />
          <path d="M149 113C207 155 252 177 282 210" />
          <path d="M491 110C426 155 383 180 344 214" />
        </g>

        <g className={styles.commandMeshExternalNodes} filter={`url(#jarvis-command-core-glow-${id})`}>
          <circle cx="74" cy="161" r="4.4" />
          <circle cx="566" cy="153" r="4.4" />
          <circle cx="62" cy="381" r="4.4" />
          <circle cx="579" cy="370" r="4.4" />
          <circle cx="149" cy="113" r="3.8" />
          <circle cx="491" cy="110" r="3.8" />
        </g>

        <g className={styles.commandMeshNodes} filter={`url(#jarvis-command-core-glow-${id})`}>
          <circle cx="162" cy="312" r="4.2" />
          <circle cx="224" cy="262" r="3.6" />
          <circle cx="293" cy="301" r="4.4" />
          <circle cx="367" cy="246" r="3.8" />
          <circle cx="469" cy="290" r="4.2" />
          <circle cx="151" cy="354" r="3.8" />
          <circle cx="236" cy="409" r="4.4" />
          <circle cx="314" cy="364" r="3.6" />
          <circle cx="401" cy="422" r="4.2" />
          <circle cx="497" cy="343" r="3.8" />
        </g>

        <circle className={styles.commandMeshBoundary} cx="320" cy="320" r="210" />
        <circle className={styles.commandMeshBoundaryInner} cx="320" cy="320" r="176" />

        {runMarks > 0 && (
          <g className={styles.commandMeshRunMarks}>
            {Array.from({ length: runMarks }, (_, index) => {
              const angle = (-90 + index * (360 / runMarks)) * (Math.PI / 180)
              const x = 320 + Math.cos(angle) * 248
              const y = 320 + Math.sin(angle) * 248
              return <circle key={index} cx={x} cy={y} r="5" />
            })}
          </g>
        )}

        <g className={styles.commandMeshReticle}>
          <path d="M268 293H290M350 293H372M268 347H290M350 347H372" />
          <path d="M293 268V290M347 268V290M293 350V372M347 350V372" />
          <circle cx="320" cy="320" r="48" />
          <circle cx="320" cy="320" r="3.5" />
        </g>
      </svg>

      <span className={styles.commandCoreCopy} data-jarvis-orb-command-copy>
        <span className={styles.commandCoreCopyKicker}>FINNOR · ORCHESTRATION ENGINE</span>
        <span className={styles.commandCoreCopyName}>JARVIS</span>
        <span className={styles.commandCoreCopyState}>{COMMAND_STATE_LABEL[visualState]}</span>
        {runMarks > 0 ? <span className={styles.commandCoreCopyRuns}>{runMarks} active run{runMarks === 1 ? "" : "s"}</span> : null}
      </span>
    </div>
  )
}

export function JarvisAmbientOrb({
  visualState,
  energy = 0.24,
  voiceEnergy = 0,
  activeRunCount = 0,
  reducedMotion = false,
  lowPower = false,
  onActivate,
  className,
}: JarvisAmbientOrbProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef({ visualState, energy, voiceEnergy, activeRunCount })
  const [mounted, setMounted] = useState(false)
  const [deviceLowPower, setDeviceLowPower] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)

  liveRef.current = { visualState, energy, voiceEnergy, activeRunCount }

  const profile = STATE_PROFILE[visualState]
  const safeEnergy = clampUnit(energy, 0.24)
  const safeVoiceEnergy = visualState === "listening" ? clampUnit(voiceEnergy) : 0
  const safeRunCount = visualState === "executing" ? finiteRunCount(activeRunCount) : 0
  const staticMode = !mounted || reducedMotion || lowPower || deviceLowPower || webglFailed
  const hostStyle = {
    "--orb-rgb": asRgb(profile.color),
    "--orb-accent-rgb": asRgb(profile.accent),
    "--orb-energy": String(0.42 + safeEnergy * 0.58),
    "--orb-voice": String(safeVoiceEnergy),
  } as CSSProperties

  useEffect(() => {
    setMounted(true)
    setDeviceLowPower(isLowPowerDevice())
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || staticMode) return

    let cancelled = false
    let cleanup: (() => void) | undefined

    void import("three").then((THREE) => {
      if (cancelled) return

      let disposed = false
      let raf = 0
      let frameQueued = false
      let active = false

      const rect = host.getBoundingClientRect()
      active = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100)
      camera.position.z = 4.45

      let renderer: THREE.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        })
      } catch {
        setWebglFailed(true)
        return
      }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.className = styles.canvas
    host.appendChild(renderer.domElement)

    const particleGeometry = buildParticleGeometry(THREE)
    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: safeEnergy },
        uVoiceEnergy: { value: safeVoiceEnergy },
        uPointerActive: { value: 0 },
        uState: { value: profile.index },
        uSpeed: { value: profile.speed },
        uActiveRuns: { value: safeRunCount },
        uPointer: { value: new THREE.Vector2(2, 2) },
        uColor: { value: new THREE.Color(...profile.color) },
        uAccent: { value: new THREE.Color(...profile.accent) },
        uOpacity: { value: profile.opacity },
      },
    })
    const points = new THREE.Points(particleGeometry, material)
    scene.add(points)

    const ringGroup = new THREE.Group()
    const ringSpecs: Array<[number, number, number]> = [
      [1.72, 0.54, 0.04],
      [1.84, 0.96, -0.08],
      [1.98, 1.34, -0.16],
    ]
    const ringLines = ringSpecs.map(([radiusX, radiusY, depth]) => {
      const line = new THREE.LineLoop(
        buildRingGeometry(THREE, radiusX, radiusY, depth),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(...profile.color),
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      )
      ringGroup.add(line)
      return line
    })
    scene.add(ringGroup)

    const laneGeometry = new THREE.SphereGeometry(0.045, 8, 8)
    const laneMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(...profile.accent),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const laneDots = Array.from({ length: MAX_RUN_MARKS }, () => {
      const dot = new THREE.Mesh(laneGeometry, laneMaterial)
      dot.visible = false
      scene.add(dot)
      return dot
    })

    const pointerTarget = new THREE.Vector2(2, 2)
    const pointerCurrent = new THREE.Vector2(2, 2)
    let pointerTargetActive = 0
    let pointerCurrentActive = 0
    let tiltTargetX = 0
    let tiltTargetY = 0
    let tiltX = 0
    let tiltY = 0
    let lastState = visualState
    let lastTime = 0

    const resize = () => {
      const width = host.clientWidth || 320
      const height = host.clientHeight || 320
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()

    const setPointer = (clientX: number, clientY: number) => {
      const bounds = host.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const x = ((clientX - bounds.left) / bounds.width) * 2 - 1
      const y = -(((clientY - bounds.top) / bounds.height) * 2 - 1)
      pointerTarget.set(x, y)
      pointerTargetActive = 1
      tiltTargetX = -y * 0.16
      tiltTargetY = x * 0.2
    }
    const clearPointer = () => {
      pointerTarget.set(2, 2)
      pointerTargetActive = 0
      tiltTargetX = 0
      tiltTargetY = 0
    }
    const onPointerMove = (event: PointerEvent) => setPointer(event.clientX, event.clientY)
    const onPointerDown = (event: PointerEvent) => setPointer(event.clientX, event.clientY)
    host.addEventListener("pointermove", onPointerMove)
    host.addEventListener("pointerdown", onPointerDown)
    host.addEventListener("pointerleave", clearPointer)
    host.addEventListener("pointercancel", clearPointer)

    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => {
          active = entry?.isIntersecting ?? false
          if (!active) {
            cancelAnimationFrame(raf)
            frameQueued = false
          } else if (!frameQueued && document.visibilityState !== "hidden") {
            frameQueued = true
            raf = requestAnimationFrame(renderFrame)
          }
        }, { threshold: 0.04 })
      : null
    observer?.observe(host)

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(resize)
      : null
    resizeObserver?.observe(host)
    window.addEventListener("resize", resize)

    const colorCurrent = new THREE.Color(...profile.color)
    const accentCurrent = new THREE.Color(...profile.accent)
    const targetColor = new THREE.Color(...profile.color)
    const targetAccent = new THREE.Color(...profile.accent)
    const pointerUniform = material.uniforms.uPointer.value as THREE.Vector2

    const renderFrame = (timestamp: number) => {
      frameQueued = false
      if (disposed || !active || document.visibilityState === "hidden") return

      const elapsed = timestamp / 1000
      const live = liveRef.current
      const currentProfile = STATE_PROFILE[live.visualState]
      const currentEnergy = clampUnit(live.energy, 0.24)
      const currentVoiceEnergy = live.visualState === "listening" ? clampUnit(live.voiceEnergy) : 0
      const currentRunCount = live.visualState === "executing" ? finiteRunCount(live.activeRunCount) : 0

      if (lastState !== live.visualState) {
        lastState = live.visualState
        lastTime = elapsed
      }
      const delta = Math.min(0.08, Math.max(0.001, elapsed - lastTime || 0.016))
      lastTime = elapsed

      targetColor.setRGB(...currentProfile.color)
      targetAccent.setRGB(...currentProfile.accent)
      colorCurrent.lerp(targetColor, Math.min(1, delta * 5.5))
      accentCurrent.lerp(targetAccent, Math.min(1, delta * 5.5))
      material.uniforms.uTime.value = elapsed
      material.uniforms.uEnergy.value += (currentEnergy - material.uniforms.uEnergy.value) * Math.min(1, delta * 5)
      material.uniforms.uVoiceEnergy.value += (currentVoiceEnergy - material.uniforms.uVoiceEnergy.value) * Math.min(1, delta * 8)
      material.uniforms.uState.value = currentProfile.index
      material.uniforms.uSpeed.value = currentProfile.speed
      material.uniforms.uActiveRuns.value = currentRunCount
      material.uniforms.uOpacity.value += (currentProfile.opacity - material.uniforms.uOpacity.value) * Math.min(1, delta * 5)
      material.uniforms.uColor.value.copy(colorCurrent)
      material.uniforms.uAccent.value.copy(accentCurrent)

      pointerCurrent.lerp(pointerTarget, Math.min(1, delta * 8))
      pointerCurrentActive += (pointerTargetActive - pointerCurrentActive) * Math.min(1, delta * 7)
      pointerUniform.copy(pointerCurrent)
      material.uniforms.uPointerActive.value = pointerCurrentActive
      tiltX += (tiltTargetX - tiltX) * Math.min(1, delta * 5)
      tiltY += (tiltTargetY - tiltY) * Math.min(1, delta * 5)

      const stateSpin = currentProfile.speed * 0.08
      points.rotation.x = tiltX + Math.sin(elapsed * 0.13) * 0.035
      points.rotation.y += stateSpin * delta + tiltY * 0.008
      points.rotation.z = tiltY * 0.22

      ringGroup.rotation.x += (tiltX * 0.32 - ringGroup.rotation.x) * Math.min(1, delta * 4)
      ringGroup.rotation.y += stateSpin * delta * 0.8 + (tiltY * 0.18 - ringGroup.rotation.y) * Math.min(1, delta * 4)
      ringGroup.rotation.z = Math.sin(elapsed * (0.12 + currentProfile.speed * 0.2)) * 0.035

      ringLines.forEach((line, index) => {
        const lineMaterial = line.material as THREE.LineBasicMaterial
        lineMaterial.color.copy(index === 0 ? colorCurrent : accentCurrent)
        lineMaterial.opacity = currentProfile.ringOpacity[index] * (0.72 + currentEnergy * 0.28)
        line.rotation.x = Math.sin(elapsed * (0.13 + index * 0.04) + index) * (0.11 + index * 0.05)
        line.rotation.y = Math.cos(elapsed * (0.1 + index * 0.03) + index * 1.7) * (0.14 + index * 0.04)
        line.visible = currentProfile.ringOpacity[index] > 0
      })

      const laneMaterialCurrent = laneMaterial
      laneMaterialCurrent.color.copy(accentCurrent)
      const shownRuns = currentRunCount
      laneDots.forEach((dot, index) => {
        const shown = live.visualState === "executing" && index < shownRuns
        dot.visible = shown
        if (!shown) return
        const radius = 1.92 + (index % 3) * 0.13
        const laneSpeed = 0.45 + hash(index * 3.7) * 0.38
        const phase = elapsed * laneSpeed + index * 1.47
        dot.position.set(
          Math.cos(phase) * radius,
          Math.sin(phase * 0.72 + index) * (0.38 + index * 0.02),
          Math.sin(phase) * radius,
        )
        laneMaterialCurrent.opacity = 0.5 + currentEnergy * 0.4
      })

      renderer.render(scene, camera)
      if (!disposed && active) {
        frameQueued = true
        raf = requestAnimationFrame(renderFrame)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf)
        frameQueued = false
      } else if (active && !frameQueued) {
        frameQueued = true
        raf = requestAnimationFrame(renderFrame)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    if (active && document.visibilityState !== "hidden") {
      frameQueued = true
      raf = requestAnimationFrame(renderFrame)
    }

    cleanup = () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", resize)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      host.removeEventListener("pointermove", onPointerMove)
      host.removeEventListener("pointerdown", onPointerDown)
      host.removeEventListener("pointerleave", clearPointer)
      host.removeEventListener("pointercancel", clearPointer)
      particleGeometry.dispose()
      material.dispose()
      ringLines.forEach((line) => {
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
      })
      laneGeometry.dispose()
      laneMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
    }).catch(() => {
      if (!cancelled) setWebglFailed(true)
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
    // The render loop reads live props through liveRef; rebuilding a GPU scene for
    // every energy or state update would create visible gaps and waste resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticMode])

  const classes = [styles.orb, className].filter(Boolean).join(" ")
  const interactive = typeof onActivate === "function"

  return (
    <div
      ref={hostRef}
      className={classes}
      data-jarvis-ambient-orb
      data-jarvis-orb-state={visualState}
      data-orb-renderer={staticMode ? "static" : "webgl"}
      data-orb-energy={safeEnergy}
      data-orb-voice-energy={safeVoiceEnergy}
      style={hostStyle}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`JARVIS ambient orb — ${STATE_LABEL[visualState]}`}
      onClick={interactive ? onActivate : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onActivate?.()
        }
      } : undefined}
    >
      <span className={styles.field} aria-hidden>
        <span className={styles.fieldDust} />
        <span className={styles.fieldBloom} />
        <span className={styles.horizon} />
      </span>
      <span className={styles.halo} aria-hidden />
      <span className={styles.core} aria-hidden />
      {staticMode && (
        <span className={styles.fallback} aria-hidden>
          <span className={styles.fallbackShell} />
          <span className={styles.fallbackArc} />
          <span className={styles.fallbackArcSecondary} />
        </span>
      )}
      <span className={styles.decorations} aria-hidden>
        <span className={`${styles.orbit} ${styles.orbitPrimary}`} />
        <span className={`${styles.orbit} ${styles.orbitSecondary}`} />
        <span className={`${styles.orbit} ${styles.orbitTertiary}`} />
        <span className={`${styles.facet} ${styles.facetPrimary}`} />
        <span className={`${styles.facet} ${styles.facetSecondary}`} />
        <span className={styles.reviewSeam} />
        <span className={`${styles.fracture} ${styles.fractureOne}`} />
        <span className={`${styles.fracture} ${styles.fractureTwo}`} />
        <span className={`${styles.lane} ${styles.laneOne}`} />
        <span className={`${styles.lane} ${styles.laneTwo}`} />
        <span className={styles.staleSlash} />
      </span>
      <span className={styles.runMarks} aria-hidden>
        {Array.from({ length: safeRunCount }, (_, index) => (
          <span key={index} style={{ "--run-index": index } as CSSProperties} />
        ))}
      </span>
      <CommandCoreOverlay visualState={visualState} activeRunCount={safeRunCount} />
    </div>
  )
}
