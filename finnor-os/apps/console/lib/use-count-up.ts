"use client";

import { useEffect, useRef, useState } from "react";

/** Animates a numeric stat tile from its previous value to the next one whenever it
 *  changes (a fresh poll landed a different number) — ~500ms ease-out tween via
 *  requestAnimationFrame, no dependency. Non-numeric/placeholder values pass through
 *  unanimated. */
export function useCountUp(target: number | null | undefined, durationMs = 500): number | null {
  const [display, setDisplay] = useState<number | null>(target ?? null);
  const fromRef = useRef<number | null>(target ?? null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) {
      setDisplay(null);
      fromRef.current = null;
      return;
    }
    const goal: number = target;
    const from = fromRef.current ?? goal;
    if (from === goal) {
      setDisplay(goal);
      return;
    }
    const start = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (goal - from) * eased);
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = goal;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}
