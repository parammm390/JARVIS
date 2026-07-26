"use client"

// A marketing-only interactive particle sphere. This is NOT a wrapper around the
// shared src/components/jarvis/bridge/Orb3D.tsx — that component is read-only/shared
// per JARVIS-MARKETING-MAESTRO-PLAN.md §6 (it's the same component the authenticated
// Bridge and Showtime use) and has no hook for cursor interaction, no exposed ref, and
// a closed-over render loop — there's no way to layer live mouse-reactivity onto it
// without editing the shared file, which is out of bounds. This component mirrors its
// visual language on purpose (same Fibonacci-sphere particle field, the same
// jarvis-theme.css-derived state colors/energy/spin vocabulary, the same additive-
// blended soft-circle point shader) so it reads as the same material — but every line
// here is independently owned so a genuine, GPU-driven cursor interaction can exist.
//
// The interaction itself: every particle's screen-space (NDC) distance to the live
// cursor position is computed in the vertex shader every frame (cheap — no raycasting,
// no per-frame CPU loop over 14k points). Particles within the influence radius are
// pushed outward along the sphere's radial direction, grow, and brighten toward white
// — like a hand disturbing a water surface. Ambient idle/planning/executing motion
// (mirroring Orb3D's real FLOW-14 vocabulary) keeps running underneath at all times,
// so the sphere is never static even when nothing is being touched.
import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { useReducedMotion } from "framer-motion"

type OrbState = "idle" | "planning" | "executing"

// Real hex values from jarvis-theme.css's own --j-cyan/--j-violet/--j-teal tokens,
// normalized to 0-1 — the same values Orb3D's STATE_COLOR uses, not re-invented.
const STATE_COLOR: Record<OrbState, [number, number, number]> = {
  idle: [0.133, 0.827, 0.933],
  planning: [0.545, 0.361, 0.965],
  executing: [0.176, 0.831, 0.749],
}
const STATE_ENERGY: Record<OrbState, number> = { idle: 0.22, planning: 0.8, executing: 1 }
const STATE_SPIN: Record<OrbState, number> = { idle: 0.05, planning: 0.55, executing: 0.35 }

const SCRIPT: Array<{ state: OrbState; holdMs: number }> = [
  { state: "idle", holdMs: 3200 },
  { state: "planning", holdMs: 2400 },
  { state: "executing", holdMs: 3400 },
]

// Deterministic hash — this repo's eslint rule bans Math.random() under jarvis scope;
// this file isn't under that path, but the same discipline applies to any jitter here
// (matches Orb3D/atmosphere.tsx's own technique).
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const PARTICLE_COUNT = 14000

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform vec2 uMouseNDC;
  uniform float uMouseActive;
  attribute float aSeed;
  varying float vSeed;
  varying float vInfluence;
  void main() {
    vSeed = aSeed;
    vec3 dir = normalize(position);
    float wobble = sin(uTime * (0.6 + aSeed * 0.9) + aSeed * 37.0) * (0.035 + uEnergy * 0.09);
    vec3 p = position + dir * wobble;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 ndc = clip.xy / clip.w;
    float distToMouse = length(ndc - uMouseNDC);
    float influence = smoothstep(0.42, 0.0, distToMouse) * uMouseActive;
    vInfluence = influence;

    vec3 pushed = p + dir * influence * 0.55;
    vec4 mvFinal = modelViewMatrix * vec4(pushed, 1.0);
    float size = (1.1 + aSeed * 1.3) * (7.0 / -mvFinal.z) * (0.55 + uEnergy * 0.6);
    gl_PointSize = min(size * (1.0 + influence * 2.4), 11.0);
    gl_Position = projectionMatrix * mvFinal;
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vSeed;
  varying float vInfluence;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d) * (0.2 + vSeed * 0.34 + vInfluence * 0.5);
    vec3 color = mix(uColor, vec3(1.0), vInfluence * 0.92);
    gl_FragColor = vec4(color, alpha);
  }
