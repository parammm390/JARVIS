"use client"

import { useEffect, useRef } from "react"

type ThreeModule = typeof import("three")

export default function HeroWaveformCanvas() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) {
      mount.style.opacity = "0.24"
      return
    }

    let destroyed = false
    let raf = 0
    let resizeObserver: ResizeObserver | null = null
    let onScroll: (() => void) | null = null
    let onVisibilityChange: (() => void) | null = null
    let cleanupThree: (() => void) | null = null

    async function boot() {
      let THREE: ThreeModule
      try {
        THREE = await import("three")
      } catch {
        return
      }
      if (destroyed || !mountRef.current) return

      const host = mountRef.current
      const mobile = window.matchMedia("(max-width: 767px)").matches
      const particleCount = mobile ? 320 : 820
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 120)
      camera.position.set(0, 0, 32)

      let renderer: InstanceType<ThreeModule["WebGLRenderer"]>
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        })
      } catch {
        host.style.opacity = "0.24"
        return
      }
      renderer.setClearColor(0x000000, 0)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(width, height)
      renderer.domElement.setAttribute("aria-hidden", "true")
      renderer.domElement.style.pointerEvents = "none"
      renderer.domElement.style.position = "absolute"
      renderer.domElement.style.inset = "0"
      renderer.domElement.style.width = "100%"
      renderer.domElement.style.height = "100%"
      host.appendChild(renderer.domElement)

      const positions = new Float32Array(particleCount * 3)
      const colors = new Float32Array(particleCount * 3)
      const phases = new Float32Array(particleCount)
      const lanes = new Float32Array(particleCount)
      const spreadX = mobile ? 28 : 46
      const spreadY = mobile ? 7 : 10

      for (let i = 0; i < particleCount; i++) {
        const t = i / particleCount
        const lane = (Math.random() - 0.5) * spreadY
        const x = (t - 0.5) * spreadX + (Math.random() - 0.5) * 0.7
        const z = (Math.random() - 0.5) * 7
        const base = i * 3
        lanes[i] = lane
        phases[i] = Math.random() * Math.PI * 2
        positions[base] = x
        positions[base + 1] = lane
        positions[base + 2] = z
        colors[base] = 0.64
        colors[base + 1] = 0.93
        colors[base + 2] = 1
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))

      const material = new THREE.PointsMaterial({
        size: mobile ? 0.055 : 0.07,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
      })

      const points = new THREE.Points(geometry, material)
      points.rotation.x = -0.28
      scene.add(points)

      const linePositions = new Float32Array((particleCount - 1) * 6)
      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3))
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x9eefff,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
      })
      const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial)
      lineMesh.rotation.x = points.rotation.x
      scene.add(lineMesh)

      const setSize = () => {
        const nextWidth = Math.max(host.clientWidth, 1)
        const nextHeight = Math.max(host.clientHeight, 1)
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setSize(nextWidth, nextHeight)
      }

      resizeObserver = new ResizeObserver(setSize)
      resizeObserver.observe(host)

      const updateOpacity = () => {
        const fade = Math.max(0, Math.min(1, 1 - window.scrollY / 620))
        host.style.opacity = `${0.72 * fade}`
      }
      onScroll = () => requestAnimationFrame(updateOpacity)
      window.addEventListener("scroll", onScroll, { passive: true })
      updateOpacity()

      const render = (time: number) => {
        if (destroyed || document.hidden) return
        const seconds = time * 0.001
        const pos = geometry.getAttribute("position") as { needsUpdate: boolean }
        const linePos = lineGeometry.getAttribute("position") as { needsUpdate: boolean }

        for (let i = 0; i < particleCount; i++) {
          const base = i * 3
          const x = positions[base]
          const lane = lanes[i]
          const phase = phases[i]
          const wave =
            Math.sin(x * 0.58 + seconds * 1.2 + phase) * 1.45 +
            Math.sin(x * 0.18 - seconds * 1.8 + phase * 0.4) * 0.75
          positions[base + 1] = lane + wave
        }

        let write = 0
        for (let i = 0; i < particleCount - 1; i++) {
          const a = i * 3
          const b = (i + 1) * 3
          linePositions[write++] = positions[a]
          linePositions[write++] = positions[a + 1]
          linePositions[write++] = positions[a + 2]
          linePositions[write++] = positions[b]
          linePositions[write++] = positions[b + 1]
          linePositions[write++] = positions[b + 2]
        }

        pos.needsUpdate = true
        linePos.needsUpdate = true
        points.rotation.z = Math.sin(seconds * 0.18) * 0.018
        lineMesh.rotation.z = points.rotation.z
        try {
          renderer.render(scene, camera)
        } catch {
          cancelAnimationFrame(raf)
          cleanupThree?.()
          host.style.opacity = "0.24"
          return
        }
        raf = requestAnimationFrame(render)
      }

      const start = () => {
        cancelAnimationFrame(raf)
        if (!document.hidden) raf = requestAnimationFrame(render)
      }

      onVisibilityChange = start
      document.addEventListener("visibilitychange", onVisibilityChange)
      start()

      cleanupThree = () => {
        cancelAnimationFrame(raf)
        document.removeEventListener("visibilitychange", onVisibilityChange!)
        window.removeEventListener("scroll", onScroll!)
        resizeObserver?.disconnect()
        geometry.dispose()
        material.dispose()
        lineGeometry.dispose()
        lineMaterial.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }

    void boot()

    return () => {
      destroyed = true
      cleanupThree?.()
    }
  }, [])

  return (
    <div
      ref={mountRef}
      className="pointer-events-none absolute inset-0 z-[1] opacity-70 transition-opacity duration-300 [mask-image:radial-gradient(ellipse_78%_56%_at_52%_38%,#000_40%,transparent_82%)]"
      aria-hidden
    >
      <div className="absolute left-1/2 top-[28%] h-40 w-[min(760px,90vw)] -translate-x-1/2 rounded-full bg-cyan-200/[0.06] blur-3xl" />
    </div>
  )
}
