import { createHash } from "node:crypto";
import { canonicalSerialize } from "@finnor/operational-ir";
import {
  BRANCH_HASH_PREFIX,
  HYPOTHETICAL_EFFECT_HASH_PREFIX,
  OVERLAY_HASH_PREFIX,
  REPLAY_HASH_PREFIX,
  SNAPSHOT_HASH_PREFIX,
  TRACE_HASH_PREFIX,
  type EffectOverlayId,
  type HypotheticalEffectId,
  type SimulationReplayIdentity,
  type SimulationTraceId,
  type WorldBranchId,
  type WorldSnapshotId,
} from "./contracts";

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalSerialize(value), "utf8").digest("hex");
}

/** P5 identity material is JSON-only and must be sorted by callers wherever an array is a set. */
export function p5Hash(value: unknown): string {
  return sha256(value);
}

export function snapshotIdentity(value: unknown): WorldSnapshotId {
  return `${SNAPSHOT_HASH_PREFIX}${sha256(value)}`;
}

export function branchIdentity(value: unknown): WorldBranchId {
  return `${BRANCH_HASH_PREFIX}${sha256(value)}`;
}

export function overlayIdentity(value: unknown): EffectOverlayId {
  return `${OVERLAY_HASH_PREFIX}${sha256(value)}`;
}

export function hypotheticalEffectIdentity(value: unknown): HypotheticalEffectId {
  return `${HYPOTHETICAL_EFFECT_HASH_PREFIX}${sha256(value)}`;
}

export function traceIdentity(value: unknown): SimulationTraceId {
  return `${TRACE_HASH_PREFIX}${sha256(value)}`;
}

export function replayIdentity(value: unknown): SimulationReplayIdentity {
  return `${REPLAY_HASH_PREFIX}${sha256(value)}`;
}

export function stateIdentity(value: unknown): `p5:state:sha256:${string}` {
  return `p5:state:sha256:${sha256(value)}`;
}

export function materializationIdentity(value: unknown): `p5:materialization:sha256:${string}` {
  return `p5:materialization:sha256:${sha256(value)}`;
}

export function canonicalBytes(value: unknown): number {
  return Buffer.byteLength(canonicalSerialize(value), "utf8");
}

export function isP5Identity(value: unknown): boolean {
  return typeof value === "string" && /^p5:[a-z-]+:sha256:[0-9a-f]{64}$/.test(value);
}