`

function buildGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const seeds = new Float32Array(PARTICLE_COUNT)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < PARTICLE_COUNT; i++) {
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

export function MarketingOrb({ className = "h-[440px] w-[440px]" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [lowPower, setLowPower] = useState(false)
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [scriptIndex, setScriptIndex] = useState(0)

  const stateRef = useRef<OrbState>("idle")
  const currentState = SCRIPT[scriptIndex]!.state
  stateRef.current = currentState

  useEffect(() => {
    setMounted(true)
    setLowPower(isLowPowerDevice())
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setScriptIndex((i) => (i + 1) % SCRIPT.length), SCRIPT[scriptIndex]!.holdMs)
    return () => clearTimeout(timer)
  }, [scriptIndex])

  // Same SSR-hydration-safety convention Orb3D itself uses: `mounted` starts false on
  // both server and client's first render (identical output), the reduced/low-power
  // branch only takes effect one client-only re-render later.
  const useStatic = mounted && (!!reduced || lowPower)

  useEffect(() => {
    if (useStatic || !containerRef.current) return
    const el = containerRef.current
    // Seed synchronously from a direct measurement rather than waiting on
    // IntersectionObserver's first (async, spec-unscheduled-timing) callback —
    // observed unreliable/delayed in at least one real environment. The observer
    // below still owns all subsequent pause/resume behavior on scroll.
    const rect = el.getBoundingClientRect()
    const initiallyVisible = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
    setVisible(initiallyVisible)
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [useStatic])

  useEffect(() => {
    if (useStatic || !visible || !containerRef.current) return
    console.log("[orb-debug] building renderer now")
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
        uMouseNDC: { value: new THREE.Vector2(2, 2) },
        uMouseActive: { value: 0 },
      },
    })
    const points = new THREE.Points(geometry, material)
    scene.add(points)

    // Screen-space (NDC) mouse tracking, updated on pointer events only — no per-frame
    // getBoundingClientRect() calls, and no raycasting against 14k points. `active`
    // eases toward 1 on movement/enter and back toward 0 on leave, so the influence
    // fades smoothly rather than snapping off.
    const mouseNDC = new THREE.Vector2(2, 2)
    let targetActive = 0
    let active = 0

    function setMouseFromClient(clientX: number, clientY: number) {
      const rect = el.getBoundingClientRect()
      mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.y = -(((clientY - rect.top) / rect.height) * 2 - 1)
      targetActive = 1
    }
    function onPointerMove(e: PointerEvent) {
      setMouseFromClient(e.clientX, e.clientY)
    }
    function onPointerLeave() {
      targetActive = 0
    }
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerleave", onPointerLeave)
    el.addEventListener("pointercancel", onPointerLeave)

    let raf = 0
    let stopped = false
    const clock = new THREE.Clock()

    function frame(): void {
      if (stopped) return
      const t = clock.getElapsedTime()
      const state = stateRef.current

      active += (targetActive - active) * 0.08
      const mat = material as THREE.ShaderMaterial
      mat.uniforms.uTime.value = t
      mat.uniforms.uEnergy.value = STATE_ENERGY[state]
      ;(mat.uniforms.uColor.value as THREE.Color).setRGB(...STATE_COLOR[state])
      ;(mat.uniforms.uMouseNDC.value as THREE.Vector2).copy(mouseNDC)
      mat.uniforms.uMouseActive.value = active

      points.rotation.y += STATE_SPIN[state] * 0.01
      points.rotation.x = Math.sin(t * 0.15) * 0.08

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
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerleave", onPointerLeave)
      el.removeEventListener("pointercancel", onPointerLeave)
      ro.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [useStatic, visible])

  return (
    <div
      ref={containerRef}
      className={className}
      data-cursor="invert"
      data-orb-mode={useStatic ? "static" : "webgl"}
    >
      {useStatic && <StaticOrb state={currentState} />}
    </div>
  )
}
