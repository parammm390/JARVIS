"use client"

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react"
import * as THREE from "three"
import styles from "./JarvisImmersiveOrb.module.css"

/** Keep the visual contract local to the renderer; the visualizer never owns application state. */
export type JarvisOrbVisualState =
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

export interface JarvisImmersiveOrbProps {
  visualState: JarvisOrbVisualState
  energy: number
  voiceEnergy: number
  activeRunCount: number
  expanded: boolean
  reducedMotion: boolean
  lowPower: boolean
  onRequestClose?: () => void
  className?: string
}

type StateMeta = {
  label: string
  detail: string
  busy: boolean
}

type StateConfig = StateMeta & {
  accent: number
  accent2: number
  speed: number
  mode: number
}

const VISUAL_STATES: readonly JarvisOrbVisualState[] = [
  "idle",
  "listening",
  "acknowledged",
  "thinking",
  "answer-ready",
  "proposal-ready",
  "deferred",
  "needs-human-review",
  "executing",
  "verifying",
  "failed",
  "cancelled-stale",
]

const STATE_CONFIG: Record<JarvisOrbVisualState, StateConfig> = {
  idle: { label: "standby", detail: "presence online", busy: false, accent: 0x65e7ff, accent2: 0x616bff, speed: 0.14, mode: 0 },
  listening: { label: "listening", detail: "voice channel open", busy: true, accent: 0x47f1d0, accent2: 0x44d8ff, speed: 0.38, mode: 1 },
  acknowledged: { label: "acknowledged", detail: "instruction received", busy: false, accent: 0xc9fbff, accent2: 0x4de2ff, speed: 0.7, mode: 2 },
  thinking: { label: "planning", detail: "assembling a path", busy: true, accent: 0xb58cff, accent2: 0x6358ff, speed: 0.92, mode: 3 },
  "answer-ready": { label: "answer ready", detail: "resolved signal", busy: false, accent: 0xd8ffff, accent2: 0x71d9ff, speed: 0.18, mode: 4 },
  "proposal-ready": { label: "approval required", detail: "proposed action held", busy: false, accent: 0xffc768, accent2: 0xff9b3d, speed: 0.26, mode: 5 },
  deferred: { label: "deferred", detail: "held for a later window", busy: false, accent: 0xe7ad59, accent2: 0x916b4d, speed: 0.08, mode: 6 },
  "needs-human-review": { label: "human review", detail: "decision split and held", busy: false, accent: 0xffd277, accent2: 0xff82b6, speed: 0.12, mode: 7 },
  executing: { label: "executing", detail: "active run in progress", busy: true, accent: 0x55dfff, accent2: 0x557aff, speed: 0.72, mode: 8 },
  verifying: { label: "verifying", detail: "checking the outcome", busy: true, accent: 0xbfffd6, accent2: 0x43df91, speed: 0.84, mode: 9 },
  failed: { label: "failed", detail: "fracture detected", busy: false, accent: 0xff7180, accent2: 0xffb15e, speed: 0.48, mode: 10 },
  "cancelled-stale": { label: "cancelled / stale", detail: "signal interrupted", busy: false, accent: 0xaab4c8, accent2: 0x586174, speed: 0.04, mode: 11 },
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const clamp = (value: number, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

const normaliseRunCount = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(6, Math.floor(value)))
}

const seededValue = (index: number, salt = 0) => {
  const value = Math.sin((index + 1) * (12.9898 + salt * 78.233)) * 43758.5453
  return value - Math.floor(value)
}

const isVisualState = (value: string): value is JarvisOrbVisualState => VISUAL_STATES.includes(value as JarvisOrbVisualState)

function createFieldGeometry(count: number, radius: number, layer: number) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const sizes = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0 : index / (count - 1)
    const y = 1 - progress * 2
    const radial = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = GOLDEN_ANGLE * index + layer * 0.73
    const volume = Math.pow(0.12 + seededValue(index, layer + 1) * 0.88, 1 / 3)
    const distance = radius * volume
    positions[index * 3] = Math.cos(theta) * radial * distance
    positions[index * 3 + 1] = y * distance
    positions[index * 3 + 2] = Math.sin(theta) * radial * distance
    seeds[index] = seededValue(index * 3 + 9, layer + 2)
    sizes[index] = (0.55 + seeds[index] * 1.45) * (layer === 0 ? 0.92 : 1.25)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
  return geometry
}

function createCoreGeometry(count = 720) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const sizes = new Float32Array(count)
  const bands = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0 : index / (count - 1)
    const y = 1 - progress * 2
    const radial = Math.sqrt(Math.max(0, 1 - y * y))
    const seed = seededValue(index * 2 + 17, 4)
    const theta = GOLDEN_ANGLE * index + seededValue(index, 6) * 0.44
    const radius = 0.16 + Math.pow(0.12 + seed * 0.88, 0.62) * 0.9
    const skew = 0.86 + seededValue(index + 31, 2) * 0.3
    positions[index * 3] = Math.cos(theta) * radial * radius * skew + 0.05
    positions[index * 3 + 1] = y * radius * (1.02 + seed * 0.12) + 0.04
    positions[index * 3 + 2] = Math.sin(theta) * radial * radius * 0.76 + Math.sin(theta * 0.7) * 0.07
    seeds[index] = seed
    sizes[index] = 0.82 + seed * 1.85
    bands[index] = Math.max(0, Math.min(1, 0.22 + radius * 0.9 + seededValue(index + 73, 3) * 0.22))
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute("aBand", new THREE.BufferAttribute(bands, 1))
  return geometry
}

