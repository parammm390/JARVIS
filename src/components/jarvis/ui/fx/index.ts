// C3.T1 — ui/fx/ barrel. Every effect primitive the plan's fx toolkit names, one
// import path. Glass/GridBackdrop/ParticleBurst are thin re-exports over
// pre-existing real implementations (found via grep before building, per hard rule
// #29) — see each file's own header for why it wasn't rebuilt from scratch.
export { Glow, type GlowTier } from "./Glow"
export { Glass, GLOW_SHADOW, GRAIN } from "./Glass"
export { GridBackdrop } from "./GridBackdrop"
export { ParticleField, burstAt, consumeBursts } from "./ParticleBurst"
export { DecryptText } from "./DecryptText"
export { BorderBeam } from "./BorderBeam"
