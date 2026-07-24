import { describe, expect, it } from "vitest";
import { recommendSlots } from "../../packages/read-models/src/slot-recommender";

describe("B3 slot recommender", () => {
  it("balances real travel, booking load, and SLA pressure transparently", () => {
    const result = recommendSlots([
      { technicianId: "a", technicianName: "Near but loaded", driveMinutes: 8, bookedJobs: 4, maxConcurrentJobs: 4, minutesUntilSla: 240 },
      { technicianId: "b", technicianName: "Balanced", driveMinutes: 14, bookedJobs: 1, maxConcurrentJobs: 4, minutesUntilSla: 240 },
      { technicianId: "c", technicianName: "SLA breach", driveMinutes: 5, bookedJobs: 0, maxConcurrentJobs: 4, minutesUntilSla: -1 },
    ]);
    expect(result.map((candidate) => candidate.technicianId)).toEqual(["b", "a", "c"]);
    expect(result[0]).toMatchObject({ loadRatio: 0.25, slaRisk: 0, unavailableReason: null });
    expect(result[2]).toMatchObject({ slaRisk: 1 });
  });

  it("never turns an absent profile or SLA into a made-up score", () => {
    const [result] = recommendSlots([{ technicianId: "a", technicianName: "Unconfigured", driveMinutes: null, bookedJobs: 0, maxConcurrentJobs: null, minutesUntilSla: null }]);
    expect(result).toMatchObject({ score: null, unavailableReason: expect.stringMatching(/incomplete/) });
  });
});