const fieldVertexShader = `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uVoiceEnergy;
  uniform float uPointerNear;
  uniform float uPressure;
  uniform float uStateSpeed;
  uniform float uLayer;
  uniform vec2 uPointer;
  attribute float aSeed;
  attribute float aSize;
  varying float vHeat;
  varying float vLayer;

  void main() {
    vec3 p = position;
    vec3 normal = normalize(position);
    float pulse = sin(uTime * uStateSpeed * (0.65 + aSeed * 1.3) + aSeed * 37.0 + position.y * 2.7);
    float field = smoothstep(1.55, 0.0, distance(p.xy, uPointer * 1.3)) * uPointerNear;
    float amplitude = 0.014 + uEnergy * 0.045 + uVoiceEnergy * 0.025;
    p += normal * (pulse * amplitude + field * (0.085 + uPressure * 0.16));
    p.xy += uPointer * field * (0.035 + uPressure * 0.04);
    p.z += field * (0.08 + uLayer * 0.08);

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vHeat = clamp(field * 0.9 + abs(pulse) * 0.14 + uEnergy * 0.12, 0.0, 1.0);
    vLayer = uLayer;
    gl_PointSize = aSize * (8.2 / max(0.8, -mvPosition.z)) * (0.62 + uEnergy * 0.48 + field * 0.92);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fieldFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uOpacity;
  varying float vHeat;
  varying float vLayer;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5) discard;
    float softness = smoothstep(0.5, 0.03, distanceToCenter);
    vec3 color = mix(uColor, uColor2, clamp(vHeat * 0.9 + vLayer * 0.14, 0.0, 1.0));
    float alpha = softness * uOpacity * (0.11 + vHeat * 0.38 + vLayer * 0.07);
    gl_FragColor = vec4(color, alpha);
  }
`

const coreVertexShader = `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uVoiceEnergy;
  uniform float uPointerNear;
  uniform float uPressure;
  uniform float uStateSpeed;
  uniform float uStateMode;
  uniform vec2 uPointer;
  attribute float aSeed;
  attribute float aSize;
  attribute float aBand;
  varying float vPulse;
  varying float vField;
  varying float vBand;

  void main() {
    vec3 displaced = position;
    vec3 direction = normalize(position + vec3(0.01, 0.02, 0.03));
    float modeWave = sin(dot(position, vec3(5.1 + uStateMode * 0.12, 3.7, 6.2)) + uTime * (0.2 + uStateSpeed) + aSeed * 18.0);
    float localField = smoothstep(1.02, 0.0, distance(position.xy, uPointer * 0.72)) * uPointerNear;
    displaced += direction * (modeWave * (0.012 + uEnergy * 0.04 + uVoiceEnergy * 0.02) + localField * (0.08 + uPressure * 0.16));
    displaced.xy += uPointer * localField * (0.05 + uPressure * 0.06);
    displaced.z += localField * (0.08 + uPressure * 0.12);
    vPulse = modeWave * 0.5 + 0.5;
    vField = localField;
    vBand = aBand;
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_PointSize = aSize * (14.5 / max(0.8, -mvPosition.z)) * (0.56 + uEnergy * 0.46 + localField * 1.28);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const coreFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uEnergy;
  uniform float uStateMode;
  varying float vPulse;
  varying float vField;
  varying float vBand;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5) discard;
    float softness = smoothstep(0.5, 0.04, distanceToCenter);
    float lattice = smoothstep(0.58, 0.94, sin(vBand * 16.0 + vPulse * 4.0 + uStateMode * 0.4) * 0.5 + 0.5);
    float materialLight = clamp(vBand * 0.56 + vPulse * 0.18 + vField * 0.64, 0.0, 1.0);
    vec3 shadow = vec3(0.032, 0.072, 0.12);
    vec3 material = vec3(0.105, 0.22, 0.3);
    vec3 color = mix(shadow, material, materialLight);
    color += mix(uColor2 * 0.24, uColor * 0.42, vField * 0.8 + vPulse * 0.14) * (0.28 + lattice * 0.42);
    float alpha = softness * (0.28 + vBand * 0.24 + lattice * 0.2 + vField * 0.42 + uEnergy * 0.08);
    gl_FragColor = vec4(color, alpha);
  }
`

type FieldMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: THREE.IUniform<number>
    uEnergy: THREE.IUniform<number>
    uVoiceEnergy: THREE.IUniform<number>
    uPointerNear: THREE.IUniform<number>
    uPressure: THREE.IUniform<number>
    uStateSpeed: THREE.IUniform<number>
    uLayer: THREE.IUniform<number>
    uPointer: THREE.IUniform<THREE.Vector2>
    uColor: THREE.IUniform<THREE.Color>
    uColor2: THREE.IUniform<THREE.Color>
    uOpacity: THREE.IUniform<number>
  }
}

type CoreMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: THREE.IUniform<number>
    uEnergy: THREE.IUniform<number>
    uVoiceEnergy: THREE.IUniform<number>
    uPointerNear: THREE.IUniform<number>
    uPressure: THREE.IUniform<number>
    uStateSpeed: THREE.IUniform<number>
    uStateMode: THREE.IUniform<number>
    uPointer: THREE.IUniform<THREE.Vector2>
    uColor: THREE.IUniform<THREE.Color>
    uColor2: THREE.IUniform<THREE.Color>
  }
}

