import { describe, expect, it } from "vitest";
import { nearestNeighbor, optimizeRoute, osrmMatrix, routeDistance, twoOpt } from "../../packages/read-models/src/route-optimizer";

// Seeded Houston-metro-like road distances. Existing appointment order is
// 0→1→2→3 (32km); the optimizer should select 0→2→1→3 (9km).
const matrix = [
  [0, 10_000, 3_000, 15_000],
  [10_000, 0, 2_000, 4_000],
  [3_000, 2_000, 0, 20_000],
  [15_000, 4_000, 20_000, 0],
];

describe("B3 route optimizer", () => {
  it("beats the seeded naive route without changing its first scheduled stop", () => {
    const result = optimizeRoute(matrix);
    expect(result.order[0]).toBe(0);
    expect(result.naiveMeters).toBe(32_000);
    expect(result.optimizedMeters).toBeLessThan(result.naiveMeters);
    expect(result.savedMeters).toBe(result.naiveMeters - result.optimizedMeters);
    expect(routeDistance(result.order, matrix)).toBe(result.optimizedMeters);
  });

  it("uses deterministic nearest-neighbor then deterministic two-opt", () => {
    const initial = nearestNeighbor(matrix);
    expect(initial).toEqual([0, 2, 1, 3]);
    expect(twoOpt(initial, matrix)).toEqual([0, 2, 1, 3]);
  });

  it("accepts an OSRM driving matrix and rejects an incomplete matrix", async () => {
    const response = await osrmMatrix(
      [
        { id: "a", label: "A", lat: 29.76, lon: -95.37 },
        { id: "b", label: "B", lat: 29.77, lon: -95.38 },
      ],
      async () => new Response(JSON.stringify({ code: "Ok", distances: [[0, 1234], [1234, 0]] })),
    );
    expect(response).toEqual([[0, 1234], [1234, 0]]);
    await expect(osrmMatrix([{ id: "a", label: "A", lat: 1, lon: 1 }], async () => new Response(JSON.stringify({ code: "Ok", distances: [] })))).rejects.toThrow("incomplete");
  });
});
