import { createHash } from "node:crypto";
import type { ComputerAuthorizedEffect } from "@finnor/shared-types";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
}

export function effectsExactlyEqual(candidate: ComputerAuthorizedEffect, authorized: ComputerAuthorizedEffect): boolean {
  return canonical(candidate) === canonical(authorized);
}

export function authorizedEffectHash(effect: ComputerAuthorizedEffect): string {
  return createHash("sha256").update(canonical(effect)).digest("hex");
}

export function computerEffectOperationKey(effect: ComputerAuthorizedEffect): string {
  return `computer-effect:${authorizedEffectHash(effect).slice(0, 40)}`;
}