function createFieldMaterial(layer: number): FieldMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fieldVertexShader,
    fragmentShader: fieldFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0.2 },
      uVoiceEnergy: { value: 0 },
      uPointerNear: { value: 0 },
      uPressure: { value: 0 },
      uStateSpeed: { value: 0.14 },
      uLayer: { value: layer },
      uPointer: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(0x65e7ff) },
      uColor2: { value: new THREE.Color(0x616bff) },
      uOpacity: { value: layer === 0 ? 0.58 : layer === 2 ? 0.72 : 0.82 },
    },
  }) as FieldMaterial
}

function createCoreMaterial(): CoreMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: coreVertexShader,
    fragmentShader: coreFragmentShader,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0.2 },
      uVoiceEnergy: { value: 0 },
      uPointerNear: { value: 0 },
      uPressure: { value: 0 },
      uStateSpeed: { value: 0.14 },
      uStateMode: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(0x65e7ff) },
      uColor2: { value: new THREE.Color(0x616bff) },
    },
  }) as CoreMaterial
}

function addLine(group: THREE.Group, points: THREE.Vector3[], color: number, opacity: number, userData?: Record<string, unknown>) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.72, depthWrite: false, blending: THREE.AdditiveBlending })
  const line = new THREE.Line(geometry, material)
  if (userData) Object.assign(line.userData, userData)
  group.add(line)
  return line
}

function addSpark(group: THREE.Group, position: THREE.Vector3, color: number, size: number, userData?: Record<string, unknown>) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([position.x, position.y, position.z], 3))
  const material = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.68, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
  const spark = new THREE.Points(geometry, material)
  if (userData) Object.assign(spark.userData, userData)
  group.add(spark)
  return spark
}

function trajectory(radius: number, yScale: number, zScale: number, phase: number, count = 72) {
  return Array.from({ length: count }, (_, index) => {
    const t = (index / (count - 1)) * Math.PI * 2
    return new THREE.Vector3(
      Math.cos(t + phase) * radius,
      Math.sin(t + phase) * radius * yScale,
      Math.sin(t * 2 + phase) * zScale + Math.cos(t + phase) * 0.08,
    )
  })
}

function createCoreFibers() {
  const group = new THREE.Group()
  for (let fiber = 0; fiber < 5; fiber += 1) {
    const phase = fiber * 1.23 + 0.3
    const points = Array.from({ length: 34 }, (_, index) => {
      const progress = index / 33
      const angle = phase + progress * (1.05 + fiber * 0.12)
      const radius = 0.08 + progress * 0.66
      return new THREE.Vector3(
        Math.cos(angle) * radius * (0.86 + fiber * 0.025),
        Math.sin(angle) * radius * 0.66 + 0.04,
        (progress - 0.5) * 0.58 + Math.sin(angle * 1.7) * 0.09,
      )
    })
    addLine(group, points, fiber % 2 ? 0x5d78b8 : 0x559eb5, fiber === 2 ? 0.34 : 0.2, { coreFiber: fiber })
  }
  return group
}

function inwardSpiral(turns: number, outer: number, inner: number, phase: number) {
  return Array.from({ length: 90 }, (_, index) => {
    const progress = index / 89
    const angle = phase + progress * Math.PI * 2 * turns
    const radius = outer + (inner - outer) * progress
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72, (progress - 0.5) * 0.45)
  })
}

function radialRay(angle: number, radius: number, z: number) {
  return [new THREE.Vector3(0, 0, z), new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z + Math.sin(angle * 2) * 0.12)]
}

function brokenPath(start: THREE.Vector3, end: THREE.Vector3, gaps: number, pieces: number) {
  const result: THREE.Vector3[] = []
  for (let index = 0; index < pieces; index += 1) {
    const left = index / pieces
    const right = (index + 1) / pieces
    if (index % gaps === gaps - 1) continue
    result.push(start.clone().lerp(end, left), start.clone().lerp(end, right))
  }
  return result
}

