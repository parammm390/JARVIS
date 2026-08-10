"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import styles from "./FinnorHome.module.css";

type WorldVariant = "hero" | "story" | "final";

type IndustrialExecutionWorldLoaderProps = {
  phase: number;
  variant?: WorldVariant;
};

const SOURCE_COLORS = ["#7ccbff", "#1958e8", "#8b76ff", "#39ddff", "#4fdb9d", "#ffb05c"];

let acceleratedWebGL: boolean | undefined;

function supportsAcceleratedWebGL() {
  if (acceleratedWebGL !== undefined) return acceleratedWebGL;

  const probe = document.createElement("canvas");
  const context = probe.getContext("webgl2") ?? probe.getContext("webgl");
  if (!context) {
    acceleratedWebGL = false;
    return acceleratedWebGL;
  }

  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(
    debugInfo
      ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER),
  );
  context.getExtension("WEBGL_lose_context")?.loseContext();
  acceleratedWebGL = !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  return acceleratedWebGL;
}

function StaticIndustrialWorld({ phase, faded = false }: { phase: number; faded?: boolean }) {
  return (
    <div
      className={styles.staticIndustrial}
      data-phase={phase}
      aria-hidden="true"
      style={{ opacity: faded ? 0 : 1, transition: "opacity 480ms ease" }}
    >
      <div className={styles.staticVessel}><i /><i /><i /></div>
      {SOURCE_COLORS.map((color) => <span key={color} style={{ "--module-color": color } as CSSProperties} />)}
      <div className={styles.staticPipes} />
    </div>
  );
}

const AcceleratedIndustrialWorld = dynamic(() => import("./IndustrialExecutionWorld"), {
  ssr: false,
  loading: () => null,
});

export default function IndustrialExecutionWorldLoader({ phase, variant = "story" }: IndustrialExecutionWorldLoaderProps) {
  const root = useRef<HTMLDivElement>(null);
  const [capable, setCapable] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    setCapable(!reduced && !narrow && supportsAcceleratedWebGL());

    const element = root.current;
    if (!element || !("IntersectionObserver" in window)) {
      setMounted(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setMounted(true);
        observer.disconnect();
      },
      { rootMargin: "220px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className={styles.worldMount} aria-hidden="true">
      <StaticIndustrialWorld phase={phase} faded={canvasReady} />
      {capable && mounted ? (
        <div style={{ position: "absolute", inset: 0 }}>
          <AcceleratedIndustrialWorld phase={phase} variant={variant} onCanvasReady={() => setCanvasReady(true)} />
        </div>
      ) : null}
    </div>
  );
}
