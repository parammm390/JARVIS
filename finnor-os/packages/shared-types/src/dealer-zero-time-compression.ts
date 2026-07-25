// B4.T2: deterministic, presentation-safe timing for the Dealer Zero demo. This is
// a script, not a replay of customer events; callers must preserve demo/synthetic
// labels when displaying it. The actual simulator remains separately gated by
// tenant_settings.simulator_enabled.

import { hashSeed } from "./dealer-zero-fixtures";
import { type DealerZeroScenarioPack } from "./dealer-zero-scenarios";

export interface DemoTimelineFrame {
  atMs: number;
  kind: "day_start" | "intake" | "approval" | "workflow" | "day_end";
  label: string;
}

export interface TimeCompressedDemo {
  demo: true;
  synthetic: true;
  dateSeed: string;
  scenario: DealerZeroScenarioPack;
  multiplier: number;
  durationMs: number;
  frames: DemoTimelineFrame[];
}

export function buildTimeCompressedDemo(dateSeed: string, scenario: DealerZeroScenarioPack, multiplier: number): TimeCompressedDemo {
  // A source day is represented as 10 minutes of narrative time. Compression changes
  // only presentation timing; it never changes the chosen synthetic story beats.
  const durationMs = Math.round((10 * 60_000 / multiplier) / 100) * 100;
  const seed = hashSeed("dealer-zero-demo", dateSeed, scenario);
  const first = 0.12 + (seed % 8) / 100;
  const middle = 0.42 + ((seed >>> 8) % 8) / 100;
  const labels: Record<DealerZeroScenarioPack, readonly [string, string, string]> = {
    normal_day: ["Synthetic intake arrives", "A real approval gate is presented", "A synthetic workflow advances"],
    brutal_summer: ["Synthetic summer intake surge arrives", "Priority approvals enter the real gate", "Synthetic dispatch workflows advance"],
    payment_crunch: ["Synthetic unpaid invoices are reviewed", "Payment follow-ups enter the real gate", "Synthetic collection workflows advance"],
    equipment_recall: ["Synthetic recall notices arrive", "Inspection actions enter the real gate", "Synthetic follow-up workflows advance"],
    chaos_day: ["Synthetic intake arrives under fault pressure", "Approvals remain gated during the demo", "Synthetic workflows expose recoverable faults"],
  };
  const [intake, approval, workflow] = labels[scenario];
  return {
    demo: true,
    synthetic: true,
    dateSeed,
    scenario,
    multiplier,
    durationMs,
    frames: [
      { atMs: 0, kind: "day_start", label: "DEMO — Dealer Zero synthetic day begins" },
      { atMs: Math.round(durationMs * first), kind: "intake", label: intake },
      { atMs: Math.round(durationMs * middle), kind: "approval", label: approval },
      { atMs: Math.round(durationMs * 0.72), kind: "workflow", label: workflow },
      { atMs: durationMs, kind: "day_end", label: "DEMO — Dealer Zero synthetic day ends" },
    ],
  };
}