function createStateGroup(state: JarvisOrbVisualState): THREE.Group {
  const group = new THREE.Group()
  const config = STATE_CONFIG[state]
  group.userData.state = state

  switch (state) {
    case "idle": {
      addLine(group, trajectory(1.57, 0.24, 0.14, 0.18, 42).slice(5, 31), config.accent, 0.25, { trajectory: 0 })
      addSpark(group, new THREE.Vector3(0.9, 0.26, 0.22), config.accent, 0.045)
      break
    }
    case "listening": {
      addLine(group, trajectory(1.48, 0.18, 0.08, 0), config.accent, 0.52, { wave: 0 })
      addLine(group, trajectory(1.3, 0.3, 0.1, 0.7), config.accent2, 0.34, { wave: 1 })
      addLine(group, trajectory(1.08, 0.44, 0.12, -0.4), config.accent, 0.25, { wave: 2 })
      break
    }
    case "acknowledged": {
      for (let index = 0; index < 8; index += 1) {
        addLine(group, radialRay((index / 8) * Math.PI * 2, 1.48, 0.22), index % 2 ? config.accent2 : config.accent, 0.48, { lockRay: index })
      }
      addSpark(group, new THREE.Vector3(0, 0, 0.42), config.accent, 0.08)
      break
    }
    case "thinking": {
      addLine(group, inwardSpiral(1.45, 1.58, 0.18, 0), config.accent, 0.58, { spiral: 0 })
      addLine(group, inwardSpiral(1.14, 1.42, 0.12, Math.PI), config.accent2, 0.44, { spiral: 1 })
      addLine(group, inwardSpiral(0.8, 1.24, 0.08, Math.PI * 0.45), config.accent, 0.26, { spiral: 2 })
      break
    }
    case "answer-ready": {
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2 + Math.PI / 6
        addLine(group, radialRay(angle, 1.7, 0.18), index % 2 ? config.accent2 : config.accent, index % 2 ? 0.22 : 0.42, { answerRay: index })
      }
      addLine(group, [new THREE.Vector3(-1.34, 0, 0.28), new THREE.Vector3(1.34, 0, 0.28)], config.accent, 0.5, { answerAxis: 0 })
      addLine(group, [new THREE.Vector3(0, -1.34, 0.28), new THREE.Vector3(0, 1.34, 0.28)], config.accent2, 0.22, { answerAxis: 1 })
      break
    }
    case "proposal-ready": {
      const points = [
        new THREE.Vector3(-0.88, -0.72, 0.34), new THREE.Vector3(-0.42, -0.96, 0.34),
        new THREE.Vector3(0.42, -0.96, 0.34), new THREE.Vector3(0.88, -0.72, 0.34),
        new THREE.Vector3(0.88, 0.72, 0.34), new THREE.Vector3(0.42, 0.96, 0.34),
        new THREE.Vector3(-0.42, 0.96, 0.34), new THREE.Vector3(-0.88, 0.72, 0.34),
      ]
      addLine(group, [points[0], points[1]], config.accent, 0.7, { aperture: 0 })
      addLine(group, [points[2], points[3]], config.accent, 0.7, { aperture: 1 })
      addLine(group, [points[4], points[5]], config.accent, 0.7, { aperture: 2 })
      addLine(group, [points[6], points[7]], config.accent, 0.7, { aperture: 3 })
      addLine(group, [new THREE.Vector3(-0.42, -0.96, 0.34), new THREE.Vector3(0.42, -0.96, 0.34)], config.accent2, 0.22, { shelf: 0 })
      addSpark(group, new THREE.Vector3(0, 0, 0.46), config.accent, 0.075)
      break
    }
    case "deferred": {
      addLine(group, [new THREE.Vector3(-1.48, -0.18, 0.38), new THREE.Vector3(1.48, -0.18, 0.38)], config.accent, 0.5, { shelf: 0 })
      addLine(group, [new THREE.Vector3(-1.1, -0.18, 0.38), new THREE.Vector3(-1.1, -0.18, -0.02)], config.accent2, 0.28, { shelf: 1 })
      addLine(group, [new THREE.Vector3(1.1, -0.18, 0.38), new THREE.Vector3(1.1, -0.18, -0.02)], config.accent2, 0.28, { shelf: 2 })
      addLine(group, [new THREE.Vector3(-0.7, -0.2, 0.45), new THREE.Vector3(0.7, -0.2, 0.45)], config.accent, 0.16, { shelf: 3 })
      addSpark(group, new THREE.Vector3(0, -0.17, 0.5), config.accent, 0.07, { held: true })
      break
    }
    case "needs-human-review": {
      const left = [new THREE.Vector3(-1.5, 0.45, 0.22), new THREE.Vector3(-0.95, 0.28, 0.46), new THREE.Vector3(-0.3, 0.05, 0.5)]
      const right = [new THREE.Vector3(1.5, -0.42, 0.22), new THREE.Vector3(0.95, -0.25, 0.46), new THREE.Vector3(0.3, -0.03, 0.5)]
      addLine(group, left, config.accent, 0.68, { tension: "left" })
      addLine(group, right, config.accent2, 0.68, { tension: "right" })
      addLine(group, [new THREE.Vector3(-0.08, -0.5, 0.45), new THREE.Vector3(0.08, 0.5, 0.45)], config.accent, 0.38, { decisionBreak: true })
      addSpark(group, new THREE.Vector3(-1.5, 0.45, 0.22), config.accent, 0.06)
      addSpark(group, new THREE.Vector3(1.5, -0.42, 0.22), config.accent2, 0.06)
      break
    }
    case "executing": {
      for (let lane = 0; lane < 6; lane += 1) {
        const angle = -0.82 + lane * 0.33
        const laneGroup = new THREE.Group()
        laneGroup.userData.laneIndex = lane
        const inner = new THREE.Vector3(Math.cos(angle) * 0.36, Math.sin(angle) * 0.36, 0.52)
        const outer = new THREE.Vector3(Math.cos(angle) * (1.65 + (lane % 2) * 0.12), Math.sin(angle) * (1.65 + (lane % 2) * 0.12), 0.08 + lane * 0.025)
        addLine(laneGroup, [inner, outer], lane % 2 ? config.accent2 : config.accent, lane % 2 ? 0.32 : 0.56, { runLane: lane })
        addSpark(laneGroup, outer, lane % 2 ? config.accent2 : config.accent, 0.052, { runParticle: lane })
        group.add(laneGroup)
      }
      addLine(group, trajectory(1.42, 0.12, 0.04, 0.4), config.accent, 0.18, { executionTrace: true })
      break
    }
    case "verifying": {
      for (let index = 0; index < 4; index += 1) {
        const y = -0.72 + index * 0.48
        addLine(group, [new THREE.Vector3(-1.48, y, 0.48), new THREE.Vector3(1.48, y, 0.48)], index % 2 ? config.accent2 : config.accent, index === 1 ? 0.62 : 0.22, { scanLine: index })
      }
      addLine(group, [new THREE.Vector3(-0.3, -0.18, 0.52), new THREE.Vector3(0.3, 0.18, 0.52)], config.accent, 0.4, { check: 0 })
      addLine(group, [new THREE.Vector3(0.3, 0.18, 0.52), new THREE.Vector3(0.72, -0.28, 0.52)], config.accent, 0.4, { check: 1 })
      break
    }
    case "failed": {
      const shards = [
        [new THREE.Vector3(-1.32, 0.74, 0.36), new THREE.Vector3(-0.24, 0.1, 0.54)],
        [new THREE.Vector3(-0.08, 0.12, 0.54), new THREE.Vector3(1.26, -0.72, 0.36)],
        [new THREE.Vector3(-1.12, -0.64, 0.42), new THREE.Vector3(-0.18, -0.05, 0.56)],
        [new THREE.Vector3(0.08, 0.02, 0.56), new THREE.Vector3(1.12, 0.66, 0.42)],
        [new THREE.Vector3(-0.84, 0.9, 0.32), new THREE.Vector3(0.58, -0.86, 0.34)],
      ]
      shards.forEach(([start, end], index) => addLine(group, brokenPath(start, end, 4, 7), index % 2 ? config.accent2 : config.accent, index === 4 ? 0.28 : 0.62, { fracture: index }))
      addSpark(group, new THREE.Vector3(0, 0, 0.64), config.accent2, 0.08, { recovery: true })
      break
    }
    case "cancelled-stale": {
      addLine(group, brokenPath(new THREE.Vector3(-1.42, 0.78, 0.28), new THREE.Vector3(1.42, -0.78, 0.28), 3, 9), config.accent, 0.38, { staleSlash: true })
      addLine(group, brokenPath(new THREE.Vector3(-1.32, -0.22, 0.24), new THREE.Vector3(1.32, -0.22, 0.24), 2, 8), config.accent2, 0.24, { staleAxis: true })
      addSpark(group, new THREE.Vector3(-0.8, 0.34, 0.38), config.accent, 0.04, { stale: true })
      break
    }
  }

  group.visible = false
  return group
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const renderObject = object as THREE.Mesh & THREE.Line & THREE.Points & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
    renderObject.geometry?.dispose()
    if (Array.isArray(renderObject.material)) renderObject.material.forEach((material) => material.dispose())
    else renderObject.material?.dispose()
  })
}

