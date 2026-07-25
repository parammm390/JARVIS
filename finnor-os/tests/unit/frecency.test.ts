import { describe, expect, it } from "vitest";
import { rankPanels, recordPanelOpen, scoreFrecency } from "../../../src/components/jarvis/lib/frecency";

describe("D6 panel frecency", () => {
  it("ranks recent repeated opens over stale opens without inventing activity", () => {
    const now = Date.UTC(2026, 6, 25);
    const ledger = { pipeline: { visits: 2, lastOpenedAt: now - 60_000 }, overview: { visits: 10, lastOpenedAt: now - 60 * 24 * 60 * 60 * 1000 } };
    expect(rankPanels(["overview", "pipeline", "approvals"] as const, ledger, now)).toEqual(["pipeline", "overview", "approvals"]);
    expect(scoreFrecency(undefined, now)).toBe(0);
  });
  it("records only the panel the person actually opened", () => {
    const now = 1000;
    expect(recordPanelOpen({}, "overview", now)).toEqual({ overview: { visits: 1, lastOpenedAt: now } });
  });
});
