"use client"

export default function GrainOverlay() {
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[55] h-[34vh] bg-[radial-gradient(ellipse_at_top,rgba(103,232,249,0.07),rgba(103,232,249,0.018)_38%,transparent_74%)]" />
      <div
        className="pointer-events-none fixed inset-0 z-[60] opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.52 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
          backgroundSize: "180px 180px",
        }}
      />
    </>
  )
}
