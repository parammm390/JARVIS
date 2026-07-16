"use client";

import { useCallback, useEffect } from "react";

/** Extracts the useCallback+useEffect+setInterval pattern every console page
 *  repeats for its polling fetch. `fn` should already be memoized (or stable). */
export function usePoll(fn: () => void | Promise<void>, ms: number, deps: unknown[] = []): void {
  const stableFn = useCallback(fn, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    stableFn();
    const t = setInterval(stableFn, ms);
    return () => clearInterval(t);
  }, [stableFn, ms]);
}
