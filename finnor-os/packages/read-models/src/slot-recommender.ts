// B3.T2: pure, explainable slot scoring. Inputs arrive from real dispatch profiles
// and bookings; absence is explicit rather than converted into invented numbers.

export interface SlotCandidateInput {
  technicianId: string;
  technicianName: string;
  driveMinutes: number | null;
  bookedJobs: number;
  maxConcurrentJobs: number | null;
  minutesUntilSla: number | null;
}

export interface SlotRecommendation {
  technicianId: string;
  technicianName: string;
  score: number | null;
  driveMinutes: number | null;
  loadRatio: number | null;
  slaRisk: number | null;
  unavailableReason: string | null;
}

/** Lower is better. Travel is in minutes; load and SLA are bounded penalties so a
 * nearby but already-overloaded/late technician cannot win silently. */
export function recommendSlots(candidates: SlotCandidateInput[]): SlotRecommendation[] {
  return candidates
    .map((candidate) => {
      if (candidate.driveMinutes === null || candidate.maxConcurrentJobs === null || candidate.maxConcurrentJobs <= 0 || candidate.minutesUntilSla === null) {
        return { ...candidate, score: null, loadRatio: null, slaRisk: null, unavailableReason: "Dispatch profile or requested-slot SLA data is incomplete." };
      }
      const loadRatio = candidate.bookedJobs / candidate.maxConcurrentJobs;
      const slaRisk = candidate.minutesUntilSla <= 0 ? 1 : Math.max(0, 1 - candidate.minutesUntilSla / 240);
      return {
        technicianId: candidate.technicianId,
        technicianName: candidate.technicianName,
        driveMinutes: candidate.driveMinutes,
        loadRatio,
        slaRisk,
        score: candidate.driveMinutes + loadRatio * 30 + slaRisk * 60,
        unavailableReason: null,
      };
    })
    .sort((a, b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY) || a.technicianName.localeCompare(b.technicianName));
}
