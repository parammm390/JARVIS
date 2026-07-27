// M4.T1/T2 — trimmed to the one thing still in use: the live intake-checklist
// snapshot builder `PersonalizedDemoPanel.tsx` calls while a call is in progress.
// The post-call UI component this file used to export is retired — its "Booking
// Route" card is replaced by `JarvisResultCard.tsx`'s real JARVIS-styled Approval
// Cockpit card (docs/marketing-demo-merge-contract.md Act 1 §1-4).

import type {
  DemoIntakeHandoff,
  NormalizedTranscriptItem,
} from "@/lib/demo/types";
import { buildLiveIntakeSnapshot } from "@/lib/demo/intake-extraction";
import type { DemoWorkflowType } from "@/lib/demo/workflows";

export type DemoTranscriptItem = NormalizedTranscriptItem;
export type IntakeSnapshot = DemoIntakeHandoff;

export function buildIntakeSnapshot(
  transcript: DemoTranscriptItem[],
  companyName = "Generated company",
  workflowType: DemoWorkflowType = "water_treatment",
): IntakeSnapshot {
  return buildLiveIntakeSnapshot(transcript, companyName, workflowType);
}