function animateStateGroup(group: THREE.Group, state: JarvisOrbVisualState, elapsed: number, runCount: number) {
  const pulse = Math.sin(elapsed * 1.4) * 0.5 + 0.5
  switch (state) {
    case "idle":
      group.rotation.z = elapsed * 0.035
      group.rotation.x = Math.sin(elapsed * 0.16) * 0.04
      group.scale.setScalar(0.98 + pulse * 0.025)
      break
    case "listening":
      group.rotation.y = elapsed * 0.12
      group.scale.setScalar(0.98 + pulse * 0.045)
      group.children.forEach((child, index) => { child.scale.setScalar(0.92 + ((pulse + index * 0.17) % 1) * 0.1) })
      break
    case "acknowledged":
      group.scale.setScalar(0.92 + pulse * 0.05)
      group.rotation.z = elapsed * 0.2
      break
    case "thinking":
      group.rotation.z = -elapsed * 0.3
      group.rotation.y = elapsed * 0.18
      group.scale.setScalar(0.94 + pulse * 0.04)
      break
    case "answer-ready":
      group.rotation.y = Math.sin(elapsed * 0.15) * 0.04
      group.scale.setScalar(1.0 + pulse * 0.025)
      break
    case "proposal-ready":
      group.rotation.z = Math.sin(elapsed * 0.28) * 0.025
      group.scale.setScalar(0.98 + pulse * 0.02)
      break
    case "deferred":
      group.position.y = -0.08 + Math.sin(elapsed * 0.25) * 0.025
      group.scale.setScalar(0.98 + pulse * 0.012)
      break
    case "needs-human-review":
      group.rotation.y = Math.sin(elapsed * 0.18) * 0.04
      group.children.forEach((child) => {
        if (child.userData.tension === "left") child.position.x = -pulse * 0.045
        if (child.userData.tension === "right") child.position.x = pulse * 0.045
      })
      break
    case "executing":
      group.rotation.z = elapsed * 0.16
      group.children.forEach((child) => {
        const laneIndex = child.userData.laneIndex
        if (typeof laneIndex === "number") {
          child.visible = laneIndex < runCount
          child.rotation.z = Math.sin(elapsed * 0.6 + laneIndex) * 0.06
        }
      })
      break
    case "verifying":
      group.position.y = -0.55 + ((elapsed * 0.45) % 1.1)
      group.scale.setScalar(0.98 + pulse * 0.02)
      break
    case "failed":
      group.rotation.z = Math.sin(elapsed * 5.2) * 0.018
      group.position.x = Math.sin(elapsed * 4.1) * 0.014
      break
    case "cancelled-stale":
      group.rotation.z = -0.08 + Math.sin(elapsed * 0.12) * 0.012
      group.scale.setScalar(0.96 + pulse * 0.01)
      break
  }
}

