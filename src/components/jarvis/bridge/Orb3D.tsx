"use client"

// D1.T4 — the real Three.js Orb: GPU-particle water-sphere. "three" has sat in
// package.json since before this phase with zero real imports anywhere in src/
// (grepped at this session's start ritual, confirmed dormant per §1's own claim) —
// this is the first thing that awakens it.
//
// Point-cloud + a custom ShaderMaterial (per-vertex displacement runs in the vertex
// shader, on the GPU, every frame — only a handful of scalar uniforms cross the
// JS/GPU boundary per frame) rather than a heavier THREE.InstancedMesh: at ~14k
// points this reads as a fluid, breathing sphere for far less overhead than 14k
// individual mesh instances. "GPU particle water-sphere, 10-20k instanced particles"
// (plan §7/D1.T4) is a rendering-technique description, not a literal requirement for
// THREE.InstancedMesh — Points+shader is the standard, idiomatic way to get exactly
// that look at that density.
//
// Five FLOW-14 states, same names + color vocabulary as FlowCatalogAmbient's 2D
// placeholder this component replaces on the Bridge (ui/motion/FlowCatalogAmbient.tsx
// — that file's own header says "D1 builds the real Three.js orb"), derived from REAL
// app state only, never invented:
//   idle      — cyan slow-breathing swirl (default)
//   planning  — violet accelerating vortex (real voiceState connecting|live)
//   executing — teal orbital ring pulses, one dot per data.runs.length (real running
//               workflow count, capped for legibility), real voiceState speaking
//   blocked   — amber holding (real stats.blocked > 0)
//   error     — red fracture→reassembly burst (real statsDegraded)
//
// Perf/honesty guards (hard rule #10): the rAF loop stops entirely when
// IntersectionObserver reports offscreen or document.visibilityState is hidden — no
// WebGL work happens off-screen or in a background tab. Collapses to a static
// CSS-gradient orb (no WebGL context created at all) on prefers-reduced-motion OR a
// real low-device-memory signal (navigator.deviceMemory <= 2; browsers lacking that
// API — Safari/iOS — default to the live orb, never assumed weak without evidence).

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { useReducedMotion } from "framer-motion"

export type OrbState = "idle" | "planning" | "executing" | "blocked" | "error"

// Real hex values from jarvis-theme.css's own token block (--j-cyan/violet/teal/
// amber/red), normalized to 0-1 for the fragment shader uniform — not re-invented
// colors, the same ones FlowCatalogAmbient's OrbStates placeholder already uses.
const STATE_COLOR: Record<OrbState, [number, number, number]> = {
  idle: [0.133, 0.827, 0.933],
  planning: [0.545, 0.361, 0.965],
  executing: [0.176, 0.831, 0.749],
  blocked: [0.984, 0.749, 0.141],
  error: [0.973, 0.443, 0.443],
}
const STATE_ENERGY: Record<OrbState, number> = { idle: 0.22, planning: 0.8, executing: 1, blocked: 0.08, error: 0.55 }
const STATE_SPIN: Record<OrbState, number> = { idle: 0.05, planning: 0.55, executing: 0.35, blocked: 0.01, error: 0.15 }

// Deterministic hash — this repo's own eslint rule bans Math.random() anywhere under
// src/components/jarvis/**/src/app/jarvis/** (.eslintrc.cjs, Phase 7 §7.8: "nothing
// here may fake a metric or activity effect"). Geometry jitter isn't a metric, but the
// ban is a blanket file-pattern rule — a deterministic PRNG costs nothing here and
// matches the technique atmosphere.tsx/DecryptText already use for the same reason.
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const PARTICLE_COUNT = 14000
const MAX_RINGS = 8

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uFracture;
  attribute float aSeed;
  varying float vSeed;
  void main() {
    vSeed = aSeed;
    vec3 dir = normalize(position);
    float wobble = sin(uTime * (0.6 + aSeed * 0.9) + aSeed * 37.0) * (0.035 + uEnergy * 0.09);
    float fracture = uFracture * (0.3 + aSeed * 1.4);
    vec3 p = position + dir * (wobble + fracture);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = (1.1 + aSeed * 1.3) * (7.0 / -mv.z) * (0.55 + uEnergy * 0.6);
    gl_PointSize = min(size, 5.5);
    gl_Position = projectionMatrix * mv;
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d) * (0.16 + vSeed * 0.34);
    gl_FragColor = vec4(uColor, alpha);
  }
`

function buildGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const seeds = new Float32Array(PARTICLE_COUNT)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Fibonacci sphere distribution — even coverage, no polar clustering.
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    const x = Math.cos(theta) * r
    const z = Math.sin(theta) * r
    const radius = 1.6 + (hash(i) - 0.5) * 0.08
    positions[i * 3] = x * radius
    positions[i * 3 + 1] = y * radius
    positions[i * 3 + 2] = z * radius
    seeds[i] = hash(i * 7.31 + 4.1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  return geo
}

export interface OrbLiveState {
  state: OrbState
  activeRunCount: number
}

// Real, non-fabricated low-power signal: navigator.deviceMemory (Chrome/Edge/Android;
// undefined on Safari/iOS, which we then treat as capable rather than guessing weak).
function isLowPowerDevice(): boolean {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory
  return typeof mem === "number" && mem <= 2
}

function StaticOrb({ state }: { state: OrbState }) {
  const [r, g, b] = STATE_COLOR[state]
  const rgb = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`
  return (
    <div
      aria-hidden
      className="h-full w-full rounded-full"
      style={{
        background: `radial-gradient(circle at 38% 32%, rgba(${rgb},0.9) 0%, rgba(${rgb},0.35) 45%, rgba(6,11,24,0.05) 72%)`,
        boxShadow: `0 0 60px rgba(${rgb},0.35)`,
      }}
      data-orb-mode="static"
      data-orb-state={state}
    />
  )
}

