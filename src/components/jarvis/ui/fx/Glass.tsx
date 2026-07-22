"use client"

// C3.T1 — glass material fx entry. The real implementation already lived in
// atmosphere.tsx (backdrop-blur glass card, extended this session with the
// `noise` variant this task calls for) — re-exported here so ui/fx/ is the one
// place to look for every C3 fx primitive, without a second competing
// implementation drifting out of sync with the original.

export { Glass, GLOW_SHADOW, GRAIN } from "../../atmosphere"