export function JarvisImmersiveOrb({
  visualState,
  energy,
  voiceEnergy,
  activeRunCount,
  expanded,
  reducedMotion,
  lowPower,
  onRequestClose,
  className,
}: JarvisImmersiveOrbProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const pointerTargetRef = useRef({ x: 0, y: 0, near: 0, pressure: 0 })
  const latestRef = useRef({ state: "idle" as JarvisOrbVisualState, energy: 0.2, voiceEnergy: 0, runCount: 0 })
  const [visible, setVisible] = useState(true)
  const [webglReady, setWebglReady] = useState(false)
  const [pointerVisual, setPointerVisual] = useState({ x: 0, y: 0, near: 0, pressure: 0 })

  const state = isVisualState(visualState) ? visualState : "idle"
  const meta = STATE_CONFIG[state]
  const energyLevel = clamp(energy, 0.2)
  const voiceLevel = clamp(voiceEnergy)
  const runCount = normaliseRunCount(activeRunCount)
  latestRef.current = { state, energy: energyLevel, voiceEnergy: voiceLevel, runCount }

  useEffect(() => {
    const host = hostRef.current
    if (!host || reducedMotion || lowPower || typeof window === "undefined" || typeof document === "undefined") {
      setWebglReady(false)
      return
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" })
    } catch {
      setWebglReady(false)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.className = styles.canvas
    renderer.domElement.setAttribute("aria-hidden", "true")
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20)
    camera.position.set(0, 0, 5.4)
    camera.lookAt(0, 0, 0)

    const chamber = new THREE.Group()
    scene.add(chamber)

    const backFieldMaterial = createFieldMaterial(0)
    const midFieldMaterial = createFieldMaterial(2)
    const nearFieldMaterial = createFieldMaterial(1)
    const backField = new THREE.Points(createFieldGeometry(2300, 1.72, 0), backFieldMaterial)
    const midField = new THREE.Points(createFieldGeometry(1200, 1.5, 2), midFieldMaterial)
    const nearField = new THREE.Points(createFieldGeometry(920, 1.24, 1), nearFieldMaterial)
    backField.position.z = -0.5
    midField.position.z = -0.18
    nearField.position.z = 0.26
    backField.renderOrder = 0
    midField.renderOrder = 1
    nearField.renderOrder = 4.4
    chamber.add(backField, midField, nearField)

    const outerRig = new THREE.Group()
    outerRig.position.z = 0.18
    const stateGroups = new Map<JarvisOrbVisualState, THREE.Group>()
    VISUAL_STATES.forEach((candidate) => {
      const group = createStateGroup(candidate)
      stateGroups.set(candidate, group)
      outerRig.add(group)
    })
    chamber.add(outerRig)

    const coreRig = new THREE.Group()
    coreRig.position.z = 0.42
    const coreMaterial = createCoreMaterial()
    const coreField = new THREE.Points(createCoreGeometry(), coreMaterial)
    coreField.renderOrder = 3
    const coreFiberRig = createCoreFibers()
    coreFiberRig.position.set(-0.04, 0.03, 0.16)
    coreFiberRig.renderOrder = 3.4
    const occlusionMaterial = new THREE.MeshBasicMaterial({ color: 0x071321, transparent: true, opacity: 0.28, side: THREE.BackSide, depthWrite: false })
    const occlusionWing = new THREE.Mesh(new THREE.SphereGeometry(0.92, 32, 22, -Math.PI * 0.5, Math.PI * 0.7, Math.PI * 0.2, Math.PI * 0.56), occlusionMaterial)
    occlusionWing.position.set(-0.24, 0.02, -0.08)
    occlusionWing.scale.set(1.04, 0.94, 0.8)
    occlusionWing.renderOrder = 2.2
    const seedMaterial = new THREE.MeshBasicMaterial({ color: 0x83c6d6, transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending })
    const seedGeometry = new THREE.OctahedronGeometry(0.2, 1)
    const seed = new THREE.Mesh(seedGeometry, seedMaterial)
    seed.position.set(0.18, 0.12, 0.34)
    seed.scale.set(1.05, 0.76, 1.22)
    seed.renderOrder = 5
    const seedEdgeSource = new THREE.OctahedronGeometry(0.27, 1)
    const seedEdgeGeometry = new THREE.EdgesGeometry(seedEdgeSource)
    seedEdgeSource.dispose()
    const seedEdges = new THREE.LineSegments(seedEdgeGeometry, new THREE.LineBasicMaterial({ color: 0x75b5c9, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending }))
    seedEdges.position.copy(seed.position)
    seedEdges.scale.copy(seed.scale)
    seedEdges.renderOrder = 5.2
    coreRig.add(occlusionWing, coreField, coreFiberRig, seed, seedEdges)
    chamber.add(coreRig)

    let fieldTime = 0
    let fieldFrame = 0
    let disposed = false
    let documentVisible = document.visibilityState !== "hidden"
    let intersectionVisible = true
    let currentPointer = { x: 0, y: 0, near: 0, pressure: 0 }
    const targetColor = new THREE.Color()
    const targetColor2 = new THREE.Color()
    const targetFiberColor = new THREE.Color(0x559eb5)
    const cameraTarget = new THREE.Vector3()

    const resize = () => {
      const width = Math.max(1, host.clientWidth || 420)
      const height = Math.max(1, host.clientHeight || width)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener("resize", resize)

    const isRenderable = () => intersectionVisible && documentVisible && !disposed
    const stop = () => {
      if (!fieldFrame) return
      window.cancelAnimationFrame(fieldFrame)
      fieldFrame = 0
    }

    const update = (time: number) => {
      fieldFrame = 0
      if (!isRenderable()) return

      const snapshot = latestRef.current
      const config = STATE_CONFIG[snapshot.state]
      const elapsed = time / 1000
      fieldTime = elapsed
      const target = pointerTargetRef.current
      currentPointer = {
        x: currentPointer.x + (target.x - currentPointer.x) * 0.12,
        y: currentPointer.y + (target.y - currentPointer.y) * 0.12,
        near: currentPointer.near + (target.near - currentPointer.near) * 0.12,
        pressure: currentPointer.pressure + (target.pressure - currentPointer.pressure) * 0.15,
      }

      const fieldMaterials = [backFieldMaterial, midFieldMaterial, nearFieldMaterial]
      fieldMaterials.forEach((material) => {
        material.uniforms.uTime.value = fieldTime
        material.uniforms.uEnergy.value = snapshot.energy
        material.uniforms.uVoiceEnergy.value = snapshot.voiceEnergy
        material.uniforms.uPointerNear.value = currentPointer.near
        material.uniforms.uPressure.value = currentPointer.pressure
        material.uniforms.uStateSpeed.value = config.speed
        material.uniforms.uPointer.value.set(currentPointer.x, currentPointer.y)
        targetColor.setHex(config.accent)
        targetColor2.setHex(config.accent2)
        material.uniforms.uColor.value.lerp(targetColor, 0.12)
        material.uniforms.uColor2.value.lerp(targetColor2, 0.12)
      })

      coreMaterial.uniforms.uTime.value = fieldTime
      coreMaterial.uniforms.uEnergy.value = snapshot.energy
      coreMaterial.uniforms.uVoiceEnergy.value = snapshot.voiceEnergy
      coreMaterial.uniforms.uPointerNear.value = currentPointer.near
      coreMaterial.uniforms.uPressure.value = currentPointer.pressure
      coreMaterial.uniforms.uStateSpeed.value = config.speed
      coreMaterial.uniforms.uStateMode.value = config.mode
      coreMaterial.uniforms.uPointer.value.set(currentPointer.x, currentPointer.y)
      targetColor.setHex(config.accent)
      targetColor2.setHex(config.accent2)
      coreMaterial.uniforms.uColor.value.lerp(targetColor, 0.16)
      coreMaterial.uniforms.uColor2.value.lerp(targetColor2, 0.16)

      targetFiberColor.copy(targetColor2).lerp(targetColor, 0.28)
      coreFiberRig.children.forEach((child) => {
        const material = child instanceof THREE.Line ? child.material : undefined
        if (!material) return
        material.color.lerp(targetFiberColor, 0.12)
        material.opacity = 0.12 + currentPointer.near * 0.2 + snapshot.energy * 0.06
      })
      occlusionMaterial.opacity = 0.18 + currentPointer.near * 0.14
      seedMaterial.color.lerp(targetColor, 0.12)
      seedMaterial.opacity = 0.38 + currentPointer.near * 0.26 + currentPointer.pressure * 0.18
      backField.rotation.y = elapsed * 0.008
      midField.rotation.z = elapsed * 0.012
      nearField.rotation.x = elapsed * -0.018

      chamber.rotation.x += (currentPointer.y * -0.12 - chamber.rotation.x) * 0.08
      chamber.rotation.y += (currentPointer.x * 0.16 - chamber.rotation.y) * 0.08
      chamber.position.x += (currentPointer.x * 0.07 - chamber.position.x) * 0.08
      chamber.position.y += (currentPointer.y * -0.07 - chamber.position.y) * 0.08
      coreRig.scale.setScalar(1 + currentPointer.near * 0.035 + currentPointer.pressure * 0.045)
      coreRig.rotation.x += (currentPointer.y * -0.09 - coreRig.rotation.x) * 0.1
      coreRig.rotation.y += (currentPointer.x * 0.12 - coreRig.rotation.y) * 0.1
      coreField.rotation.z = elapsed * (0.012 + config.speed * 0.018)
      coreFiberRig.rotation.x += (currentPointer.y * -0.2 - coreFiberRig.rotation.x) * 0.1
      coreFiberRig.rotation.y += (currentPointer.x * 0.25 - coreFiberRig.rotation.y) * 0.1
      coreFiberRig.position.x += (currentPointer.x * 0.05 - coreFiberRig.position.x) * 0.1
      coreFiberRig.position.y += (currentPointer.y * -0.04 - coreFiberRig.position.y) * 0.1
      occlusionWing.rotation.y = currentPointer.x * 0.2 + elapsed * 0.012
      occlusionWing.rotation.x = currentPointer.y * -0.14
      occlusionWing.position.x = -0.24 + currentPointer.x * 0.07
      occlusionWing.position.y = 0.02 - currentPointer.y * 0.05
      seed.position.x = 0.18 + currentPointer.x * (0.1 + currentPointer.near * 0.12)
      seed.position.y = 0.12 - currentPointer.y * (0.08 + currentPointer.near * 0.1)
      seed.position.z = 0.34 + currentPointer.near * 0.14 + currentPointer.pressure * 0.08
      seed.rotation.x = elapsed * 0.14 + currentPointer.y * 0.26
      seed.rotation.y = -elapsed * 0.18 + currentPointer.x * 0.32
      seed.scale.set(1.05 + currentPointer.near * 0.14, 0.76 + currentPointer.pressure * 0.1, 1.22 + currentPointer.near * 0.08)
      seedEdges.position.copy(seed.position)
      seedEdges.rotation.copy(seed.rotation)
      seedEdges.scale.copy(seed.scale)

      stateGroups.forEach((group, candidate) => { group.visible = candidate === snapshot.state })
      const activeGroup = stateGroups.get(snapshot.state)
      if (activeGroup) animateStateGroup(activeGroup, snapshot.state, elapsed, snapshot.runCount)
      outerRig.rotation.x += (currentPointer.y * -0.18 - outerRig.rotation.x) * 0.09
      outerRig.rotation.y += (currentPointer.x * 0.22 - outerRig.rotation.y) * 0.09
      outerRig.position.x += (currentPointer.x * 0.045 - outerRig.position.x) * 0.09
      outerRig.position.y += (currentPointer.y * -0.04 - outerRig.position.y) * 0.09

      cameraTarget.set(currentPointer.x * 0.035, currentPointer.y * -0.035, 5.4)
      camera.position.lerp(cameraTarget, 0.06)
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
      fieldFrame = window.requestAnimationFrame(update)
    }

    const start = () => {
      if (isRenderable() && !fieldFrame) fieldFrame = window.requestAnimationFrame(update)
    }
    const updateDocumentVisibility = () => {
      documentVisible = document.visibilityState !== "hidden"
      setVisible(documentVisible && intersectionVisible)
      if (documentVisible) start()
      else stop()
    }
    const observer = "IntersectionObserver" in window ? new IntersectionObserver(([entry]) => {
      intersectionVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0)
      setVisible(documentVisible && intersectionVisible)
      if (intersectionVisible) start()
      else stop()
    }, { threshold: [0, 0.02] }) : undefined
    observer?.observe(host)
    document.addEventListener("visibilitychange", updateDocumentVisibility)
    setWebglReady(true)
    start()

    return () => {
      disposed = true
      stop()
      observer?.disconnect()
      document.removeEventListener("visibilitychange", updateDocumentVisibility)
      window.removeEventListener("resize", resize)
      disposeScene(scene)
      renderer.dispose()
      renderer.forceContextLoss?.()
      renderer.domElement.remove()
      setWebglReady(false)
    }
  }, [lowPower, reducedMotion])

  useEffect(() => {
    if (!expanded || !onRequestClose || typeof document === "undefined") return
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onRequestClose()
    }
    document.addEventListener("keydown", onEscape)
    return () => document.removeEventListener("keydown", onEscape)
  }, [expanded, onRequestClose])

  const updatePointer = (event: ReactPointerEvent<HTMLElement>, pressure: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1))
    const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
    const near = Math.max(0, 1 - Math.min(1, Math.hypot(x, y) / 1.08))
    const next = { x, y, near, pressure }
    pointerTargetRef.current = next
    setPointerVisual(next)
  }

  const releasePointer = () => {
    const next = { ...pointerTargetRef.current, pressure: 0 }
    pointerTargetRef.current = next
    setPointerVisual(next)
  }

  const resetPointer = () => {
    const next = { x: 0, y: 0, near: 0, pressure: 0 }
    pointerTargetRef.current = next
    setPointerVisual(next)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !expanded || !onRequestClose) return
    event.preventDefault()
    event.stopPropagation()
    onRequestClose()
  }

  const handleClose = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRequestClose?.()
  }

  const style = {
    "--pointer-x": pointerVisual.x.toFixed(3),
    "--pointer-y": pointerVisual.y.toFixed(3),
    "--pointer-near": pointerVisual.near.toFixed(3),
    "--pointer-pressure": pointerVisual.pressure.toFixed(3),
  } as CSSProperties

  return (
    <section
      ref={hostRef}
      className={[styles.orb, styles[`state-${state}`], expanded ? styles.expanded : styles.ambient, className].filter(Boolean).join(" ")}
      style={style}
      role="group"
      aria-label={`JARVIS ${meta.label}`}
      aria-busy={meta.busy || undefined}
      data-jarvis-immersive-orb="true"
      data-jarvis-orb-state={state}
      data-orb-expanded={expanded ? "true" : "false"}
      data-orb-paused={!visible || reducedMotion || lowPower ? "true" : "false"}
      data-orb-renderer={webglReady ? "three" : "fallback"}
      onPointerMove={(event) => updatePointer(event, event.pointerType === "touch" ? 0.72 : 0.28)}
      onPointerDown={(event) => updatePointer(event, 1)}
      onPointerUp={releasePointer}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
      onKeyDown={handleKeyDown}
    >
      <span className={styles.srOnly}>JARVIS state: {meta.label}. {meta.detail}.</span>
      <div className={[styles.fallback, webglReady ? styles.fallbackHidden : ""].filter(Boolean).join(" ")} aria-hidden="true">
        <span className={styles.fallbackField} />
        <span className={styles.fallbackCore} />
        <span className={styles.fallbackTrace} />
      </div>
      {expanded && (
        <div className={styles.readout} aria-hidden="true">
          <span className={styles.readoutEyebrow}>JARVIS / IMMERSIVE</span>
          <strong>{meta.label}</strong>
          <span>{meta.detail}</span>
        </div>
      )}
      {expanded && onRequestClose && (
        <button type="button" className={styles.close} onClick={handleClose} aria-label="Close immersive JARVIS orb">
          <span aria-hidden="true">×</span>
          <span>Close</span>
        </button>
      )}
    </section>
  )
}

export default JarvisImmersiveOrb