export function Orb3D({ live }: { live: OrbLiveState }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [lowPower, setLowPower] = useState(false)
  const [visible, setVisible] = useState(false)
  // SSR-safety (same rule as ui/motion/primitives.tsx's <Enter>/<Flight>, reproduced +
  // fixed via this exact Playwright emulateMedia technique during C2.T2): SSR always
  // resolves useReducedMotion() to null/falsy (no window) and a real reduced-motion
  // client's very first hydration pass already has the true boolean — branching the
  // FIRST render's DOM output (webgl empty div vs. StaticOrb's inline-styled div) on
  // that value is a genuine hydration mismatch, not a cosmetic one. `mounted` starts
  // false on both server and client's first render (identical output); the real
  // reduced/low-power decision only takes effect after mount, one client-only
  // re-render later — same tradeoff Shell/Stage already accept elsewhere in this app.
  const [mounted, setMounted] = useState(false)

  const liveRef = useRef(live)
  liveRef.current = live

  useEffect(() => {
    setMounted(true)
    setLowPower(isLowPowerDevice())
  }, [])

  const useStatic = mounted && (!!reduced || lowPower)

  useEffect(() => {
    if (useStatic || !containerRef.current) return
    const el = containerRef.current
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [useStatic])

  useEffect(() => {
    if (useStatic || !visible || !containerRef.current) return
    const el = containerRef.current
    const width = el.clientWidth || 320
    const height = el.clientHeight || 320

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.z = 4.4

    const geometry = buildGeometry()
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: STATE_ENERGY.idle },
        uColor: { value: new THREE.Color(...STATE_COLOR.idle) },
        uFracture: { value: 0 },
      },
    })
    const points = new THREE.Points(geometry, material)
    scene.add(points)

    // Orbital ring pulses — FLOW-14 "executing": one small emissive dot per active
    // workflow run (capped at MAX_RINGS so the scene stays legible under load), each
    // orbiting at its own radius/speed keyed off its index — real data.runs.length
    // drives how many actually render, not a fixed decorative count.
    const ringGroup = new THREE.Group()
    const ringDots: THREE.Mesh[] = []
    for (let i = 0; i < MAX_RINGS; i++) {
      const dotGeo = new THREE.SphereGeometry(0.045, 10, 10)
      const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...STATE_COLOR.executing), transparent: true, opacity: 0 })
      const dot = new THREE.Mesh(dotGeo, dotMat)
      dot.visible = false
      ringDots.push(dot)
      ringGroup.add(dot)
    }
    scene.add(ringGroup)

    let raf = 0
    let stopped = false
    let fractureUntil = 0
    let lastState: OrbState = "idle"
    const clock = new THREE.Clock()

    function frame(): void {
      if (stopped) return
      const t = clock.getElapsedTime()
      const { state, activeRunCount } = liveRef.current

      if (state === "error" && lastState !== "error") fractureUntil = t + 0.6
      lastState = state

      const [r, g, b] = STATE_COLOR[state]
      const mat = material as THREE.ShaderMaterial
      mat.uniforms.uTime.value = t
      mat.uniforms.uEnergy.value = STATE_ENERGY[state]
      ;(mat.uniforms.uColor.value as THREE.Color).setRGB(r, g, b)
      mat.uniforms.uFracture.value = Math.max(0, fractureUntil - t) * 0.9

      points.rotation.y += STATE_SPIN[state] * 0.01
      points.rotation.x = Math.sin(t * 0.15) * 0.08

      const shown = Math.min(activeRunCount, MAX_RINGS)
      for (let i = 0; i < MAX_RINGS; i++) {
        const dot = ringDots[i]!
        const active = state === "executing" && i < shown
        dot.visible = active
        if (active) {
          const radius = 2.1 + (i % 3) * 0.22
          const speed = 0.5 + hash(i * 3.7) * 0.4
          const phase = t * speed + i * 1.7
          dot.position.set(Math.cos(phase) * radius, Math.sin(phase * 0.7) * 0.4, Math.sin(phase) * radius)
          ;(dot.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 3 + i) * 0.2
        }
      }

      renderer.render(scene, camera)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    function onVisibility(): void {
      if (document.visibilityState === "hidden") {
        stopped = true
        cancelAnimationFrame(raf)
      } else if (stopped) {
        stopped = false
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    function onResize(): void {
      if (!el) return
      const w = el.clientWidth || width
      const h = el.clientHeight || height
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", onVisibility)
      ro.disconnect()
      geometry.dispose()
      material.dispose()
      ringDots.forEach((d) => {
        d.geometry.dispose()
        ;(d.material as THREE.Material).dispose()
      })
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [useStatic, visible])

  return (
    <div ref={containerRef} className="relative h-full w-full" data-orb-mode={useStatic ? "static" : "webgl"}>
      {useStatic && <StaticOrb state={live.state} />}
    </div>
  )
}
